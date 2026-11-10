/**
 * Loads a deal, runs one operation on it inside a call context, and always saves what happened,
 * including when the operation fails halfway. A capture that succeeded must never be forgotten
 * because the payout after it threw.
 */
import { newContext, runInContext, type CallContext } from "./context";
import { RuleError } from "./paypal/errors";
import { getDeal, getDealListing, saveDeal } from "./repo";
import { loadTape, type TapeEntry } from "./tape";
import type { Deal, Listing, Mode } from "./types";

const locks = new Map<string, Promise<unknown>>();

/** One operation at a time per deal within this server instance. */
async function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(fn);
  locks.set(key, run);
  try {
    return await run;
  } finally {
    if (locks.get(key) === run) locks.delete(key);
  }
}

/** Scripts set this to collect fixture entries from a live run (see scripts/record-replay.ts). */
let recorder: TapeEntry[] | undefined;
export function setRecorder(entries: TapeEntry[] | undefined): void {
  recorder = entries;
}

const MAX_CALLS_KEPT = 300;

export interface DealRun<T> {
  result: T;
  deal: Deal;
  listing: Listing;
}

export async function withDeal<T>(dealId: string, feature: string, fn: (deal: Deal, listing: Listing) => Promise<T>): Promise<DealRun<T>> {
  return serialized(dealId, async () => {
    const deal = await getDeal(dealId);
    if (!deal) throw new RuleError("DEAL_NOT_FOUND", "That deal does not exist.", 404);
    const listing = await getDealListing(deal);
    if (!listing) throw new RuleError("LISTING_NOT_FOUND", "The listing for this deal is gone.", 404);
    const ctx: CallContext = newContext({
      feature,
      dealId,
      mode: deal.mode,
      counters: deal.tapeCounters,
      tape: deal.mode === "replay" ? await loadTape() : undefined,
      recorder: deal.mode === "live" ? recorder : undefined,
    });
    try {
      const result = await runInContext(ctx, () => fn(deal, listing));
      return { result, deal, listing };
    } finally {
      if (ctx.calls.length > 0) deal.calls = [...deal.calls, ...ctx.calls].slice(-MAX_CALLS_KEPT);
      deal.updatedAt = new Date().toISOString();
      await saveDeal(deal);
    }
  });
}

/** For operations that are not tied to a deal (listing drafts, want parsing). */
export async function withContext<T>(feature: string, mode: Mode, fn: () => Promise<T>): Promise<{ result: T; ctx: CallContext }> {
  const ctx = newContext({ feature, mode, tape: mode === "replay" ? await loadTape() : undefined, recorder: mode === "live" ? recorder : undefined });
  const result = await runInContext(ctx, fn);
  return { result, ctx };
}
