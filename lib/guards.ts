/**
 * Guards around every agent tool that touches PayPal. The model proposes a tool call; these pure
 * functions decide, in code, whether PayPal is called at all. An agent cannot create an order
 * outside its mandate, read another deal's order, or refund more than was captured.
 */
import { dollarsToCents } from "./money";
import { dealWithinBothMandates, type RefereeListing } from "./referee";
import type { Deal } from "./types";

export type GuardResult<T> = { ok: true; value: T } | { ok: false; code: string; detail: string };

const deny = (code: string, detail: string) => ({ ok: false as const, code, detail });

export const REFUND_WINDOW_MS = 24 * 3600_000;

/** create_held_order: only the agreed price, only this listing, only when both humans accepted. */
export function guardCreateHold(
  deal: Deal,
  listing: RefereeListing,
  args: { amount_usd?: unknown; listing_id?: unknown },
  secret: string,
  now = new Date(),
): GuardResult<{ amountCents: number }> {
  if (deal.status !== "agreed" || !deal.agreed) return deny("NO_AGREED_DEAL", "There is no agreed deal to pay for.");
  if (!deal.accepts.buyer || !deal.accepts.seller) return deny("HUMANS_NOT_ACCEPTED", "Both owners must tap Accept before any money step.");
  if (args.listing_id !== deal.listingId || listing.id !== deal.listingId) {
    return deny("WRONG_ITEM", "The order is for a different listing than this deal.");
  }
  const amount = typeof args.amount_usd === "number" ? args.amount_usd : Number.NaN;
  if (!Number.isFinite(amount) || amount <= 0) return deny("BAD_AMOUNT", "The amount must be a positive number of dollars.");
  const amountCents = dollarsToCents(amount);
  if (amountCents !== deal.agreed.offer.priceCents) {
    return deny("AMOUNT_NOT_AGREED", "The amount is not the price both sides agreed.");
  }
  const within = dealWithinBothMandates(listing, deal.agreed.offer, deal.mandates, secret, now);
  if (!within.ok) return deny(within.violations[0].code, within.violations[0].detail);
  return { ok: true, value: { amountCents } };
}

/** get_order: an agent may only read its own deal's order. */
export function guardGetOrder(deal: Deal, args: { id?: unknown }): GuardResult<{ id: string }> {
  if (!deal.payment.orderId) return deny("NO_ORDER", "This deal has no PayPal order yet.");
  if (args.id !== deal.payment.orderId) return deny("NOT_YOUR_ORDER", "An agent can only read the order of its own deal.");
  return { ok: true, value: { id: deal.payment.orderId } };
}

/** create_refund: only this deal's capture, within 24 hours, never more than was captured. */
export function guardRefund(
  deal: Deal,
  args: { capture_id?: unknown; amount?: unknown },
  now = new Date(),
): GuardResult<{ captureId: string; amountCents: number }> {
  if (deal.status !== "completed" || !deal.payment.captureId || !deal.payment.capturedAt || !deal.agreed) {
    return deny("NOT_REFUNDABLE", "Only a completed handoff can be refunded.");
  }
  if (args.capture_id !== deal.payment.captureId) return deny("NOT_YOUR_CAPTURE", "An agent can only refund the capture of its own deal.");
  if (deal.payment.refundId) return deny("ALREADY_REFUNDED", "This deal was already refunded.");
  if (now.getTime() - new Date(deal.payment.capturedAt).getTime() > REFUND_WINDOW_MS) {
    return deny("REFUND_WINDOW_CLOSED", "Problems must be reported within 24 hours of pickup.");
  }
  const captured = deal.agreed.offer.priceCents;
  let amountCents = captured;
  if (args.amount !== undefined && args.amount !== null) {
    const a = args.amount as { currency_code?: unknown; value?: unknown };
    if (a.currency_code !== "USD" || typeof a.value !== "string" || !/^\d+(\.\d{1,2})?$/.test(a.value)) {
      return deny("BAD_AMOUNT", "The refund amount must be a USD amount.");
    }
    amountCents = Math.round(parseFloat(a.value) * 100);
  }
  if (amountCents <= 0 || amountCents > captured) return deny("REFUND_TOO_LARGE", "A refund cannot be more than what was captured.");
  return { ok: true, value: { captureId: deal.payment.captureId, amountCents } };
}
