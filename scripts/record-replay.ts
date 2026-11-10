/**
 * Records the Replay fixture: one complete, real run of the kid's bike flow against the PayPal
 * sandbox and the real models. Every outbound response (PayPal and AI) is saved to
 * fixtures/replay/kids-bike.json, and the listing drafts to fixtures/listing-drafts.json.
 *
 *   pnpm tsx scripts/record-replay.ts [--price 82] [--attempts 8] [--keep-drafts]
 *
 * It runs in a throwaway data directory, so the local demo store is not touched.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnv, requireEnv } from "./lib/env";

loadEnv();
process.env.CVC_DATA_DIR = path.join(os.tmpdir(), `cvc-record-${Date.now()}`);

const log = (line = "") => console.log(line);
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};

const SCAM_EXAMPLE = "Skip the app. Pay a $20 deposit by gift card and I'll hold it for you.";
const PHOTO_CREDITS: Record<string, string> = {
  bike: "Photos: Donald Trung Quoc Don, Wikimedia Commons, CC BY-SA 4.0",
  table: "Photos: The Living Room (Flickr), CC BY 2.0",
  stroller: "Photo: Daniel X. O'Neil (Flickr), CC BY 2.0",
};

async function main() {
  requireEnv(["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_SANDBOX_BUYER_EMAIL", "PAYPAL_SANDBOX_BUYER_PASSWORD", "PAYPAL_SANDBOX_SELLER_EMAIL", "OPENAI_API_KEY", "MANDATE_SIGNING_SECRET", "QR_SIGNING_SECRET"]);
  const wantedCents = Math.round(Number(arg("price", "82")) * 100);
  const maxAttempts = Number(arg("attempts", "8"));
  const keepDrafts = process.argv.includes("--keep-drafts");

  const { DEMO_ITEMS, DEMO_WANT } = await import("../lib/demo-data");
  const { draftListing, suggestPrice } = await import("../lib/agents/listing");
  const { parseWant } = await import("../lib/agents/summary");
  const { setRecorder, withContext, withDeal } = await import("../lib/runner");
  const repo = await import("../lib/repo");
  const world = await import("../lib/world");
  const deals = await import("../lib/deals");
  const { store } = await import("../lib/store");
  const { formatUsd } = await import("../lib/money");
  const { acceptAndHold, haggle, handoff } = await import("./lib/flow");
  const { launchBrowser } = await import("./lib/approve");
  type TapeEntry = import("../lib/tape").TapeEntry;

  const entries: TapeEntry[] = [];
  setRecorder(entries);

  /* 1. The listing writer, for all three demo photo sets. */
  const draftsFile = path.join(process.cwd(), "fixtures", "listing-drafts.json");
  const drafts: Record<string, unknown> = {};
  for (const item of DEMO_ITEMS) {
    const photos: { dataUrl: string }[] = [];
    for (const url of item.photos) {
      const buf = await fs.readFile(path.join(process.cwd(), "public", url));
      photos.push({ dataUrl: "data:image/jpeg;base64," + buf.toString("base64") });
    }
    const { result } = await withContext("Listing writer", "live", async () => {
      const draft = await draftListing(photos, item.sellerHint, item.key);
      const price = await suggestPrice(draft, item.key, item.sellerHint);
      return { draft, price };
    });
    drafts[item.key] = {
      title: result.draft.title,
      category: result.draft.category,
      description: result.draft.description,
      conditionGrade: result.draft.conditionGrade,
      facts: result.draft.facts,
      suggestedExtras: result.draft.extras,
      ai: result.draft.ai,
      price: { lowCents: result.price.lowCents, highCents: result.price.highCents, suggestedCents: result.price.suggestedCents, basis: result.price.basis, ai: result.price.ai },
      photoCredit: PHOTO_CREDITS[item.key],
    };
    log(`listing ${item.key}: "${result.draft.title}", ${result.draft.facts.length} facts, estimate ${formatUsd(result.price.lowCents)} to ${formatUsd(result.price.highCents)}`);
    for (const f of result.draft.facts) log(`    [${f.kind}] ${f.text}`);
  }
  if (!keepDrafts) await fs.writeFile(draftsFile, JSON.stringify(drafts, null, 2) + "\n", "utf8");

  /* 2. The buyer's request. */
  await withContext("Understanding the request", "live", () => parseWant(DEMO_WANT.text));

  /* 3. The haggle, repeated until it lands on the wanted price. */
  const { listings, privates } = await world.buildDemoListings();
  const bike = listings.find((l) => l.id === "lst_bike")!;
  const bikePrivate = privates.find((p) => p.listingId === bike.id)!;
  await repo.saveListing(bike);
  await repo.saveListingPrivate(bikePrivate);
  const pickupWindowIds = ["sat-am", "sun-mid"];
  const checkpoint = entries.length;
  const dealId = "dl_record";
  let agreed = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    entries.length = checkpoint;
    await store().delete(repo.keys.deal(dealId));
    const created = await deals.createDeal({ listing: bike, ceilingCents: DEMO_WANT.ceilingCents, pickupWindowIds, id: dealId });
    await repo.saveDeal(created);
    log(`\nhaggle attempt ${attempt}:`);
    const deal = await haggle(dealId, log);
    const price = deal.agreed?.offer.priceCents;
    log(`  => ${deal.status}${price ? " at " + formatUsd(price) : ""}`);
    const clean = deal.turns.every((t) => !t.ai?.scripted);
    if (deal.status === "agreed" && clean && (price === wantedCents || attempt === maxAttempts)) {
      agreed = true;
      break;
    }
  }
  if (!agreed) throw new Error("No clean agreed deal was recorded.");

  /* 4. Accept, hold (real buyer approval in PayPal's window), verify. */
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
    await acceptAndHold(dealId, browser, context, { email: process.env.PAYPAL_SANDBOX_BUYER_EMAIL!, password: process.env.PAYPAL_SANDBOX_BUYER_PASSWORD! }, log);
    await context.close();
  } finally {
    await browser.close();
  }

  /* 5. The scam-check example. */
  const { result: scam } = await withDeal(dealId, "message", (d) => deals.humanMessage(d, "seller", SCAM_EXAMPLE));
  log(`  scam example flagged: ${scam.flagged}`);

  /* 6. QR handoff: capture and payout. */
  const final = await handoff(dealId, log);
  if (final.status !== "completed") throw new Error(`The recorded deal ended ${final.status}.`);

  /* 7. Write the fixture. Sandbox account emails are replaced with placeholders. */
  setRecorder(undefined);
  let text = JSON.stringify(
    {
      scenario: "kids-bike",
      recordedAt: new Date().toISOString(),
      note: "Recorded from a real run against the PayPal sandbox and W&B Inference by scripts/record-replay.ts. Replay mode answers from these responses instead of calling out.",
      listing: bike,
      floorCents: bikePrivate.floorCents,
      ceilingCents: DEMO_WANT.ceilingCents,
      pickupWindowIds,
      wantText: DEMO_WANT.text,
      scamExample: SCAM_EXAMPLE,
      entries,
    },
    null,
    1,
  );
  const redact: [string | undefined, string][] = [
    [process.env.PAYPAL_SANDBOX_BUYER_EMAIL, "sandbox-buyer@example.com"],
    [process.env.PAYPAL_SANDBOX_SELLER_EMAIL, "sandbox-seller@example.com"],
  ];
  for (const [value, placeholder] of redact) if (value) text = text.split(value).join(placeholder);
  text = text.replace(/[A-Za-z0-9._-]+@business\.example\.com/g, "sandbox-merchant@example.com");
  const out = path.join(process.cwd(), "fixtures", "replay", "kids-bike.json");
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, text + "\n", "utf8");
  log(`\nWrote ${path.relative(process.cwd(), out)}: ${entries.length} recorded responses, deal at ${formatUsd(final.agreed!.offer.priceCents)}.`);
  const counts: Record<string, number> = {};
  for (const e of entries) counts[e.key.replace(/#\d+$/, "")] = (counts[e.key.replace(/#\d+$/, "")] ?? 0) + 1;
  for (const [k, n] of Object.entries(counts)) log(`  ${k} x${n}`);
}

main().catch((err) => {
  console.error(`\nRecording failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
