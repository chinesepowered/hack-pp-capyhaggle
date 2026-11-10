/**
 * The seeded demo world: Theo's three listings, Maya's want, and the historical deals that
 * `pnpm seed` creates in the PayPal sandbox. Also the snapshot that POST /api/admin/reset restores.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { BUYER, DEMO_ITEMS, DEMO_WANT, SELLER, upcomingPickupWindows } from "./demo-data";
import { env } from "./env";
import { issueMandate, verifyMandate } from "./mandate";
import { getListing, getListingPrivate, keys, listListings, saveListing, saveListingPrivate, saveWant, saveWantPrivate } from "./repo";
import { store } from "./store";
import type { AiTag, Deal, Listing, ListingFact, ListingPrivate, PriceSuggestion, Want, WantPrivate } from "./types";

/** Seller mandates are issued for 30 days and re-issued when a demo listing is refreshed. */
const SELLER_MANDATE_TTL_HOURS = 30 * 24;

export interface RecordedDraft {
  title: string;
  category: string;
  description: string;
  conditionGrade: string;
  facts: ListingFact[];
  ai: AiTag;
  price: { lowCents: number; highCents: number; basis: string; ai: AiTag };
  photoCredit?: string;
}

export type RecordedDrafts = Record<string, RecordedDraft>;

let draftsMemo: RecordedDrafts | undefined;

/** Listing texts written by the vision model from the photos in public/items (recorded real runs). */
export async function recordedDrafts(): Promise<RecordedDrafts> {
  if (!draftsMemo) {
    const file = path.join(process.cwd(), "fixtures", "listing-drafts.json");
    draftsMemo = JSON.parse(await fs.readFile(file, "utf8")) as RecordedDrafts;
  }
  return draftsMemo;
}

export function sellerPrivate(listingId: string, floorCents: number, now = new Date()): ListingPrivate {
  return {
    listingId,
    floorCents,
    mandate: issueMandate({ role: "seller", owner: SELLER.name, listingId, limitCents: floorCents, ttlHours: SELLER_MANDATE_TTL_HOURS, now }, env.mandateSecret),
  };
}

export async function buildDemoListings(now = new Date()): Promise<{ listings: Listing[]; privates: ListingPrivate[] }> {
  const drafts = await recordedDrafts();
  const listings: Listing[] = [];
  const privates: ListingPrivate[] = [];
  for (const item of DEMO_ITEMS) {
    const d = drafts[item.key];
    if (!d) throw new Error(`fixtures/listing-drafts.json has no entry for "${item.key}".`);
    const suggestion: PriceSuggestion = { lowCents: d.price.lowCents, highCents: d.price.highCents, basis: d.price.basis, ai: { ...d.price.ai, replayed: true } };
    listings.push({
      id: item.listingId,
      sellerName: SELLER.name,
      title: d.title,
      category: d.category,
      description: d.description,
      conditionGrade: d.conditionGrade,
      facts: d.facts,
      extras: item.extras,
      photos: item.photos,
      photoCredit: d.photoCredit,
      askingCents: item.askingCents,
      suggestion,
      area: SELLER.area,
      pickupWindows: upcomingPickupWindows(now),
      prefs: { bundlesOk: item.bundlesOk, noCash: true },
      status: "active",
      ai: { ...d.ai, replayed: true },
      createdAt: new Date(now.getTime() - 36 * 3600_000).toISOString(),
      seeded: true,
    });
    privates.push(sellerPrivate(item.listingId, item.floorCents, now));
  }
  return { listings, privates };
}

export function demoWant(now = new Date()): { want: Want; priv: WantPrivate } {
  return {
    want: {
      id: DEMO_WANT.id,
      buyerName: BUYER.name,
      text: DEMO_WANT.text,
      parsed: { category: "kids bike", keywords: ["kids", "bike", "6-year-old"], when: "this weekend", area: "the Mission" },
      createdAt: new Date(now.getTime() - 3600_000).toISOString(),
      seeded: true,
    },
    priv: { wantId: DEMO_WANT.id, ceilingCents: DEMO_WANT.ceilingCents },
  };
}

