/**
 * Records the listing drafts for the three demo items: the vision model writes each listing from
 * the photos in public/items, and the text model suggests a price range. The result is saved to
 * fixtures/listing-drafts.json and used by the seed, so the hosted demo starts with real
 * model-written listings without calling the model again.
 *
 *   pnpm tsx scripts/draft-listings.ts [bike table stroller]
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadEnv, requireEnv } from "./lib/env";

loadEnv();

const CREDITS: Record<string, string> = {
  bike: "Photos: Donald Trung Quoc Don, Wikimedia Commons, CC BY-SA 4.0",
  table: "Photos: The Living Room (Flickr), CC BY 2.0",
  stroller: "Photo: Daniel X. O'Neil (Flickr), CC BY 2.0",
};

async function main() {
  requireEnv(["OPENAI_BASE_URL", "OPENAI_API_KEY"]);
  const { DEMO_ITEMS } = await import("../lib/demo-data");
  const { draftListing, suggestPrice } = await import("../lib/agents/listing");
  const { withContext } = await import("../lib/runner");
  const file = path.join(process.cwd(), "fixtures", "listing-drafts.json");
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
  } catch {
    // first run
  }
  const only = process.argv.slice(2);
  for (const item of DEMO_ITEMS) {
    if (only.length && !only.includes(item.key)) continue;
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
    const { draft, price } = result;
    existing[item.key] = {
      title: draft.title,
      category: draft.category,
      description: draft.description,
      conditionGrade: draft.conditionGrade,
      facts: draft.facts,
      suggestedExtras: draft.extras,
      ai: draft.ai,
      price: { lowCents: price.lowCents, highCents: price.highCents, suggestedCents: price.suggestedCents, basis: price.basis, ai: price.ai },
      photoCredit: CREDITS[item.key],
    };
    console.log("\n== " + item.key + " (" + draft.ai.model + ")");
    console.log(draft.title, "|", draft.category, "|", draft.conditionGrade);
    console.log(draft.description);
    for (const f of draft.facts) console.log(" - [" + f.kind + "] " + f.text + (f.estimate ? " (estimate)" : ""));
    console.log(" extras suggested:", draft.extras.map((e) => e.label).join(", "));
    console.log(" price: $" + price.lowCents / 100 + " to $" + price.highCents / 100 + ", suggested $" + price.suggestedCents / 100 + " (" + price.ai.model + "): " + price.basis);
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(existing, null, 2) + "\n", "utf8");
  console.log("\nWrote " + path.relative(process.cwd(), file));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
