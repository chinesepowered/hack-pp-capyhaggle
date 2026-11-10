/**
 * pnpm seed
 *
 * Creates this build's demo data, including real PayPal sandbox objects, through the same code the
 * app uses. Idempotent and safe to re-run: existing seeded deals are verified against PayPal and
 * left alone.
 *
 *   - Theo's three listings (texts written by the vision model, recorded in fixtures/) and Maya's want
 *   - a completed deal (stroller): order with intent AUTHORIZE, buyer approval, authorize, QR
 *     handoff, capture, payout to the seller
 *   - a no-show deal (side table): the same up to the hold, then the authorization is voided
 *   - the snapshot that POST /api/admin/reset restores
 *
 * Where PayPal needs the buyer to approve in its own window, Playwright does it with the sandbox
 * buyer login. Sandbox only.
 *
 * Flags: --fresh  wipe the store first and create new sandbox objects
 *        --no-paypal  listings and want only (no deals)
 */
import { loadEnv, requireEnv } from "./lib/env";

loadEnv();

const log = (line = "") => console.log(line);

async function main() {
  const fresh = process.argv.includes("--fresh");
  const noPayPal = process.argv.includes("--no-paypal");
  requireEnv(["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_SANDBOX_SELLER_EMAIL", "MANDATE_SIGNING_SECRET", "QR_SIGNING_SECRET", "OPENAI_BASE_URL", "OPENAI_API_KEY"]);
  if (!noPayPal) requireEnv(["PAYPAL_SANDBOX_BUYER_EMAIL", "PAYPAL_SANDBOX_BUYER_PASSWORD"]);
  if ((process.env.PAYPAL_ENVIRONMENT ?? "sandbox") !== "sandbox") throw new Error("pnpm seed only runs against the PayPal sandbox.");

  const { store, storeKind } = await import("../lib/store");
  const repo = await import("../lib/repo");
  const world = await import("../lib/world");
  const deals = await import("../lib/deals");
  const { DEMO_ITEMS, DEMO_WANT } = await import("../lib/demo-data");
  const { newContext, runInContext } = await import("../lib/context");
  const { getOrder } = await import("../lib/paypal/orders");
  const { withDeal } = await import("../lib/runner");
  const { formatUsd, formatUsdExact } = await import("../lib/money");
  const { acceptAndHold, haggle, handoff, maskEmail } = await import("./lib/flow");
  type Deal = import("../lib/types").Deal;

  log(`Capy vs Capy seed. Store: ${storeKind()}. PayPal: sandbox.`);

  if (fresh) {
    for (const prefix of ["listings/", "listings-private/", "wants/", "wants-private/", "deals/", "claims/", "seed/"]) {
      for (const key of await store().list(prefix)) await store().delete(key);
    }
    log("Wiped the store (--fresh).");
  }

  /* ----------------------------------------------------- listings + want */
  const { listings, privates } = await world.buildDemoListings();
  for (const l of listings) {
    const existing = await repo.getListing(l.id);
    // Keep the status of a listing that a seeded deal already sold or reserved.
    await repo.saveListing(existing ? { ...l, status: existing.status, createdAt: existing.createdAt } : l);
  }
  for (const p of privates) await repo.saveListingPrivate(p);
  const { want, priv } = world.demoWant();
  await repo.saveWant(want);
  await repo.saveWantPrivate(priv);
  log(`\nListings (seller ${listings[0].sellerName}, texts by ${listings[0].ai?.model}):`);
  for (const l of listings) {
    const item = DEMO_ITEMS.find((i) => i.listingId === l.id)!;
    log(`  ${l.id.padEnd(13)} ${l.title.padEnd(38)} asking ${formatUsd(l.askingCents).padEnd(5)} private floor ${formatUsd(item.floorCents)}`);
  }
  log(`Want: "${want.text}" (private ceiling ${formatUsd(DEMO_WANT.ceilingCents)})`);

  if (noPayPal) {
    await world.writeSnapshot([]);
    log("\nSkipped PayPal deals (--no-paypal). Snapshot written.");
    return;
  }

  /* ------------------------------------------------------- seeded deals */
  const plans = [
    { id: "dl_seed_stroller", listingId: "lst_stroller", ceilingCents: 10000, outcome: "completed" as const },
    { id: "dl_seed_table", listingId: "lst_table", ceilingCents: 7600, outcome: "voided" as const },
  ];

  async function stillThere(deal: Deal): Promise<boolean> {
    if (!deal.payment.orderId) return false;
    try {
      const order = await runInContext(newContext({ feature: "Seed: verify existing order" }), () => getOrder(deal.payment.orderId!));
      return order.status === "COMPLETED" || order.status === "VOIDED";
    } catch {
      return false;
    }
  }

  const { launchBrowser } = await import("./lib/approve");
  let browser: import("playwright").Browser | undefined;
  let context: import("playwright").BrowserContext | undefined;
  const buyer = { email: process.env.PAYPAL_SANDBOX_BUYER_EMAIL!, password: process.env.PAYPAL_SANDBOX_BUYER_PASSWORD! };
  const seeded: Deal[] = [];

  try {
    for (const plan of plans) {
      log(`\nDeal ${plan.id} (${plan.listingId}, target: ${plan.outcome})`);
      const existing = await repo.getDeal(plan.id);
      if (existing && existing.status === plan.outcome && (await stillThere(existing))) {
        log(`  already seeded: order ${existing.payment.orderId}, status ${existing.status}. Verified at PayPal, left as is.`);
        seeded.push(existing);
        continue;
      }
      if (existing) {
        await store().delete(repo.keys.deal(plan.id));
        for (const key of await store().list(`claims/${plan.id}/`)) await store().delete(key);
      }
      const listing = await repo.getListing(plan.listingId);
      if (!listing) throw new Error(`Listing ${plan.listingId} is missing.`);
      if (listing.status !== "active") {
        listing.status = "active";
        await repo.saveListing(listing);
      }

      // Haggle with the real agents. A haggle can end without a deal; try a few times.
      let deal: Deal | undefined;
      for (let attempt = 1; attempt <= 4; attempt++) {
        const created = await deals.createDeal({ listing, ceilingCents: plan.ceilingCents, pickupWindowIds: listing.pickupWindows.map((w) => w.id), id: plan.id, seeded: true });
        await repo.saveDeal(created);
        log(`  haggle, attempt ${attempt}:`);
        deal = await haggle(plan.id, log);
        if (deal.status === "agreed") break;
        log(`  ended ${deal.status}, trying again`);
        await store().delete(repo.keys.deal(plan.id));
        deal = undefined;
      }
      if (!deal || !deal.agreed) throw new Error(`No deal was reached for ${plan.id} after 4 attempts.`);
      log(`  deal at ${formatUsd(deal.agreed.offer.priceCents)}, pickup ${deal.agreed.pickupLabel}`);

      browser ??= await launchBrowser();
      context ??= await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
      deal = await acceptAndHold(plan.id, browser, context, buyer, log);

      if (plan.outcome === "completed") {
        deal = await handoff(plan.id, log);
      } else {
        // The no-show example: same call the app makes when the pickup window ends without a scan.
        ({ deal } = await withDeal(plan.id, "void", (d, l) => deals.voidHold(d, l, "Seeded example: the pickup window was fast-forwarded and Maya did not show.")));
        log(`    voided: authorization ${deal.payment.authorizationId} ${deal.payment.authorizationStatus}`);
      }
      seeded.push(deal);
    }
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }

  /* --------------------------------------------------- snapshot + report */
  const finalDeals: Deal[] = [];
  for (const d of seeded) finalDeals.push((await repo.getDeal(d.id)) ?? d);
  await world.writeSnapshot(finalDeals);
  await store().set(repo.keys.seedManifest(), {
    createdAt: new Date().toISOString(),
    deals: finalDeals.map((d) => ({ id: d.id, status: d.status, orderId: d.payment.orderId, authorizationId: d.payment.authorizationId, captureId: d.payment.captureId, payoutBatchId: d.payment.payoutBatchId })),
  });

  log("\nSeeded PayPal sandbox objects:");
  for (const d of finalDeals) {
    log(`  ${d.id}: ${d.status}, ${formatUsdExact(d.agreed?.offer.priceCents ?? 0)}`);
    log(`    order ${d.payment.orderId}  authorization ${d.payment.authorizationId} (${d.payment.authorizationStatus})`);
    if (d.payment.captureId) log(`    capture ${d.payment.captureId} (${d.payment.captureStatus})  payout batch ${d.payment.payoutBatchId} (${d.payment.payoutItemStatus ?? d.payment.payoutBatchStatus})`);
    log(`    PayPal calls logged on the deal: ${d.calls.length}`);
  }
  log("\nSandbox accounts used:");
  log(`  merchant (marketplace): the app behind PAYPAL_CLIENT_ID`);
  log(`  buyer  (Maya): ${maskEmail(process.env.PAYPAL_SANDBOX_BUYER_EMAIL)}  approves orders in PayPal's window`);
  log(`  seller (Theo): ${maskEmail(process.env.PAYPAL_SANDBOX_SELLER_EMAIL)}  receives payouts`);
  log("\nSnapshot written. POST /api/admin/reset (header x-admin-token) restores this state.");
}

main().catch((err) => {
  console.error(`\nSeed failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
