/**
 * pnpm paypal:webhook <public-url>
 *
 * Registers <public-url>/api/paypal/webhook for this build's event types through the Webhooks API
 * and prints the webhook id. Run it after deploying, then set PAYPAL_WEBHOOK_ID on the deployment.
 * Re-running with the same URL updates the existing webhook instead of creating a second one.
 */
import { loadEnv, requireEnv } from "./lib/env";

loadEnv();

async function main() {
  const arg = process.argv[2];
  if (!arg || !/^https:\/\//.test(arg)) {
    console.error("Usage: pnpm paypal:webhook https://your-deployment.example\nPayPal only delivers webhooks to public https URLs.");
    process.exit(1);
  }
  requireEnv(["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"]);
  const { newContext, runInContext } = await import("../lib/context");
  const { createWebhook, listWebhooks, updateWebhookEvents, WEBHOOK_EVENT_TYPES } = await import("../lib/paypal/webhooks");
  const { PayPalApiError } = await import("../lib/paypal/errors");
  const url = `${arg.replace(/\/+$/, "")}/api/paypal/webhook`;

  await runInContext(newContext({ feature: "Register webhook" }), async () => {
    const existing = (await listWebhooks()).find((w) => w.url === url);
    let id: string;
    if (existing) {
      await updateWebhookEvents(existing.id);
      id = existing.id;
      console.log(`Webhook already registered for ${url}. Event types updated.`);
    } else {
      try {
        const created = await createWebhook(url, `cvc-webhook-${Buffer.from(url).toString("base64url").slice(0, 40)}`);
        id = created.id;
        console.log(`Webhook registered for ${url}.`);
      } catch (err) {
        if (err instanceof PayPalApiError) {
          console.error(`PayPal refused the webhook: ${err.reason} (PayPal-Debug-Id ${err.debugId ?? "none"})`);
          process.exit(1);
        }
        throw err;
      }
    }
    console.log("Event types:");
    for (const t of WEBHOOK_EVENT_TYPES) console.log(`  ${t}`);
    console.log(`\nWebhook id: ${id}`);
    console.log(`Set this on the deployment and redeploy:\n  PAYPAL_WEBHOOK_ID=${id}`);
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
