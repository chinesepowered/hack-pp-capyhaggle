import { refreshFromPayPal } from "@/lib/deals";
import { newContext, runInContext } from "@/lib/context";
import { env } from "@/lib/env";
import { json } from "@/lib/http";
import { dealIdFromEvent, readTransmissionHeaders, verifyWebhookSignature, WEBHOOK_EVENT_TYPES, type WebhookEvent } from "@/lib/paypal/webhooks";
import { getDeal, keys } from "@/lib/repo";
import { withDeal } from "@/lib/runner";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * PayPal webhooks. Verified with POST /v1/notifications/verify-webhook-signature against the raw
 * body, handled idempotently by event id, and never trusted for amounts: an event only triggers a
 * re-read of the deal's objects from PayPal.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const webhookId = env.paypalWebhookId;
  if (!webhookId) {
    // Without a registered webhook id nothing can be verified, so nothing is accepted.
    return json({ error: { code: "WEBHOOK_NOT_CONFIGURED", message: "Set PAYPAL_WEBHOOK_ID (run pnpm paypal:webhook <public-url>)." } }, 503);
  }

  let verified = false;
  try {
    verified = await runInContext(newContext({ feature: "Webhook: verify signature" }), () => verifyWebhookSignature(raw, readTransmissionHeaders(req.headers), webhookId));
  } catch (err) {
    console.warn("[webhook] verification call failed:", err instanceof Error ? err.message : err);
    // PayPal retries on a non-2xx answer, which is what we want when verification could not run.
    return json({ error: { code: "VERIFY_UNAVAILABLE", message: "Could not verify the signature right now." } }, 503);
  }
  if (!verified) return json({ error: { code: "BAD_SIGNATURE", message: "Webhook signature did not verify." } }, 400);

  let event: WebhookEvent;
  try {
    event = JSON.parse(raw) as WebhookEvent;
  } catch {
    return json({ error: { code: "BAD_BODY", message: "Not JSON." } }, 400);
  }
  if (!event.id || !event.event_type) return json({ error: { code: "BAD_EVENT", message: "Missing id or event_type." } }, 400);

  // Idempotency: the first delivery of an event id claims it; repeats are acknowledged and skipped.
  const first = await store().claim(keys.webhookEvent(event.id), { type: event.event_type, at: new Date().toISOString() });
  if (!first) return json({ ok: true, duplicate: true });

  if (!(WEBHOOK_EVENT_TYPES as readonly string[]).includes(event.event_type)) return json({ ok: true, ignored: event.event_type });

  const dealId = dealIdFromEvent(event);
  if (!dealId || !(await getDeal(dealId))) return json({ ok: true, unmatched: true });

  try {
    await withDeal(dealId, `Webhook: ${event.event_type}`, async (deal, listing) => {
      if (!deal.webhookEvents.some((e) => e.id === event.id)) {
        deal.webhookEvents.push({ id: event.id, type: event.event_type, at: new Date().toISOString(), resourceId: String((event.resource as { id?: string } | undefined)?.id ?? "") });
      }
      if (deal.mode === "live") await refreshFromPayPal(deal, listing);
    });
  } catch (err) {
    console.warn("[webhook] handler failed:", err instanceof Error ? err.message : err);
    // Release the claim so PayPal's retry is processed.
    await store().delete(keys.webhookEvent(event.id));
    return json({ error: { code: "HANDLER_FAILED", message: "Will be retried." } }, 500);
  }
  return json({ ok: true });
}
