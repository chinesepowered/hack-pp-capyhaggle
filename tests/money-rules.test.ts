import { describe, expect, it } from "vitest";
import { scamRuleHits } from "@/lib/agents/scam";
import { guardCreateHold, guardGetOrder, guardRefund } from "@/lib/guards";
import { canonicalJson, issueMandate, priceWithinMandate, signMandate, verifyMandate } from "@/lib/mandate";
import { feeFor, formatUsd, formatUsdExact, fromPayPalValue, sellerNetFor, toPayPalValue } from "@/lib/money";
import { PayPalApiError, PayPalUnknownOutcomeError, PayPalUnreachableError, RuleError, toClientError } from "@/lib/paypal/errors";
import { buildHoldOrderRequest } from "@/lib/paypal/orders";
import { buildPayoutBody } from "@/lib/paypal/payouts";
import { dealIdFromEvent } from "@/lib/paypal/webhooks";
import { checkQrAgainstDeal, issueQr, signQr, verifyQr } from "@/lib/qr";
import { agreedDeal, buyerMandate, listing, NOW, SECRET } from "./helpers";

describe("money: cents, fee and PayPal amounts", () => {
  it("charges 5% plus 50 cents and pays the seller the rest", () => {
    expect(feeFor(8200)).toBe(460);
    expect(sellerNetFor(8200)).toBe(7740);
    expect(feeFor(100)).toBe(55);
    expect(feeFor(9800) + sellerNetFor(9800)).toBe(9800);
  });

  it("converts to and from PayPal's decimal strings exactly", () => {
    expect(toPayPalValue(8200)).toBe("82.00");
    expect(toPayPalValue(7740)).toBe("77.40");
    expect(fromPayPalValue("82.00")).toBe(8200);
    expect(fromPayPalValue("3.35")).toBe(335);
    expect(() => fromPayPalValue("82,00")).toThrow();
    expect(() => toPayPalValue(82.5)).toThrow();
  });

  it("formats for people", () => {
    expect(formatUsd(8200)).toBe("$82");
    expect(formatUsd(7740)).toBe("$77.40");
    expect(formatUsdExact(8200)).toBe("$82.00");
  });
});

describe("mandates: signed JSON with a limit, an item scope and an expiry", () => {
  it("verifies its own signature and nothing else", () => {
    const signed = buyerMandate();
    expect(verifyMandate(signed, SECRET, { role: "buyer", listingId: listing.id, now: NOW }).ok).toBe(true);
    expect(verifyMandate(signed, "wrong", { role: "buyer", listingId: listing.id, now: NOW }).ok).toBe(false);
    expect(verifyMandate(undefined, SECRET, { role: "buyer", listingId: listing.id, now: NOW }).ok).toBe(false);
  });

  it("signs canonical JSON, so key order does not matter", () => {
    const m = buyerMandate().mandate;
    const shuffled = Object.fromEntries(Object.entries(m).reverse()) as typeof m;
    expect(canonicalJson(shuffled)).toBe(canonicalJson(m));
    expect(signMandate(shuffled, SECRET).sig).toBe(signMandate(m, SECRET).sig);
  });

  it("knows which side of the limit a price is on", () => {
    const buyer = buyerMandate(9000).mandate;
    expect(priceWithinMandate(buyer, 9000)).toBe(true);
    expect(priceWithinMandate(buyer, 9001)).toBe(false);
    const seller = issueMandate({ role: "seller", owner: "Theo", listingId: listing.id, limitCents: 7500, now: NOW }, SECRET).mandate;
    expect(priceWithinMandate(seller, 7500)).toBe(true);
    expect(priceWithinMandate(seller, 7499)).toBe(false);
  });
});

