/**
 * Developer tool: runs N live haggles on the bike listing and prints where they end.
 * Used to choose demo numbers that make the brief's example outcome likely.
 *
 *   pnpm tsx scripts/video/haggle-odds.ts --asking 95 --floor 75 --ceiling 90 --n 10
 */
import os from "node:os";
import path from "node:path";
import { loadEnv } from "../lib/env";

loadEnv();
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
process.env.CVC_DATA_DIR = path.join(os.tmpdir(), `cvc-odds-${process.pid}-${Date.now()}`);

async function main() {
  const asking = Number(arg("asking", "95")) * 100;
  const floor = Number(arg("floor", "75")) * 100;
  const ceiling = Number(arg("ceiling", "90")) * 100;
  const n = Number(arg("n", "10"));
  const repo = await import("../../lib/repo");
  const world = await import("../../lib/world");
  const deals = await import("../../lib/deals");
  const { store } = await import("../../lib/store");
  const { haggle } = await import("../lib/flow");
  const { listings } = await world.buildDemoListings();
  const bike = { ...listings.find((l) => l.id === "lst_bike")!, askingCents: asking };
  await repo.saveListing(bike);
  await repo.saveListingPrivate(world.sellerPrivate(bike.id, floor));
  const results: string[] = [];
  for (let i = 0; i < n; i++) {
    await store().delete(repo.keys.deal("dl_odds"));
    const created = await deals.createDeal({ listing: bike, ceilingCents: ceiling, pickupWindowIds: ["sat-am", "sun-mid"], id: "dl_odds" });
    await repo.saveDeal(created);
    const deal = await haggle("dl_odds", () => undefined);
    const offers = deal.turns.filter((t) => t.kind === "offer").map((t) => `${t.actor[1]}${t.offer!.priceCents / 100}`);
    const last = deal.turns.filter((t) => t.kind === "accept").at(-1);
    results.push(deal.agreed ? String(deal.agreed.offer.priceCents / 100) : deal.status);
    console.log(`asking ${asking / 100}: ${results.at(-1)} (${last?.actor ?? "-"} accepted) ${offers.join(" ")}`);
  }
  console.log(`asking ${asking / 100} => ${results.join(", ")}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
