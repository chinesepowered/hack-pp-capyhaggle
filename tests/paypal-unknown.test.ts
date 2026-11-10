/**
 * Unknown outcomes (paypal-plan.md): a write that got no answer is settled by a re-read or by
 * repeating it with the same idempotency reference. It is never reported as "failed", and a write
 * that never left is not re-read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = {
  orders: { createOrder: vi.fn(), getOrder: vi.fn(), authorizeOrder: vi.fn() },
  payments: { getAuthorizedPayment: vi.fn(), captureAuthorizedPayment: vi.fn(), voidPayment: vi.fn(), getCapturedPayment: vi.fn(), reauthorizePayment: vi.fn() },
};

vi.mock("@/lib/paypal/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paypal/core")>();
  return { ...actual, sdk: () => fake };
});

import { PayPalApiError, PayPalUnknownOutcomeError } from "@/lib/paypal/errors";
import { authorizeOrder, createHoldOrder } from "@/lib/paypal/orders";
import { captureAuthorization, voidAuthorization } from "@/lib/paypal/payments";
import { createPayout } from "@/lib/paypal/payouts";

const ok = <T>(result: T, statusCode = 200) => ({ statusCode, headers: { "paypal-debug-id": "dbg" }, result, request: { url: "https://api-m.sandbox.paypal.com/x" }, body: "" });
const network = () => Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
const apiError = (statusCode: number, issue: string) => ({ statusCode, headers: {}, result: { name: "UNPROCESSABLE_ENTITY", details: [{ issue }] }, request: { url: "https://api-m.sandbox.paypal.com/x" } });

const holdInput = { dealId: "dl_t", requestId: "cvc-dl_t-s-order", amountCents: 8200, title: "Bike", description: "Bike", returnUrl: "https://a/r", cancelUrl: "https://a/c" };
const heldOrder = { id: "ORD1", status: "COMPLETED", purchaseUnits: [{ amount: { currencyCode: "USD", value: "82.00" }, payments: { authorizations: [{ id: "AUTH1", status: "CREATED", amount: { currencyCode: "USD", value: "82.00" } }] } }] };

beforeEach(() => {
  for (const group of Object.values(fake)) for (const fn of Object.values(group)) fn.mockReset();
  process.env.PAYPAL_ENVIRONMENT = "sandbox";
  process.env.PAYPAL_CLIENT_ID = "test-client";
  process.env.PAYPAL_CLIENT_SECRET = "test-secret";
});

describe("orders", () => {
  it("create: repeats with the same PayPal-Request-Id and settles on the order PayPal holds", async () => {
    fake.orders.createOrder.mockRejectedValueOnce(network()).mockResolvedValueOnce(ok({ id: "ORD1", status: "PAYER_ACTION_REQUIRED" }, 200));
    const order = await createHoldOrder(holdInput);
    expect(order.id).toBe("ORD1");
    expect(fake.orders.createOrder).toHaveBeenCalledTimes(2);
    const ids = fake.orders.createOrder.mock.calls.map((c) => c[0].paypalRequestId);
    expect(ids).toEqual(["cvc-dl_t-s-order", "cvc-dl_t-s-order"]);
  });

  it("authorize: no answer is settled by re-reading the order", async () => {
    fake.orders.authorizeOrder.mockRejectedValueOnce(network());
    fake.orders.getOrder.mockResolvedValueOnce(ok(heldOrder));
    const order = await authorizeOrder("ORD1", "cvc-dl_t-s-authorize");
    expect(order.authorization?.id).toBe("AUTH1");
    expect(fake.orders.getOrder).toHaveBeenCalledTimes(1);
  });

  it("authorize: still unknown when the re-read shows no authorization (never 'failed')", async () => {
    fake.orders.authorizeOrder.mockRejectedValueOnce(network());
    fake.orders.getOrder.mockResolvedValueOnce(ok({ id: "ORD1", status: "APPROVED", purchaseUnits: [{}] }));
    await expect(authorizeOrder("ORD1", "r")).rejects.toBeInstanceOf(PayPalUnknownOutcomeError);
  });

  it("authorize: a refusal from PayPal is an API error with its reason, not an unknown outcome", async () => {
    fake.orders.authorizeOrder.mockRejectedValueOnce(apiError(422, "INSTRUMENT_DECLINED"));
    const err = await authorizeOrder("ORD1", "r").catch((e) => e);
    expect(err).toBeInstanceOf(PayPalApiError);
    expect((err as PayPalApiError).issue).toBe("INSTRUMENT_DECLINED");
    expect(fake.orders.getOrder).not.toHaveBeenCalled();
  });

  it("a write that never left (credentials refused) is not re-read", async () => {
    fake.orders.authorizeOrder.mockRejectedValueOnce(new PayPalApiError(401, { error: "invalid_client" }, "d", "oauth token"));
    await expect(authorizeOrder("ORD1", "r")).rejects.toMatchObject({ status: 401 });
    expect(fake.orders.getOrder).not.toHaveBeenCalled();
  });
});

describe("authorizations", () => {
  const capture = { id: "CAP1", status: "COMPLETED", amount: { currencyCode: "USD", value: "82.00" }, sellerReceivableBreakdown: { grossAmount: { currencyCode: "USD", value: "82.00" }, paypalFee: { currencyCode: "USD", value: "3.35" } } };
  const capturedOrder = { ...heldOrder, purchaseUnits: [{ payments: { authorizations: [{ id: "AUTH1", status: "CAPTURED" }], captures: [{ id: "CAP1", status: "COMPLETED" }] } }] };
  const input = { authorizationId: "AUTH1", orderId: "ORD1", requestId: "cvc-dl_t-s-capture", invoiceId: "dl_t-s", noteToPayer: "Pickup confirmed" };

  it("capture: no answer is settled from what PayPal holds, so the money moves exactly once", async () => {
    fake.payments.captureAuthorizedPayment.mockRejectedValueOnce(network());
    fake.payments.getAuthorizedPayment.mockResolvedValueOnce(ok({ id: "AUTH1", status: "CAPTURED" }));
    fake.orders.getOrder.mockResolvedValueOnce(ok(capturedOrder));
    fake.payments.getCapturedPayment.mockResolvedValueOnce(ok(capture));
    const result = await captureAuthorization(input);
    expect(result).toMatchObject({ id: "CAP1", status: "COMPLETED", paypalFeeCents: 335 });
    expect(fake.payments.captureAuthorizedPayment).toHaveBeenCalledTimes(1);
  });

  it("capture: a second scan that reaches PayPal (already captured) resolves to the same capture", async () => {
    fake.payments.captureAuthorizedPayment.mockRejectedValueOnce(apiError(422, "AUTHORIZATION_ALREADY_CAPTURED"));
    fake.payments.getAuthorizedPayment.mockResolvedValueOnce(ok({ id: "AUTH1", status: "CAPTURED" }));
    fake.orders.getOrder.mockResolvedValueOnce(ok(capturedOrder));
    fake.payments.getCapturedPayment.mockResolvedValueOnce(ok(capture));
    expect((await captureAuthorization(input)).id).toBe("CAP1");
  });

  it("capture: stays unknown when the hold is still open after the re-read", async () => {
    fake.payments.captureAuthorizedPayment.mockRejectedValueOnce(network());
    fake.payments.getAuthorizedPayment.mockResolvedValueOnce(ok({ id: "AUTH1", status: "CREATED" }));
    await expect(captureAuthorization(input)).rejects.toBeInstanceOf(PayPalUnknownOutcomeError);
  });

  it("capture sends one final capture with the deal's invoice id", async () => {
    fake.payments.captureAuthorizedPayment.mockResolvedValueOnce(ok(capture, 201));
    await captureAuthorization(input);
    const sent = fake.payments.captureAuthorizedPayment.mock.calls[0][0];
    expect(sent.paypalRequestId).toBe("cvc-dl_t-s-capture");
    expect(sent.body).toEqual({ finalCapture: true, invoiceId: "dl_t-s", noteToPayer: "Pickup confirmed" });
  });

  it("void: no answer is settled by re-reading the authorization", async () => {
    fake.payments.voidPayment.mockRejectedValueOnce(network());
    fake.payments.getAuthorizedPayment.mockResolvedValueOnce(ok({ id: "AUTH1", status: "VOIDED" }));
    expect((await voidAuthorization("AUTH1", "cvc-dl_t-s-void")).status).toBe("VOIDED");
  });
});

describe("payouts (REST)", () => {
  const input = { senderBatchId: "cvc-dl_t-s-payout", senderItemId: "cvc-dl_t-s-item", receiverEmail: "seller@example.com", amountCents: 7740, note: "n", emailSubject: "s", emailMessage: "m" };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "paypal-debug-id": "dbg", "content-type": "application/json" } });

  function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      if (String(url).endsWith("/v1/oauth2/token")) return json(200, { access_token: "tok", expires_in: 3600 });
      calls.push({ url: String(url), init });
      return handler(String(url), init);
    });
    return calls;
  }

  it("no answer: repeats with the same sender_batch_id", async () => {
    let n = 0;
    const calls = stubFetch(() => {
      if (n++ === 0) throw new TypeError("fetch failed");
      return json(201, { batch_header: { payout_batch_id: "BATCH1", batch_status: "PENDING" } });
    });
    const payout = await createPayout(input);
    expect(payout).toMatchObject({ batchId: "BATCH1", batchStatus: "PENDING" });
    const posts = calls.filter((c) => c.init.method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts.map((p) => JSON.parse(String(p.init.body)).sender_batch_header.sender_batch_id)).toEqual(["cvc-dl_t-s-payout", "cvc-dl_t-s-payout"]);
    expect(posts.map((p) => (p.init.headers as Record<string, string>)["PayPal-Request-Id"])).toEqual(["cvc-dl_t-s-payout", "cvc-dl_t-s-payout"]);
  });

  it("a duplicate sender_batch_id resolves to the batch that already exists (no second payout)", async () => {
    const calls = stubFetch((url, init) => {
      if (init.method === "POST") {
        return json(400, { name: "USER_BUSINESS_ERROR", message: "Sender batch id already exists", links: [{ href: "https://api.sandbox.paypal.com/v1/payments/payouts/BATCH1", rel: "self" }] });
      }
      return json(200, { batch_header: { payout_batch_id: "BATCH1", batch_status: "SUCCESS", amount: { value: "77.40" } }, items: [{ payout_item_id: "ITEM1", transaction_status: "SUCCESS", transaction_id: "TX1" }] });
    });
    const payout = await createPayout(input);
    expect(payout).toMatchObject({ batchId: "BATCH1", itemStatus: "SUCCESS", transactionId: "TX1" });
    expect(calls.filter((c) => c.init.method === "POST")).toHaveLength(1);
    expect(calls.some((c) => c.url.endsWith("/v1/payments/payouts/BATCH1"))).toBe(true);
  });

  it("a real refusal is an API error with PayPal's reason", async () => {
    stubFetch(() => json(422, { name: "INSUFFICIENT_FUNDS", message: "Sender does not have sufficient funds." }));
    await expect(createPayout(input)).rejects.toMatchObject({ status: 422 });
  });
});