describe("guards: an agent cannot move money outside its mandate", () => {
  it("lets Barley create the hold only for the exact agreed terms", () => {
    const deal = agreedDeal(82);
    expect(guardCreateHold(deal, listing, { amount_usd: 82, listing_id: listing.id }, SECRET, NOW)).toEqual({ ok: true, value: { amountCents: 8200 } });
    expect(guardCreateHold(deal, listing, { amount_usd: 80, listing_id: listing.id }, SECRET, NOW)).toMatchObject({ ok: false, code: "AMOUNT_NOT_AGREED" });
    expect(guardCreateHold(deal, listing, { amount_usd: 82, listing_id: "lst_table" }, SECRET, NOW)).toMatchObject({ ok: false, code: "WRONG_ITEM" });
    expect(guardCreateHold(deal, listing, { amount_usd: "82", listing_id: listing.id }, SECRET, NOW)).toMatchObject({ ok: false, code: "BAD_AMOUNT" });
  });

  it("refuses an order above the buyer's ceiling even if a deal record says so", () => {
    const deal = agreedDeal(95);
    expect(guardCreateHold(deal, listing, { amount_usd: 95, listing_id: listing.id }, SECRET, NOW)).toMatchObject({ ok: false, code: "OVER_CEILING" });
  });

  it("refuses an order until both humans have accepted", () => {
    const deal = agreedDeal(82, { accepts: { buyer: NOW.toISOString() } });
    expect(guardCreateHold(deal, listing, { amount_usd: 82, listing_id: listing.id }, SECRET, NOW)).toMatchObject({ ok: false, code: "HUMANS_NOT_ACCEPTED" });
  });

  it("refuses an order when a mandate has expired", () => {
    const later = new Date(NOW.getTime() + 80 * 3600_000);
    expect(guardCreateHold(agreedDeal(82), listing, { amount_usd: 82, listing_id: listing.id }, SECRET, later)).toMatchObject({ ok: false, code: "MANDATE_EXPIRED" });
  });

  it("lets an agent read only its own deal's order", () => {
    const deal = agreedDeal(82, { payment: { orderId: "ORDER123" } });
    expect(guardGetOrder(deal, { id: "ORDER123" }).ok).toBe(true);
    expect(guardGetOrder(deal, { id: "SOMEONE-ELSES" })).toMatchObject({ ok: false, code: "NOT_YOUR_ORDER" });
  });

  it("refunds only this deal's capture, within 24 hours, never more than captured", () => {
    const capturedAt = NOW.toISOString();
    const deal = agreedDeal(82, { status: "completed", payment: { captureId: "CAP1", capturedAt } });
    const soon = new Date(NOW.getTime() + 3600_000);
    expect(guardRefund(deal, { capture_id: "CAP1" }, soon)).toEqual({ ok: true, value: { captureId: "CAP1", amountCents: 8200 } });
    expect(guardRefund(deal, { capture_id: "CAP2" }, soon)).toMatchObject({ ok: false, code: "NOT_YOUR_CAPTURE" });
    expect(guardRefund(deal, { capture_id: "CAP1", amount: { currency_code: "USD", value: "90.00" } }, soon)).toMatchObject({ ok: false, code: "REFUND_TOO_LARGE" });
    expect(guardRefund(deal, { capture_id: "CAP1" }, new Date(NOW.getTime() + 25 * 3600_000))).toMatchObject({ ok: false, code: "REFUND_WINDOW_CLOSED" });
    expect(guardRefund(agreedDeal(82, { status: "held" }), { capture_id: "CAP1" }, soon)).toMatchObject({ ok: false, code: "NOT_REFUNDABLE" });
  });
});

describe("pickup QR: signed, single use, expiring", () => {
  const QR_SECRET = "test-qr-secret";

  it("verifies a fresh code for the right deal", () => {
    const { token, payload } = issueQr("dl_test", QR_SECRET, NOW);
    const check = verifyQr(token, QR_SECRET, NOW);
    expect(check.ok).toBe(true);
    expect(checkQrAgainstDeal(payload, { id: "dl_test", handoff: { nonce: payload.n } }).ok).toBe(true);
  });

  it("refuses an expired code", () => {
    const { token } = issueQr("dl_test", QR_SECRET, NOW, 600);
    expect(verifyQr(token, QR_SECRET, new Date(NOW.getTime() + 601_000))).toMatchObject({ ok: false, code: "QR_EXPIRED" });
  });

  it("refuses a tampered or forged code", () => {
    const { token, payload } = issueQr("dl_test", QR_SECRET, NOW);
    const [prefix, , sig] = token.split(".");
    const otherBody = Buffer.from(JSON.stringify({ ...payload, d: "dl_other" })).toString("base64url");
    expect(verifyQr(`${prefix}.${otherBody}.${sig}`, QR_SECRET, NOW)).toMatchObject({ ok: false, code: "QR_BAD_SIGNATURE" });
    expect(verifyQr(signQr(payload, "attacker-secret"), QR_SECRET, NOW)).toMatchObject({ ok: false, code: "QR_BAD_SIGNATURE" });
    expect(verifyQr("not a code", QR_SECRET, NOW)).toMatchObject({ ok: false, code: "QR_MALFORMED" });
  });

  it("is single use and tied to one deal", () => {
    const { payload } = issueQr("dl_test", QR_SECRET, NOW);
    expect(checkQrAgainstDeal(payload, { id: "dl_test", handoff: { nonce: payload.n, usedAt: NOW.toISOString() } })).toMatchObject({ ok: false, code: "QR_ALREADY_USED" });
    expect(checkQrAgainstDeal(payload, { id: "dl_other", handoff: { nonce: payload.n } })).toMatchObject({ ok: false, code: "QR_WRONG_DEAL" });
    expect(checkQrAgainstDeal(payload, { id: "dl_test", handoff: { nonce: "a-newer-nonce" } })).toMatchObject({ ok: false, code: "QR_SUPERSEDED" });
  });
});

