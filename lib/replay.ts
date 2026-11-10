/**
 * Replay mode: the main flow, run by the same code, from recorded real sandbox and AI responses.
 *
 * A replay deal gets its own frozen copy of the listing that was used when the fixture was
 * recorded (same id, same facts), so the referee and the guards judge the recorded moves against
 * exactly what the models saw. The copy lives outside the live shelf. Nothing in Replay mode calls
 * PayPal or a model.
 */
import { upcomingPickupWindows } from "./demo-data";
import { createDeal } from "./deals";
import { shortId } from "./ids";
import { keys, saveDeal } from "./repo";
import { store } from "./store";
import { DEFAULT_SCENARIO, loadTape, type Tape } from "./tape";
import type { Deal, Listing } from "./types";
import { sellerPrivate } from "./world";

export interface ScenarioTape extends Tape {
  listing: Listing;
  floorCents: number;
  ceilingCents: number;
  pickupWindowIds: string[];
  wantText: string;
  /** The human message used for the recorded scam-check example. */
  scamExample: string;
}

export async function scenario(name = DEFAULT_SCENARIO): Promise<ScenarioTape> {
  return (await loadTape(name)) as ScenarioTape;
}

export async function createReplayDeal(): Promise<Deal> {
  const tape = await scenario();
  const id = `rpl_${shortId("r", 6).slice(2)}`;
  // Same window ids as the recording, dated for the coming weekend.
  const fresh = upcomingPickupWindows();
  const pickupWindows = [...fresh, ...tape.listing.pickupWindows.filter((w) => !fresh.some((f) => f.id === w.id))];
  const listing: Listing = { ...tape.listing, status: "active", pickupWindows, seeded: false };
  await store().set(keys.replayListing(id), listing);
  const deal = await createDeal({
    listing,
    ceilingCents: tape.ceilingCents,
    pickupWindowIds: tape.pickupWindowIds,
    mode: "replay",
    id,
    sellerMandate: sellerPrivate(listing.id, tape.floorCents).mandate,
  });
  await saveDeal(deal);
  return deal;
}

/** Older replay copies lived on the shelf under this prefix; they are still filtered out. */
export function isReplayListing(listing: Pick<Listing, "id">): boolean {
  return listing.id.startsWith("rpl-");
}
