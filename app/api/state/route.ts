import { env } from "@/lib/env";
import { json, route } from "@/lib/http";
import { isReplayListing } from "@/lib/replay";
import { getWantPrivate, listDeals, listListings, listWants } from "@/lib/repo";
import { storeKind } from "@/lib/store";
import { dealCard } from "@/lib/views";
import { ensureDemoWorld, freshenListing } from "@/lib/world";

export const dynamic = "force-dynamic";

/** Everything the home screen needs: the shelf of listings, Maya's want, and recent deals. */
export const GET = route(async () => {
  await ensureDemoWorld();
  const all = await listListings();
  const listings = [];
  for (const l of all) {
    if (isReplayListing(l)) continue;
    listings.push(await freshenListing(l));
  }
  const wants = await listWants();
  const wantCeilings: Record<string, number> = {};
  for (const w of wants) {
    const p = await getWantPrivate(w.id);
    if (p) wantCeilings[w.id] = p.ceilingCents;
  }
  const deals = await listDeals();
  const byId = new Map(all.map((l) => [l.id, l]));
  return json({
    listings,
    wants,
    // Maya's own ceilings. This demo has no logins, so the buyer view simply asks for them.
    wantCeilings,
    deals: deals.slice(0, 30).map((d) => dealCard(d, byId.get(d.listingId) ?? null)),
    config: {
      store: storeKind(),
      models: { chat: env.model, vision: env.visionModel, fallback: env.fallbackModel },
      webhookConfigured: Boolean(env.paypalWebhookId),
      paypalClientId: process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? "",
    },
  });
});