describe("PayPal requests carry only what the plan requires", () => {
  it("builds the hold order with intent AUTHORIZE and the deal id as custom_id", () => {
    const req = buildHoldOrderRequest({ dealId: "dl_test", requestId: "r", amountCents: 8200, title: "Kids bike", description: "Kids bike, local pickup", returnUrl: "https://x/return", cancelUrl: "https://x/cancel" });
    expect(req.intent).toBe("AUTHORIZE");
    expect(req.purchaseUnits[0].amount.value).toBe("82.00");
    expect(req.purchaseUnits[0].customId).toBe("dl_test");
    expect(req.paymentSource?.paypal?.experienceContext?.shippingPreference).toBe("NO_SHIPPING");
    // Nothing the plan does not ask for.
    expect(Object.keys(req).sort()).toEqual(["intent", "paymentSource", "purchaseUnits"]);
  });

  it("builds a single-item payout with deal-derived ids", () => {
    const body = buildPayoutBody({ senderBatchId: "cvc-dl-x-payout", senderItemId: "cvc-dl-x-item", receiverEmail: "seller@example.com", amountCents: 7740, note: "n", emailSubject: "s", emailMessage: "m" });
    expect(body.sender_batch_header.sender_batch_id).toBe("cvc-dl-x-payout");
    expect(body.items).toHaveLength(1);
    expect(body.items[0].amount).toEqual({ value: "77.40", currency: "USD" });
    expect(body.items[0].recipient_type).toBe("EMAIL");
  });

  it("finds the deal for a webhook event", () => {
    expect(dealIdFromEvent({ id: "e1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { custom_id: "dl_abc" } })).toBe("dl_abc");
    expect(dealIdFromEvent({ id: "e2", event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", resource: { payout_item: { sender_item_id: "cvc-dl_abc-9rktyq-item" } } })).toBe("dl_abc");
    expect(dealIdFromEvent({ id: "e3", event_type: "X", resource: {} })).toBeUndefined();
  });
});

describe("when PayPal says no: one ladder for every route", () => {
  it("passes a caller-caused 4xx through with PayPal's reason and debug id", () => {
    const err = new PayPalApiError(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "INSTRUMENT_DECLINED", description: "The instrument presented was declined." }], debug_id: "abc" }, "abc", "orders.authorize");
    expect(toClientError(err)).toMatchObject({ status: 422, code: "INSTRUMENT_DECLINED", debugId: "abc" });
    expect(toClientError(err).message).toContain("declined");
  });

  it("turns our own credential and quota problems into 5xx, not the caller's fault", () => {
    expect(toClientError(new PayPalApiError(401, { error: "invalid_client" }, "d1", "oauth token"))).toMatchObject({ status: 502, code: "PAYPAL_CREDENTIALS" });
    expect(toClientError(new PayPalApiError(403, { name: "NOT_AUTHORIZED" }, "d2", "payouts.create"))).toMatchObject({ status: 502 });
    expect(toClientError(new PayPalApiError(429, { name: "RATE_LIMIT_REACHED" }, "d3", "orders.create"))).toMatchObject({ status: 503 });
    expect(toClientError(new PayPalApiError(500, {}, "d4", "orders.create"))).toMatchObject({ status: 502 });
  });

  it("never reports an unknown outcome as a failure", () => {
    expect(toClientError(new PayPalUnknownOutcomeError("authorizations.capture"))).toMatchObject({ status: 202, code: "PAYPAL_OUTCOME_UNKNOWN" });
    expect(toClientError(new PayPalUnreachableError("orders.get"))).toMatchObject({ status: 502 });
    expect(toClientError(new RuleError("QR_EXPIRED", "expired", 400))).toMatchObject({ status: 400, code: "QR_EXPIRED" });
    expect(toClientError(new Error("boom"))).toMatchObject({ status: 500 });
  });
});

describe("scam rules: deterministic patterns", () => {
  it("flags the two patterns from the brief", () => {
    expect(scamRuleHits("Pay a deposit by gift card and I will hold it").map((h) => h.id)).toEqual(expect.arrayContaining(["gift-card", "advance-deposit"]));
    expect(scamRuleHits("I'll send a courier, just pay the shipping").map((h) => h.id)).toContain("courier");
  });

  it("flags other off-platform and phishing patterns", () => {
    expect(scamRuleHits("Can you Zelle me instead?").map((h) => h.id)).toContain("off-platform");
    expect(scamRuleHits("I overpaid, please refund the difference").map((h) => h.id)).toContain("overpayment");
    expect(scamRuleHits("Send me the 6-digit code you just got").map((h) => h.id)).toContain("code-or-link");
  });

  it("leaves ordinary haggling alone", () => {
    for (const text of ["Could you do $80 if I pick up Saturday?", "Is the helmet included?", "Can we meet at 10 instead of 11?"]) {
      expect(scamRuleHits(text)).toEqual([]);
    }
  });
});
