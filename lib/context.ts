/**
 * Per-request call context, carried with AsyncLocalStorage so the PayPal and AI layers can log
 * every call (for the "Under the hood" drawer) and switch between Live and Replay without every
 * function threading extra parameters.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Mode, PayPalCall } from "./types";
import type { Tape, TapeEntry } from "./tape";

export interface CallContext {
  /** Which product feature triggered the calls, shown in the drawer. */
  feature: string;
  dealId?: string;
  mode: Mode;
  /** Sink for PayPal call records. The route handler saves these onto the deal. */
  calls: PayPalCall[];
  /** Per-key counters that line a live run up with its recording. Lives on the deal. */
  counters: Record<string, number>;
  /** Replay source when mode is "replay". */
  tape?: Tape;
  /** Collects entries when a live run is being recorded into a fixture. */
  recorder?: TapeEntry[];
}

const storage = new AsyncLocalStorage<CallContext>();

export function runInContext<T>(ctx: CallContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

export function currentContext(): CallContext {
  return (
    storage.getStore() ?? {
      feature: "Background",
      mode: "live",
      calls: [],
      counters: {},
    }
  );
}

/** Runs fn with a different feature label but the same sinks. */
export function withFeature<T>(feature: string, fn: () => Promise<T>): Promise<T> {
  const parent = currentContext();
  // Share the arrays and counters by reference so nothing is lost when fn returns.
  return storage.run({ ...parent, feature }, fn);
}

export function newContext(partial: Partial<CallContext> & { feature: string }): CallContext {
  return {
    mode: "live",
    calls: [],
    counters: {},
    ...partial,
  };
}
