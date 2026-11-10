/**
 * Payments v2 through the server SDK: read, capture, void and reauthorize an authorization, and read a capture.
 */
import type { CapturedPayment, PaymentAuthorization } from "@paypal/paypal-server-sdk";
import { fromPayPalValue } from "../money";
import { sdk, sdkCall } from "./core";
import { PayPalApiError, PayPalUnknownOutcomeError } from "./errors";
import { getOrder, type AuthorizationSnapshot } from "./orders";

/** PayPal honors an authorization for 3 days. After that, reauthorize before capturing. */
export const HONOR_PERIOD_MS = 3 * 24 * 3600_000;

function authSnapshot(a: PaymentAuthorization): AuthorizationSnapshot {
  return {
    id: a.id ?? "",
    status: a.status ?? "UNKNOWN",
    amountCents: a.amount?.value ? fromPayPalValue(a.amount.value) : undefined,
    expiresAt: a.expirationTime,
    createdAt: a.createTime,
  };
}

export interface CaptureSnapshot {
  id: string;
  status: string;
  amountCents?: number;
  paypalFeeCents?: number;
  netCents?: number;
  createdAt?: string;
}

function captureSnapshot(c: CapturedPayment): CaptureSnapshot {
  const b = c.sellerReceivableBreakdown;
  return {
    id: c.id ?? "",
    status: c.status ?? "UNKNOWN",
    amountCents: c.amount?.value ? fromPayPalValue(c.amount.value) : undefined,
    paypalFeeCents: b?.paypalFee?.value ? fromPayPalValue(b.paypalFee.value) : undefined,
    netCents: b?.netAmount?.value ? fromPayPalValue(b.netAmount.value) : undefined,
    createdAt: c.createTime,
  };
}

/** GET /v2/payments/authorizations/{id}. */
export async function getAuthorization(authorizationId: string): Promise<AuthorizationSnapshot> {
  const res = await sdkCall({ name: "authorizations.get", method: "GET", path: `/v2/payments/authorizations/${authorizationId}` }, () =>
    sdk().payments.getAuthorizedPayment({ authorizationId }),
  );
  return authSnapshot(res.result);
}

/** True when the 3-day honor period has passed and a reauthorization is due before capture. */
export function needsReauthorization(auth: { createdAt?: string }, now = new Date()): boolean {
  if (!auth.createdAt) return false;
  return now.getTime() - new Date(auth.createdAt).getTime() > HONOR_PERIOD_MS;
}

/** POST /v2/payments/authorizations/{id}/reauthorize. */
export async function reauthorize(authorizationId: string, requestId: string): Promise<AuthorizationSnapshot> {
  const res = await sdkCall(
    { name: "authorizations.reauthorize", method: "POST", path: `/v2/payments/authorizations/${authorizationId}/reauthorize`, requestId },
    () => sdk().payments.reauthorizePayment({ authorizationId, paypalRequestId: requestId, prefer: "return=representation" }),
  );
  return authSnapshot(res.result);
}

/** GET /v2/payments/captures/{id}. */
export async function getCapture(captureId: string): Promise<CaptureSnapshot> {
  const res = await sdkCall({ name: "captures.get", method: "GET", path: `/v2/payments/captures/${captureId}` }, () =>
    sdk().payments.getCapturedPayment({ captureId }),
  );
  return captureSnapshot(res.result);
}

export interface CaptureInput {
  authorizationId: string;
  orderId: string;
  requestId: string;
  invoiceId: string;
  noteToPayer: string;
}

/** POST /v2/payments/authorizations/{id}/capture. One final capture for the full amount. */
export async function captureAuthorization(input: CaptureInput): Promise<CaptureSnapshot> {
  const { authorizationId } = input;
  try {
    const res = await sdkCall(
      { name: "authorizations.capture", method: "POST", path: `/v2/payments/authorizations/${authorizationId}/capture`, requestId: input.requestId },
      () =>
        sdk().payments.captureAuthorizedPayment({
          authorizationId,
          paypalRequestId: input.requestId,
          prefer: "return=representation",
          body: { finalCapture: true, invoiceId: input.invoiceId, noteToPayer: input.noteToPayer.slice(0, 255) },
        }),
    );
    return captureSnapshot(res.result);
  } catch (err) {
    const alreadyDone = err instanceof PayPalApiError && err.status === 422 && err.issue === "AUTHORIZATION_ALREADY_CAPTURED";
    if (alreadyDone || err instanceof PayPalUnknownOutcomeError) {
      // Settle by re-reading: a CAPTURED authorization means the money moved exactly once.
      const auth = await getAuthorization(authorizationId);
      if (auth.status === "CAPTURED") {
        const order = await getOrder(input.orderId);
        if (order.captureId) return getCapture(order.captureId);
      }
    }
    throw err;
  }
}

/** POST /v2/payments/authorizations/{id}/void. Releases the hold; the buyer is never charged. */
export async function voidAuthorization(authorizationId: string, requestId: string): Promise<AuthorizationSnapshot> {
  try {
    const res = await sdkCall(
      { name: "authorizations.void", method: "POST", path: `/v2/payments/authorizations/${authorizationId}/void`, requestId },
      () => sdk().payments.voidPayment({ authorizationId, paypalRequestId: requestId, prefer: "return=representation" }),
    );
    if (res.result) return authSnapshot(res.result);
    return getAuthorization(authorizationId);
  } catch (err) {
    const alreadyDone = err instanceof PayPalApiError && err.status === 422 && err.issue === "PREVIOUSLY_VOIDED";
    if (alreadyDone || err instanceof PayPalUnknownOutcomeError) {
      const auth = await getAuthorization(authorizationId);
      if (auth.status === "VOIDED") return auth;
    }
    throw err;
  }
}
