/** Typed accessors over lib/store.ts. Keys: listings/, listings-private/, wants/, wants-private/, deals/. */
import { store } from "./store";
import type { Deal, Listing, ListingPrivate, Want, WantPrivate } from "./types";

export const keys = {
  listing: (id: string) => `listings/${id}`,
  listingPrivate: (id: string) => `listings-private/${id}`,
  want: (id: string) => `wants/${id}`,
  wantPrivate: (id: string) => `wants-private/${id}`,
  deal: (id: string) => `deals/${id}`,
  claim: (dealId: string, what: string) => `claims/${dealId}/${what}`,
  webhookEvent: (id: string) => `webhook-events/${id}`,
  seedSnapshot: () => "seed/snapshot",
  seedManifest: () => "seed/manifest",
};

export const getListing = (id: string) => store().get<Listing>(keys.listing(id));
export const saveListing = (l: Listing) => store().set(keys.listing(l.id), l);
export const getListingPrivate = (id: string) => store().get<ListingPrivate>(keys.listingPrivate(id));
export const saveListingPrivate = (p: ListingPrivate) => store().set(keys.listingPrivate(p.listingId), p);

export const getWant = (id: string) => store().get<Want>(keys.want(id));
export const saveWant = (w: Want) => store().set(keys.want(w.id), w);
export const getWantPrivate = (id: string) => store().get<WantPrivate>(keys.wantPrivate(id));
export const saveWantPrivate = (p: WantPrivate) => store().set(keys.wantPrivate(p.wantId), p);

export const getDeal = (id: string) => store().get<Deal>(keys.deal(id));
export const saveDeal = (d: Deal) => store().set(keys.deal(d.id), d);

async function loadAll<T>(prefix: string): Promise<T[]> {
  const ids = await store().list(prefix);
  const docs = await Promise.all(ids.map((k) => store().get<T>(k)));
  return docs.filter((d): d is Awaited<T> & T => d !== null);
}

export async function listListings(): Promise<Listing[]> {
  const all = await loadAll<Listing>("listings/");
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function listWants(): Promise<Want[]> {
  const all = await loadAll<Want>("wants/");
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function listDeals(): Promise<Deal[]> {
  const all = await loadAll<Deal>("deals/");
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Atomic create-if-absent claim for a PayPal write (see paypal-plan.md, DUPLICATE CLAIMS). */
export async function claimWrite(dealId: string, what: string): Promise<boolean> {
  return store().claim(keys.claim(dealId, what), { at: new Date().toISOString() });
}

/** Released when PayPal refuses the write, so a later legitimate attempt is not blocked. */
export async function releaseWrite(dealId: string, what: string): Promise<void> {
  await store().delete(keys.claim(dealId, what));
}
