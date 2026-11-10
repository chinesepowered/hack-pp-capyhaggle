import { createDeal } from "@/lib/deals";
import { body, json, modeFrom, route } from "@/lib/http";
import { RuleError } from "@/lib/paypal/errors";
import { createReplayDeal } from "@/lib/replay";
import { getWantPrivate, saveDeal } from "@/lib/repo";
import { getFreshListing } from "@/lib/world";

export const dynamic = "force-dynamic";

/** Start a haggle: the buyer gives Barley a signed mandate (private ceiling, pickup windows). */
export const POST = route(async (req: Request) => {
  const b = await body<{ listingId?: string; ceilingCents?: number; pickupWindowIds?: string[]; wantId?: string; mode?: string }>(req);
  if (modeFrom(b.mode) === "replay") {
    const deal = await createReplayDeal();
    return json({ id: deal.id, mode: "replay" });
  }
  if (!b.listingId) throw new RuleError("LISTING_REQUIRED", "Pick a listing first.", 400);
  const listing = await getFreshListing(b.listingId);
  if (!listing) throw new RuleError("LISTING_NOT_FOUND", "That listing does not exist.", 404);
  let ceiling = Number(b.ceilingCents);
  if (!Number.isFinite(ceiling) && b.wantId) ceiling = (await getWantPrivate(b.wantId))?.ceilingCents ?? Number.NaN;
  const deal = await createDeal({
    listing,
    ceilingCents: Math.round(ceiling),
    pickupWindowIds: Array.isArray(b.pickupWindowIds) ? b.pickupWindowIds.filter((x) => typeof x === "string") : [],
    wantId: b.wantId,
  });
  await saveDeal(deal);
  return json({ id: deal.id, mode: "live" });
});
