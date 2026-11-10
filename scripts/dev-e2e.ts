/**
 * Developer check: live deals against the PayPal sandbox and the real models, through the same
 * library code the app uses, in a throwaway data directory.
 *
 *   pnpm tsx scripts/dev-e2e.ts            completed deal, then a refund through the Agent Toolkit
 *   pnpm tsx scripts/dev-e2e.ts --void     held deal, a scam message, then a no-show void
 */
import os from "node:os";
import path from "node:path";
import { loadEnv, requireEnv } from "./lib/env";

loadEnv();
process.env.CVC_DATA_DIR = path.join(os.tmpdir(), `cvc-e2e-${Date.now()}`);

const log = (line = "") => console.log(line);

async function main() {
  requireEnv(["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_SANDBOX_BUYER_EMAIL", "PAYPAL_SANDBOX_BUYER_PASSWORD", "PAYPAL_SANDBOX_SELLER_EMAIL", "OPENAI_API_KEY", "MANDATE_SIGNING_SECRET", "QR_SIGNING_SECRET"]);
  const repo = await import("../lib/repo");
  const world = await import("../lib/world");
  const deals = await import("../lib/deals");
  const { withDeal } = await import("../lib/runner");
  const { acceptAndHold, haggle, handoff } = await import("./lib/flow");
  const { launchBrowser } = await import("./lib/approve");
  const voidPath = process.argv.includes("--void");

  const { listings, privates } = await world.buildDemoListings();
  const listing = listings.find((l) => l.id === (voidPath ? "lst_table" : "lst_bike"))!;
  await repo.saveListing(listing);
  await repo.saveListingPrivate(privates.find((p) => p.listingId === listing.id)!);

  const dealId = "dl_e2e";
  let deal = await deals.createDeal({ listing, ceilingCents: Math.round(listing.askingCents * 0.95), pickupWindowIds: listing.pickupWindows.map((w) => w.id), id: dealId });
  await repo.saveDeal(deal);
  deal = await haggle(dealId, log);
  if (deal.status !== "agreed") throw new Error(`The haggle ended ${deal.status}. Run it again.`);
  log(`deal at ${deal.agreed!.offer.priceCents / 100}: ${deal.agreed!.summary?.buyer}`);

  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
    deal = await acceptAndHold(dealId, browser, context, { email: process.env.PAYPAL_SANDBOX_BUYER_EMAIL!, password: process.env.PAYPAL_SANDBOX_BUYER_PASSWORD! }, log);
    await context.close();
  } finally {
    await browser.close();
  }
  log(`verify: ${deal.turns.at(-1)?.message}`);

  if (voidPath) {
    const { result, deal: flagged } = await withDeal(dealId, "message", (d) => deals.humanMessage(d, "buyer", "I'll send a courier to collect it. Just pay the shipping fee first and I'll add it to the total."));
    const flag = flagged.flags.at(-1);
    log(`scam message flagged: ${result.flagged} (${flag?.source}; ${flag?.patterns.join(", ")}) ${flag?.explanation}`);
    log(`refusal: ${flagged.turns.at(-1)?.message}`);
    const ordinary = await withDeal(dealId, "message", (d) => deals.humanMessage(d, "buyer", "Could we meet at 10:30 instead of 10?"));
    log(`ordinary message flagged: ${ordinary.result.flagged}`);
    ({ deal } = await withDeal(dealId, "void", (d, l) => deals.voidHold(d, l, "Developer check: the buyer did not show.")));
    log(`void: ${deal.status}, authorization ${deal.payment.authorizationStatus}, listing ${(await repo.getListing(listing.id))?.status}`);
  } else {
    deal = await handoff(dealId, log);
    ({ deal } = await withDeal(dealId, "refund", (d, l) => deals.refundBuyer(d, l, "The chain snapped on the first ride.")));
    log(`refund: ${deal.status}, refund ${deal.payment.refundId} ${deal.payment.refundStatus}`);
    log(`  ${deal.turns.at(-1)?.message}`);
    try {
      await withDeal(dealId, "refund", (d, l) => deals.refundBuyer(d, l, "again"));
      log("second refund: no-op");
    } catch (err) {
      log(`second refund refused: ${(err as Error).message}`);
    }
  }

  log("\nPayPal calls:");
  for (const c of deal.calls) log(` ${c.method.padEnd(5)} ${c.path.padEnd(62)} ${String(c.status).padEnd(4)} ${String(c.debugId ?? "-").padEnd(14)} ${c.via.padEnd(13)} ${c.feature}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