/** First visit on an empty store: create the listings and the want (no PayPal calls). */
export async function ensureDemoWorld(): Promise<void> {
  const existing = await store().list("listings/");
  if (existing.length > 0) return;
  const snapshot = await store().get<Snapshot>(keys.seedSnapshot());
  if (snapshot) {
    await restore(snapshot);
    return;
  }
  const { listings, privates } = await buildDemoListings();
  for (const l of listings) await saveListing(l);
  for (const p of privates) await saveListingPrivate(p);
  const { want, priv } = demoWant();
  await saveWant(want);
  await saveWantPrivate(priv);
}

/**
 * Keeps a seeded listing usable long after the seed ran: pickup windows roll forward to the coming
 * weekend, and the seller's mandate is re-issued before it expires.
 */
export async function freshenListing(listing: Listing, now = new Date()): Promise<Listing> {
  if (listing.status !== "active") return listing;
  let changed = false;
  const earliestEnd = Math.min(...listing.pickupWindows.map((w) => new Date(w.endsAt).getTime()));
  if (listing.seeded && (!Number.isFinite(earliestEnd) || earliestEnd < now.getTime())) {
    listing.pickupWindows = upcomingPickupWindows(now);
    changed = true;
  }
  const priv = await getListingPrivate(listing.id);
  if (priv) {
    const check = verifyMandate(priv.mandate, env.mandateSecret, { role: "seller", listingId: listing.id, now: new Date(now.getTime() + 24 * 3600_000) });
    if (!check.ok) await saveListingPrivate(sellerPrivate(listing.id, priv.floorCents, now));
  }
  if (changed) await saveListing(listing);
  return listing;
}

/* -------------------------------------------------------- snapshot/reset */

export interface Snapshot {
  createdAt: string;
  listings: Listing[];
  floors: { listingId: string; floorCents: number }[];
  wants: Want[];
  wantPrivates: WantPrivate[];
  deals: Deal[];
}

const PREFIXES = ["listings/", "listings-private/", "wants/", "wants-private/", "deals/", "claims/"];

/** Captures the current seeded state so a reset can bring it back. Called by `pnpm seed`. */
export async function writeSnapshot(deals: Deal[]): Promise<Snapshot> {
  const listings = (await listListings()).filter((l) => l.seeded);
  const floors: Snapshot["floors"] = [];
  for (const l of listings) {
    const p = await getListingPrivate(l.id);
    if (p) floors.push({ listingId: l.id, floorCents: p.floorCents });
  }
  const { want, priv } = demoWant();
  const snapshot: Snapshot = { createdAt: new Date().toISOString(), listings, floors, wants: [want], wantPrivates: [priv], deals };
  await store().set(keys.seedSnapshot(), snapshot);
  return snapshot;
}

async function wipe(): Promise<number> {
  let removed = 0;
  for (const prefix of PREFIXES) {
    for (const key of await store().list(prefix)) {
      await store().delete(key);
      removed++;
    }
  }
  return removed;
}

async function restore(snapshot: Snapshot, now = new Date()): Promise<void> {
  for (const listing of snapshot.listings) {
    const fresh: Listing = listing.status === "active" ? { ...listing, pickupWindows: upcomingPickupWindows(now) } : listing;
    await saveListing(fresh);
  }
  for (const f of snapshot.floors) await saveListingPrivate(sellerPrivate(f.listingId, f.floorCents, now));
  for (const w of snapshot.wants) await saveWant(w);
  for (const p of snapshot.wantPrivates) await saveWantPrivate(p);
  for (const d of snapshot.deals) await store().set(keys.deal(d.id), d);
}

/** Restores the seeded demo state. Deals made by visitors are removed; seeded history comes back. */
export async function resetToSeed(): Promise<{ removed: number; listings: number; deals: number; fromSnapshot: boolean }> {
  const snapshot = await store().get<Snapshot>(keys.seedSnapshot());
  const removed = await wipe();
  if (snapshot) {
    await restore(snapshot);
    return { removed, listings: snapshot.listings.length, deals: snapshot.deals.length, fromSnapshot: true };
  }
  await ensureDemoWorld();
  return { removed, listings: DEMO_ITEMS.length, deals: 0, fromSnapshot: false };
}

export async function getFreshListing(id: string): Promise<Listing | null> {
  const listing = await getListing(id);
  return listing ? freshenListing(listing) : null;
}
