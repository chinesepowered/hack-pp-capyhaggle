/**
 * PayPal Agent Toolkit (@paypal/agent-toolkit) wiring.
 *
 * The agents' PayPal tools come from the toolkit where it has a fitting tool:
 *   - get_order      Biscuit independently verifies that PayPal really holds the buyer's money.
 *   - create_refund  Barley refunds the buyer when a problem is reported within 24 hours.
 * The toolkit's create_order hardcodes intent CAPTURE (1.11.0), so the hold order (intent AUTHORIZE)
 * is our own tool on the server SDK (see lib/agents/settlement.ts).
 *
 * Nothing here is callable by a model directly. lib/guards.ts checks every call first.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import diagnostics from "node:diagnostics_channel";
import type { ClientRequest, IncomingMessage } from "node:http";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/openai";
import type { ChatCompletionTool } from "../ai";
import { env } from "../env";
import { nextKey, recordEntry, replayDelay, replayEntry } from "../tape";
import { logCall } from "./core";

export type ToolkitToolName = "get_order" | "create_refund";

interface Capture {
  seen: { method: string; path: string; status: number; debugId?: string; ms: number }[];
  started: WeakMap<object, number>;
}

/**
 * The toolkit returns only response bodies, so its HTTP calls are observed through Node's
 * diagnostics channel instead. Only requests started inside a toolkit call are captured.
 */
const captureScope = new AsyncLocalStorage<Capture>();
const tagged = new WeakMap<object, Capture>();
let subscribed = false;

function subscribe(): void {
  if (subscribed) return;
  subscribed = true;
  diagnostics.subscribe("http.client.request.start", (message) => {
    const { request } = message as { request: ClientRequest };
    const capture = captureScope.getStore();
    if (!capture || !/paypal\.com$/.test(String(request.getHeader("host") ?? request.host ?? ""))) return;
    tagged.set(request, capture);
    capture.started.set(request, Date.now());
  });
  diagnostics.subscribe("http.client.response.finish", (message) => {
    const { request, response } = message as { request: ClientRequest; response: IncomingMessage };
    const capture = tagged.get(request);
    if (!capture) return;
    const debug = response.headers["paypal-debug-id"];
    capture.seen.push({
      method: request.method,
      path: request.path,
      status: response.statusCode ?? 0,
      debugId: Array.isArray(debug) ? debug[0] : debug,
      ms: Date.now() - (capture.started.get(request) ?? Date.now()),
    });
  });
}

let memo: PayPalAgentToolkit | undefined;

function toolkit(): PayPalAgentToolkit {
  if (!memo) {
    memo = new PayPalAgentToolkit({
      clientId: env.paypalClientId,
      clientSecret: env.paypalClientSecret,
      configuration: {
        // Only the two tools this app uses are enabled.
        actions: { orders: { get: true }, payments: { createRefund: true } },
        context: { sandbox: true },
      },
    });
  }
  return memo;
}

/** The toolkit's own tool definitions, handed to the model unchanged. */
export function toolkitToolDefinitions(names: ToolkitToolName[]): ChatCompletionTool[] {
  if (process.env.CVC_TOOLKIT_OFFLINE === "1") return names.map(offlineDefinition);
  const all = toolkit().getTools() as unknown as ChatCompletionTool[];
  const picked = all.filter((t) => t.type === "function" && names.includes(t.function.name as ToolkitToolName));
  return picked.length === names.length ? picked : names.map(offlineDefinition);
}

function offlineDefinition(name: ToolkitToolName): ChatCompletionTool {
  return name === "get_order"
    ? {
        type: "function",
        function: {
          name,
          description: "Retrieve the details of a PayPal order.",
          parameters: { type: "object", properties: { id: { type: "string", description: "The order id generated during create call" } }, required: ["id"] },
        },
      }
    : {
        type: "function",
        function: {
          name,
          description: "Process a refund for a captured payment.",
          parameters: {
            type: "object",
            properties: {
              capture_id: { type: "string", description: "The ID of the capture to refund." },
              amount: { type: "object", properties: { currency_code: { type: "string" }, value: { type: "string" } } },
              note_to_payer: { type: "string" },
            },
            required: ["capture_id"],
          },
        },
      };
}

const EXPECTED_PATH: Record<ToolkitToolName, (args: Record<string, unknown>) => { method: string; path: string }> = {
  get_order: (a) => ({ method: "GET", path: `/v2/checkout/orders/${String(a.id)}` }),
  create_refund: (a) => ({ method: "POST", path: `/v2/payments/captures/${String(a.capture_id)}/refund` }),
};

export interface ToolkitResult {
  /** The JSON the toolkit handed back to the model, parsed when possible. */
  data: Record<string, unknown>;
  raw: string;
  ok: boolean;
}

function parseContent(content: unknown): { data: Record<string, unknown>; raw: string } {
  const raw = typeof content === "string" ? content : JSON.stringify(content ?? {});
  try {
    const parsed = JSON.parse(raw) as unknown;
    return { data: parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : { value: parsed }, raw };
  } catch {
    return { data: { message: raw }, raw };
  }
}

/**
 * Executes one toolkit tool. Callers must have run the matching guard first.
 * Every HTTP request the toolkit makes is logged for the "Under the hood" drawer.
 */
export async function runToolkitTool(name: ToolkitToolName, args: Record<string, unknown>): Promise<ToolkitResult> {
  const key = nextKey(`paypal:toolkit.${name}`);
  const expected = EXPECTED_PATH[name](args);
  const entry = replayEntry(key);
  if (entry) {
    await replayDelay(entry.ms);
    logCall({ method: expected.method, path: entry.path ?? expected.path, status: entry.status ?? 200, debugId: entry.debugId, via: "agent-toolkit", ms: entry.ms, replayed: true });
    const { data, raw } = parseContent(entry.body);
    return { data, raw, ok: (entry.status ?? 200) < 400 };
  }

  subscribe();
  const capture: Capture = { seen: [], started: new WeakMap() };
  const started = Date.now();
  let content: unknown;
  let threw: unknown;
  try {
    const message = await captureScope.run(capture, () =>
      toolkit().handleToolCall({ id: `call_${Date.now()}`, type: "function", function: { name, arguments: JSON.stringify(args) } } as never),
    );
    content = (message as { content?: unknown }).content;
  } catch (err) {
    threw = err;
    content = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
  const ms = Date.now() - started;
  const main = capture.seen.find((s) => s.path.startsWith(expected.path.split("?")[0]));
  for (const s of capture.seen) {
    logCall({ method: s.method, path: s.path, status: s.status, debugId: s.debugId, via: "agent-toolkit", ms: s.ms, note: s === main ? `tool ${name}` : "toolkit OAuth token" });
  }
  if (capture.seen.length === 0) {
    logCall({ method: expected.method, path: expected.path, status: threw ? 0 : 200, via: "agent-toolkit", ms, note: `tool ${name} (headers not observed)` });
  }
  const { data, raw } = parseContent(content);
  const status = main?.status ?? (threw ? 500 : 200);
  recordEntry({ key, kind: "paypal", status, debugId: main?.debugId, method: expected.method, path: expected.path, ms, body: data });
  return { data, raw, ok: !threw && status < 400 };
}
