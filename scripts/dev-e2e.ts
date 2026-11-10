/**
 * Developer check: one full live deal against the PayPal sandbox and the real models, using the
 * same library code the app uses. Writes to a throwaway data directory.
 *
 *   pnpm tsx scripts/dev-e2e.ts [--no-pay]
 */
import os from "node:os";
import path from "node:path";
import { loadEnv, requireEnv } from "./lib/env";

loadEnv();
process.env.CVC_DATA_DIR = process.env.CVC_DATA_DIR ?? path.join(os.tmpdir(), `cvc-e2e-${Date.now()}`);

async function main() {
  requireEnv(["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "OPENAI_API_KEY", "MANDATE_SIGNING_SECRET", "QR_SIGNING_SECRET"]);
  const { issueMandate } = await import("../lib/mandate");
  const { env } = await import("../lib/env");
  const repo = await import("../lib/repo");
  const deals = await import("../lib/deals");
  const { withDeal } = await import("../lib/runner");
  const { upcomingPickupWindows } = await import("../lib/demo-data");
  const { formatUsd } = await import("../lib/money");
  const { approveOrder, launchBrowser } = await import("./lib/approve");
  type Listing = import("../lib/types").Listing;

  const listing: Listing = {
    id: "lst_e2e",
    sellerName: "Theo",
    title: "Kid's bike with training wheels",
    category: "kids bike",
    description: "A red kid's bike that suits a 5 to 7 year old. Rides well, with some scuffs from normal use.",
    conditionGrade: "good",
    facts: [
      { id: "f1", kind: "condition", text: "Frame is straight and the chain looks clean" },
      { id: "f2", kind: "flaw", text: "Scuffed paint on the top tube" },
      { id: "f3", kind: "flaw", text: "Light rust on the handlebar bolts" },
      { id: "f4", kind: "measurement", text: "Wheel size: about 16 in", estimate: true },
      { id: "f5", kind: "included", text: "Training wheels attached" },
      { id: "f6", kind: "feature", text: "Coaster brake and one hand brake" },
    ],
    extras: [
      { id: "bell", label: "Bike bell" },
      { id: "helmet", label: "Kid's helmet" },
    ],
    photos: [],
    askingCents: 9500,
    area: "Mission District",
    pickupWindows: upcomingPickupWindows(),
    prefs: { bundlesOk: true, noCash: true },
    status: "active",
    createdAt: new Date().toISOString(),
  };
  await repo.saveListing(listing);
  await repo.saveListingPrivate({
    listingId: listing.id,
    floorCents: 7500,
    mandate: issueMandate({ role: "seller", owner: "Theo", listingId: listing.id, limitCents: 7500 }, env.mandateSecret),
  });

  const deal = await deals.createDeal({ listing, ceilingCents: 9000, pickupWindowIds: ["sat-am", "sun-mid"] });
  await repo.saveDeal(deal);
  console.log("deal", deal.id);

  const t0 = Date.now();
  for (let i = 0; i < 20; i++) {
    const { deal: d } = await withDeal(deal.id, "Haggle", (dd, ll) => deals.stepDeal(dd, ll));
    const last = d.turns[d.turns.length - 1];
    const turn = d.turns.filter((t) => t.actor === "barley" || t.actor === "biscuit").at(-1);
    if (turn) {
      const blocked = (turn.trail ?? []).filter((s) => s.tone === "blocked").map((s) => s.label);
      console.log(`[r${turn.round}] ${turn.actor} ${turn.kind}${turn.offer ? " " + formatUsd(turn.offer.priceCents) + " " + turn.offer.pickupWindowId + " [" + turn.offer.extras.join(",") + "]" : ""} (${turn.ai?.model}${turn.ai?.scripted ? ", scripted" : ""}): ${turn.message}${blocked.length ? "\n      blocked first: " + blocked.join(" | ") : ""}`);
    }
    if (d.status !== "negotiating") {
      console.log("=>", d.status, last.message);
      break;
    }
  }
  console.log(`haggle took ${Math.round((Date.now() - t0) / 1000)} s`);

  let { deal: d } = await withDeal(deal.id, "Summary", (dd, ll) => deals.ensureSummary(dd, ll));
  console.log("summary", d.agreed?.summary);
  if (d.status !== "agreed" || process.argv.includes("--no-pay")) return;

  await withDeal(deal.id, "Accept", (dd, ll) => deals.acceptDeal(dd, ll, "seller"));
  ({ deal: d } = await withDeal(deal.id, "Accept", (dd, ll) => deals.acceptDeal(dd, ll, "buyer")));
  console.log("order", d.payment.orderId, d.payment.orderStatus, d.turns.at(-1)?.tool);

  const browser = await launchBrowser();
  try {
    await approveOrder(browser, {
      approveUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${d.payment.orderId}`,
      buyerEmail: process.env.PAYPAL_SANDBOX_BUYER_EMAIL!,
      buyerPassword: process.env.PAYPAL_SANDBOX_BUYER_PASSWORD!,
      returnUrlPrefix: `${env.appUrl}/deal/${d.id}`,
      onStep: (s) => console.log("  approval:", s),
    });
  } finally {
    await browser.close();
  }

  ({ deal: d } = await withDeal(deal.id, "Authorize", (dd, ll) => deals.authorizeHold(dd, ll)));
  console.log("held", d.status, d.payment.authorizationId, d.payment.authorizationStatus);
  ({ deal: d } = await withDeal(deal.id, "Verify", (dd) => deals.verifyHoldStep(dd)));
  console.log("verify", d.turns.at(-1)?.message, d.turns.at(-1)?.tool);

  const { result: qr } = await withDeal(deal.id, "QR", async (dd) => deals.issuePickupQr(dd));
  console.log("qr token length", qr.token.length);
  ({ deal: d } = await withDeal(deal.id, "Handoff", (dd, ll) => deals.completeHandoff(dd, ll, qr.token, "simulated")));
  console.log("completed", d.status, d.payment.captureId, d.payment.captureStatus, d.payment.payoutBatchId, d.payment.payoutBatchStatus);
  // Second scan of the same code must be refused.
  try {
    await withDeal(deal.id, "Handoff", (dd, ll) => deals.completeHandoff(dd, ll, qr.token, "simulated"));
    console.log("second scan: no error (deal already completed)");
  } catch (err) {
    console.log("second scan refused:", (err as Error).message);
  }
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    ({ deal: d } = await withDeal(deal.id, "Refresh", (dd, ll) => deals.refreshFromPayPal(dd, ll)));
    console.log("payout", d.payment.payoutBatchStatus, d.payment.payoutItemStatus);
    if (d.payment.payoutItemStatus === "SUCCESS") break;
  }
  console.log("\nPayPal calls:");
  for (const c of d.calls) console.log(` ${c.method.padEnd(5)} ${c.path.padEnd(64)} ${String(c.status).padEnd(4)} ${String(c.debugId ?? "-").padEnd(14)} ${c.via.padEnd(13)} ${c.feature}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
