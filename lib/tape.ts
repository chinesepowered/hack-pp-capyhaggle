/**
 * Record and replay of outbound calls (PayPal and the AI models).
 *
 * Replay mode runs the same application code as Live mode. The only difference is at the very edge:
 * instead of calling PayPal or the model, the edge returns the response that was recorded from a
 * real sandbox run. Entries are matched by a stable key plus an occurrence counter.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { currentContext } from "./context";

export interface TapeEntry {
  key: string;
  kind: "paypal" | "ai";
  /** PayPal: HTTP status. */
  status?: number;
  debugId?: string;
  method?: string;
  path?: string;
  /** AI: the model that answered. */
  model?: string;
  fallback?: boolean;
  ms: number;
  body: unknown;
}

export interface Tape {
  scenario: string;
  recordedAt: string;
  note: string;
  entries: TapeEntry[];
}

export class ReplayMissError extends Error {
  constructor(public key: string) {
    super(`Replay has no recording for "${key}". This step is only available in Live mode.`);
    this.name = "ReplayMissError";
  }
}

export const DEFAULT_SCENARIO = "kids-bike";

const tapeCache = new Map<string, Tape>();

export async function loadTape(scenario = DEFAULT_SCENARIO): Promise<Tape> {
  const cached = tapeCache.get(scenario);
  if (cached) return cached;
  if (!/^[a-z0-9-]+$/.test(scenario)) throw new Error("Bad scenario name.");
  const file = path.join(process.cwd(), "fixtures", "replay", `${scenario}.json`);
  const tape = JSON.parse(await fs.readFile(file, "utf8")) as Tape;
  tapeCache.set(scenario, tape);
  return tape;
}

/** Next occurrence key for a base key, e.g. "ai:negotiate.barley" -> "ai:negotiate.barley#2". */
export function nextKey(baseKey: string): string {
  const ctx = currentContext();
  const n = ctx.counters[baseKey] ?? 0;
  ctx.counters[baseKey] = n + 1;
  return `${baseKey}#${n}`;
}

/** In Replay mode, returns the recorded entry for this key (or throws). In Live mode, undefined. */
export function replayEntry(key: string): TapeEntry | undefined {
  const ctx = currentContext();
  if (ctx.mode !== "replay") return undefined;
  const entry = ctx.tape?.entries.find((e) => e.key === key);
  if (!entry) throw new ReplayMissError(key);
  return entry;
}

/** In Live mode with a recorder attached, remembers this response for the fixture. */
export function recordEntry(entry: TapeEntry): void {
  const ctx = currentContext();
  if (ctx.mode === "live" && ctx.recorder) ctx.recorder.push(entry);
}

/** Replay keeps a little of the original latency so the flow still feels like the real thing. */
export async function replayDelay(ms: number): Promise<void> {
  const factor = Number(process.env.CVC_REPLAY_SPEED ?? "0.35");
  if (factor <= 0) return;
  const wait = Math.min(1500, Math.max(120, ms * factor));
  await new Promise((r) => setTimeout(r, wait));
}
