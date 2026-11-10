/**
 * Replay mode: the main flow, run by the same code, from recorded real sandbox and AI responses.
 *
 * A replay deal gets its own frozen copy of the listing that was used when the fixture was
 * recorded, so the referee judges the recorded moves against the same facts. Nothing in Replay
 * mode calls PayPal or a model.
 */
import { upcomingPickupWindows } from "./demo-data";
import { createDeal } from "./deals";
import { shortId } from "./ids";
import { saveDeal, saveListing, saveListingPrivate } from "./repo";
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
  const suffix = shortId("r", 6).slice(2);
  const listing: Listing = {
    ...tape.listing,
    id: `rpl-${suffix}`,
    status: "active",
    // Same window ids as the recording, dated for the coming weekend.
    pickupWindows: upcomingPickupWindows().map((w) => ({ ...w })),
    seeded: false,
  };
  // The recorded offers name window ids; keep any id from the recording that the fresh set lacks.
  for (const w of tape.listing.pickupWindows) {
    if (!listing.pickupWindows.some((x) => x.id === w.id)) listing.pickupWindows.push(w);
  }
  await saveListing(listing);
  await saveListingPrivate(sellerPrivate(listing.id, tape.floorCents));
  const deal = await createDeal({ listing, ceilingCents: tape.ceilingCents, pickupWindowIds: tape.pickupWindowIds, mode: "replay", id: `rpl_${suffix}` });
  // The copy exists only for this replay. Keep it out of the public listing shelf.
  listing.status = "reserved";
  await saveListing(listing);
  await saveDeal(deal);
  return deal;
}

export function isReplayListing(listing: Pick<Listing, "id">): boolean {
  return listing.id.startsWith("rpl-");
}
