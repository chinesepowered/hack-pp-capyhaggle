/**
 * Webhooks v1 over plain REST: signature verification and registration.
 * The app never depends on delivery alone. Every money screen also re-reads PayPal.
 */
import { rest } from "./core";

export const WEBHOOK_EVENT_TYPES = [
  "PAYMENT.AUTHORIZATION.CREATED",
  "PAYMENT.AUTHORIZATION.VOIDED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
] as const;

export interface WebhookEvent {
  id: string;
  event_type: string;
  create_time?: string;
  resource_type?: string;
  summary?: string;
  resource?: Record<string, unknown>;
}

export interface TransmissionHeaders {
  authAlgo: string | null;
  certUrl: string | null;
  transmissionId: string | null;
  transmissionSig: string | null;
  transmissionTime: string | null;
}

export function readTransmissionHeaders(headers: Headers): TransmissionHeaders {
  return {
    authAlgo: headers.get("paypal-auth-algo"),
    certUrl: headers.get("paypal-cert-url"),
    transmissionId: headers.get("paypal-transmission-id"),
    transmissionSig: headers.get("paypal-transmission-sig"),
    transmissionTime: headers.get("paypal-transmission-time"),
  };
}

/**
 * POST /v1/notifications/verify-webhook-signature.
 * The raw body is spliced into the request exactly as received: re-serializing the event would
 * change the bytes the signature was computed over.
 */
export async function verifyWebhookSignature(rawBody: string, h: TransmissionHeaders, webhookId: string): Promise<boolean> {
  if (!h.authAlgo || !h.certUrl || !h.transmissionId || !h.transmissionSig || !h.transmissionTime) return false;
  // The cert must come from PayPal. Anything else is refused without calling out.
  try {
    const host = new URL(h.certUrl).hostname;
    if (!/(^|\.)paypal\.com$/.test(host)) return false;
  } catch {
    return false;
  }
  const envelope = {
    auth_algo: h.authAlgo,
    cert_url: h.certUrl,
    transmission_id: h.transmissionId,
    transmission_sig: h.transmissionSig,
    transmission_time: h.transmissionTime,
    webhook_id: webhookId,
  };
  const body = `${JSON.stringify(envelope).slice(0, -1)},"webhook_event":${rawBody}}`;
  const res = await rest<{ verification_status?: string }>({
    name: "webhooks.verify",
    method: "POST",
    path: "/v1/notifications/verify-webhook-signature",
    rawBody: body,
  });
  return res.result.verification_status === "SUCCESS";
}

interface WebhookWire {
  id: string;
  url: string;
  event_types?: { name: string }[];
}

/** GET /v1/notifications/webhooks. */
export async function listWebhooks(): Promise<WebhookWire[]> {
  const res = await rest<{ webhooks?: WebhookWire[] }>({ name: "webhooks.list", method: "GET", path: "/v1/notifications/webhooks" });
  return res.result.webhooks ?? [];
}

/** POST /v1/notifications/webhooks. */
export async function createWebhook(url: string, requestId: string): Promise<WebhookWire> {
  const res = await rest<WebhookWire>({
    name: "webhooks.create",
    method: "POST",
    path: "/v1/notifications/webhooks",
    requestId,
    body: { url, event_types: WEBHOOK_EVENT_TYPES.map((name) => ({ name })) },
  });
  return res.result;
}

/** PATCH /v1/notifications/webhooks/{id}: replace the event types of an existing webhook. */
export async function updateWebhookEvents(id: string): Promise<WebhookWire> {
  const res = await rest<WebhookWire>({
    name: "webhooks.update",
    method: "PATCH",
    path: `/v1/notifications/webhooks/${id}`,
    body: [{ op: "replace", path: "/event_types", value: WEBHOOK_EVENT_TYPES.map((name) => ({ name })) }],
  });
  return res.result;
}
