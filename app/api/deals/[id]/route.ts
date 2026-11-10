import { refreshFromPayPal } from "@/lib/deals";
import { json, roleFrom, route } from "@/lib/http";
import { RuleError } from "@/lib/paypal/errors";
import { getDeal, getDealListing } from "@/lib/repo";
import { withDeal } from "@/lib/runner";
import { ReplayMissError } from "@/lib/tape";
import { dealView } from "@/lib/views";

export const dynamic = "force-dynamic";

const MONEY_STATES = new Set(["awaiting_payment", "held", "completed"]);

/**
 * The deal as one side sees it. With ?refresh=1 the money state is re-read from PayPal first, so
 * every screen works without a webhook ever arriving.
 */
export const GET = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const viewer = roleFrom(url.searchParams.get("as"));
  let deal = await getDeal(id);
  if (!deal) throw new RuleError("DEAL_NOT_FOUND", "That deal does not exist.", 404);
  let listing = await getDealListing(deal);
  if (!listing) throw new RuleError("LISTING_NOT_FOUND", "The listing for this deal is gone.", 404);

  const payoutPending = deal.status === "completed" && deal.payment.payoutItemStatus !== "SUCCESS";
  const wantsRefresh = url.searchParams.get("refresh") === "1" && MONEY_STATES.has(deal.status) && (deal.status !== "completed" || payoutPending);
  if (wantsRefresh) {
    try {
      ({ deal, listing } = await withDeal(id, "Refresh: re-read PayPal status", async (d, l) => {
        // Replay has a finite recording: only the payout status check is replayed.
        if (d.mode === "replay" && !payoutPending) return;
        await refreshFromPayPal(d, l);
      }));
    } catch (err) {
      if (!(err instanceof ReplayMissError)) console.warn("[refresh]", err instanceof Error ? err.message : err);
      deal = (await getDeal(id)) ?? deal;
    }
  }
  return json(dealView(deal, listing, viewer));
});
