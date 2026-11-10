/**
 * The model edge. OpenAI-compatible chat completions on W&B Inference, server-side only.
 *
 * - maxRetries 4 and a 60 s timeout on the primary model (about 1 call in 20 fails without retries).
 * - After repeated failures, or an empty answer, the fallback model is tried.
 * - Every call is logged for the reasoning trail and can be recorded for Replay mode.
 * - Model text is cleaned before it reaches the UI (no em dashes, no stray markup).
 */
import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool, ChatCompletionToolChoiceOption } from "openai/resources/chat/completions";
import { currentContext } from "./context";
import { env } from "./env";
import { nextKey, recordEntry, replayDelay, replayEntry } from "./tape";
import type { AiTag } from "./types";

export type { ChatCompletionMessageParam, ChatCompletionTool };

export interface AiRequest {
  /** Stable key for the replay tape, for example "negotiate.barley". */
  purpose: string;
  /** Human label for the AI tag, for example "Haggling for Maya". */
  label: string;
  messages: ChatCompletionMessageParam[];
  tools?: ChatCompletionTool[];
  toolChoice?: ChatCompletionToolChoiceOption;
  maxTokens?: number;
  temperature?: number;
  /** Override the primary model, for example the vision model. */
  model?: string;
  /**
   * How much the primary model may think before answering. It is a reasoning model: left alone it
   * can spend its whole token budget thinking and return nothing. "none" is right for extraction
   * and tool calls, "low" for the haggle itself.
   */
  reasoning?: "none" | "low";
}

export interface AiToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  raw: string;
}

export interface AiResponse {
  content: string;
  toolCalls: AiToolCall[];
  reasoning?: string;
  tag: AiTag;
  ms: number;
}

export class AiUnavailableError extends Error {
  constructor(
    public purpose: string,
    public cause?: unknown,
  ) {
    super(`The AI models did not answer for "${purpose}".`);
    this.name = "AiUnavailableError";
  }
}

let clientMemo: OpenAI | undefined;

function client(): OpenAI {
  if (!clientMemo) {
    clientMemo = new OpenAI({ baseURL: env.openaiBaseUrl, apiKey: env.openaiApiKey, maxRetries: 4, timeout: 60_000 });
  }
  return clientMemo;
}

/** Makes model text safe for the UI: this product never shows em dashes, and bubbles are plain text. */
export function cleanText(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/\s*[—―]\s*/g, ", ")
    .replace(/–/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function cleanDeep<T>(value: T): T {
  if (typeof value === "string") return cleanText(value) as T;
  if (Array.isArray(value)) return value.map(cleanDeep) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cleanDeep(v)])) as T;
  }
  return value;
}

interface WireMessage {
  content?: string | null;
  reasoning?: string | null;
  reasoning_content?: string | null;
  tool_calls?: { id: string; type?: string; function?: { name: string; arguments: string } }[];
}

interface Recorded {
  message: WireMessage;
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toResponse(message: WireMessage, tag: AiTag, ms: number): AiResponse {
  const toolCalls: AiToolCall[] = (message.tool_calls ?? [])
    .filter((c) => c.function?.name)
    .map((c) => ({ id: c.id, name: c.function!.name, raw: c.function!.arguments ?? "{}", args: cleanDeep(parseArgs(c.function!.arguments ?? "{}")) }));
  return {
    content: cleanText(message.content),
    toolCalls,
    reasoning: cleanText(message.reasoning ?? message.reasoning_content) || undefined,
    tag,
    ms,
  };
}

function isEmpty(message: WireMessage, wantTools: boolean): boolean {
  const hasTool = (message.tool_calls ?? []).some((c) => c.function?.name);
  if (wantTools) return !hasTool && !(message.content ?? "").trim();
  return !(message.content ?? "").trim() && !hasTool;
}

async function callModel(model: string, req: AiRequest, maxTokens: number, reasoning?: "none" | "low"): Promise<WireMessage> {
  const res = await client().chat.completions.create({
    model,
    messages: req.messages,
    ...(req.tools ? { tools: req.tools, tool_choice: req.toolChoice ?? "auto" } : {}),
    max_tokens: maxTokens,
    temperature: req.temperature ?? 0.6,
    ...(reasoning ? { reasoning_effort: reasoning as "low" } : {}),
  });
  return (res.choices[0]?.message ?? {}) as WireMessage;
}

/** One chat completion with retries, fallback, logging, and record or replay. */
export async function aiChat(req: AiRequest): Promise<AiResponse> {
  const ctx = currentContext();
  const key = nextKey(`ai:${req.purpose}`);
  const entry = replayEntry(key);
  if (entry) {
    await replayDelay(entry.ms);
    const rec = entry.body as Recorded;
    return toResponse(rec.message, { model: entry.model ?? "recorded", purpose: req.label, fallback: entry.fallback, replayed: true }, entry.ms);
  }

  const primary = req.model ?? env.model;
  const wantTools = Boolean(req.tools?.length);
  const started = Date.now();
  let lastError: unknown;

  try {
    // Reasoning tokens count against max_tokens, so leave room for them on top of the answer.
    const budget = (req.maxTokens ?? 900) + (req.reasoning === "none" || req.model ? 0 : 2000);
    const message = await callModel(primary, req, budget, req.model ? undefined : (req.reasoning ?? "none"));
    if (!isEmpty(message, wantTools)) {
      const ms = Date.now() - started;
      recordEntry({ key, kind: "ai", model: primary, ms, body: { message } satisfies Recorded });
      return toResponse(message, { model: primary, purpose: req.label }, ms);
    }
    lastError = new Error("empty answer");
    if (process.env.CVC_AI_DEBUG) console.warn(`[ai] ${req.purpose}: ${primary} returned an empty answer`, JSON.stringify(message).slice(0, 400));
  } catch (err) {
    lastError = err;
    if (process.env.CVC_AI_DEBUG) console.warn(`[ai] ${req.purpose}: ${primary} failed:`, err instanceof Error ? err.message.slice(0, 300) : err);
  }

  // Fallback model. It always spends tokens on reasoning first, so give it room, and accept an
  // answer whose content is null as long as a tool call came back.
  const fallback = env.fallbackModel;
  if (fallback && fallback !== primary && !req.model) {
    try {
      const message = await callModel(fallback, req, Math.max(2400, (req.maxTokens ?? 900) * 3));
      if (!isEmpty(message, wantTools)) {
        const ms = Date.now() - started;
        recordEntry({ key, kind: "ai", model: fallback, fallback: true, ms, body: { message } satisfies Recorded });
        return toResponse(message, { model: fallback, purpose: req.label, fallback: true }, ms);
      }
    } catch (err) {
      lastError = err;
    }
  }
  if (ctx.mode === "live") console.warn(`[ai] ${req.purpose} unavailable:`, lastError instanceof Error ? lastError.message : lastError);
  throw new AiUnavailableError(req.purpose, lastError);
}

/** Pulls the first JSON object out of model text (models like to wrap JSON in prose or fences). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  if (start < 0) throw new Error("No JSON object in the model answer.");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return JSON.parse(candidate.slice(start, i + 1));
    }
  }
  throw new Error("Unbalanced JSON in the model answer.");
}
