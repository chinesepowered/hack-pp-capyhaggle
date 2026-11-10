import QRCode from "qrcode";
import {
  acceptDeal,
  authorizeHold,
  completeHandoff,
  ensureSummary,
  humanMessage,
  humanWalk,
  issuePickupQr,
  refundBuyer,
  setPaused,
  stepDeal,
  verifyHoldStep,
  voidHold,
} from "@/lib/deals";
import { body, json, limitAi, roleFrom, route } from "@/lib/http";
import { logCall } from "@/lib/paypal/core";
import { RuleError } from "@/lib/paypal/errors";
import { withDeal } from "@/lib/runner";
import { dealView } from "@/lib/views";

export const dynamic = "force-dynamic";
// A haggle step is one model call plus retries; money steps are a few PayPal calls.
export const maxDuration = 60;

type Body = {
  as?: string;
  text?: string;
  paused?: boolean;
  token?: string;
  via?: string;
  reason?: string;
  demoFastForward?: boolean;
  step?: string;
  detail?: string;
};

const JS_SDK_STEPS: Record<string, { method: string; path: string; note: string }> = {
  loaded: { method: "GET", path: "https://www.sandbox.paypal.com/web-sdk/v6/core", note: "JS SDK v6 script loaded in the buyer's browser" },
  instance: { method: "SDK", path: "paypal.createInstance({ clientId, components: ['paypal-payments'] })", note: "JS SDK v6 instance created" },
  eligible: { method: "SDK", path: "sdkInstance.findEligibleMethods({ currencyCode: 'USD' })", note: "PayPal is eligible for this buyer" },
  started: { method: "SDK", path: "createPayPalOneTimePaymentSession().start({ presentationMode: 'auto' }, { orderId })", note: "PayPal approval window opened" },
  approved: { method: "SDK", path: "onApprove({ orderId })", note: "The buyer approved in PayPal's window" },
  cancelled: { method: "SDK", path: "onCancel()", note: "The buyer closed PayPal's window" },
  error: { method: "SDK", path: "onError(error)", note: "JS SDK reported an error" },
};

/** Every deal action is a POST to /api/deals/{id}/{action}. Each answers with the caller's fresh view. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string; action: string }> }) => {
  const { id, action } = await ctx.params;
  const b = await body<Body>(req);
  const viewer = roleFrom(b.as ?? new URL(req.url).searchParams.get("as"));
  let extra: Record<string, unknown> = {};

  const run = await withDeal(id, action, async (deal, listing) => {
    switch (action) {
      case "step":
        limitAi(req);
        await stepDeal(deal, listing);
        return;
      case "pause":
        setPaused(deal, Boolean(b.paused), viewer);
        return;
      case "message": {
        limitAi(req);
        const res = await humanMessage(deal, viewer, String(b.text ?? ""));
        extra = { flagged: res.flagged };
        return;
      }
      case "walk":
        humanWalk(deal, viewer);
        return;
      case "summary":
        limitAi(req);
        await ensureSummary(deal, listing);
        return;
      case "accept":
        await acceptDeal(deal, listing, viewer);
        return;
      case "authorize":
        await authorizeHold(deal, listing);
        return;
      case "verify":
        await verifyHoldStep(deal);
        return;
      case "qr": {
        if (viewer !== "buyer") throw new RuleError("BUYER_ONLY", "Only the buyer can show the pickup code.", 403);
        const qr = issuePickupQr(deal);
        const svg = await QRCode.toString(qr.token, { type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: "#2a1f17", light: "#ffffff" } });
        extra = { qr: { token: qr.token, expiresAt: qr.expiresAt, svg } };
        return;
      }
      case "scan": {
        if (viewer !== "seller") throw new RuleError("SELLER_ONLY", "Only the seller scans the pickup code.", 403);
        const via = b.via === "camera" || b.via === "paste" ? b.via : "simulated";
        await completeHandoff(deal, listing, String(b.token ?? ""), via);
        return;
      }
      case "void": {
        if (viewer !== "seller") throw new RuleError("SELLER_ONLY", "Only the seller can report a no-show.", 403);
        const ended = deal.agreed ? Date.now() > new Date(deal.agreed.pickupEndsAt).getTime() : false;
        if (!ended && !b.demoFastForward) {
          throw new RuleError("WINDOW_STILL_OPEN", "The pickup window has not ended yet. The hold is released automatically if the buyer does not show.");
        }
        await voidHold(
          deal,
          listing,
          ended ? `${deal.buyerName} did not show by the end of the pickup window.` : `Demo fast-forward: the pickup window ended and ${deal.buyerName} did not show.`,
        );
        return;
      }
      case "refund":
        if (viewer !== "buyer") throw new RuleError("BUYER_ONLY", "Only the buyer can report a problem.", 403);
        limitAi(req);
        await refundBuyer(deal, listing, String(b.reason ?? "The item was not as described."));
        return;
      case "sdk-event": {
        // The browser reports what the JS SDK did, so the drawer shows the whole PayPal story.
        const s = JS_SDK_STEPS[String(b.step ?? "")];
        if (s) logCall({ method: s.method, path: s.path, status: b.step === "error" ? 0 : 200, via: "js-sdk", ms: 0, feature: "Pay: buyer approval (JS SDK v6)", note: b.detail ? `${s.note}: ${String(b.detail).slice(0, 120)}` : s.note });
        return;
      }
      default:
        throw new RuleError("UNKNOWN_ACTION", `Unknown action "${action}".`, 404);
    }
  });

  return json({ deal: dealView(run.deal, run.listing, viewer), ...extra });
});
