import { promises as fs } from "node:fs";
import path from "node:path";
import { draftListing, suggestPrice, type PhotoInput } from "@/lib/agents/listing";
import { DEMO_ITEMS } from "@/lib/demo-data";
import { body, json, limitAi, modeFrom, route } from "@/lib/http";
import { RuleError } from "@/lib/paypal/errors";
import { withContext } from "@/lib/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_PHOTO_CHARS = 1_600_000;

async function demoPhotos(key: string): Promise<{ photos: PhotoInput[]; urls: string[]; hint: string }> {
  const item = DEMO_ITEMS.find((i) => i.key === key);
  if (!item) throw new RuleError("UNKNOWN_DEMO_SET", "Unknown demo photo set.", 400);
  const photos: PhotoInput[] = [];
  const urls: string[] = [];
  for (const url of item.photos) {
    try {
      const file = await fs.readFile(path.join(process.cwd(), "public", url));
      photos.push({ dataUrl: `data:image/jpeg;base64,${file.toString("base64")}` });
      urls.push(url);
    } catch {
      // A demo set may have one photo instead of two.
    }
  }
  if (photos.length === 0) throw new RuleError("DEMO_PHOTOS_MISSING", "The demo photos are missing from public/items.", 500);
  return { photos, urls, hint: item.sellerHint };
}

/**
 * The listing writes itself: the vision model drafts the listing from the seller's photos, then the
 * text model suggests a price range. Both are labeled as AI estimates and stay editable.
 */
export const POST = route(async (req: Request) => {
  limitAi(req, 2);
  const b = await body<{ photos?: string[]; demoKey?: string; hint?: string; mode?: string }>(req);
  const mode = modeFrom(b.mode);
  let photos: PhotoInput[];
  let urls: string[];
  let hint = String(b.hint ?? "").slice(0, 300);
  let fixtureKey = "custom";

  if (b.demoKey) {
    const demo = await demoPhotos(b.demoKey);
    photos = demo.photos;
    urls = demo.urls;
    hint = hint || demo.hint;
    fixtureKey = b.demoKey;
  } else {
    const given = Array.isArray(b.photos) ? b.photos.filter((p): p is string => typeof p === "string" && p.startsWith("data:image/")) : [];
    if (given.length === 0) throw new RuleError("PHOTOS_REQUIRED", "Add at least one photo.", 400);
    if (given.some((p) => p.length > MAX_PHOTO_CHARS)) throw new RuleError("PHOTO_TOO_LARGE", "A photo is too large. Photos are resized in the browser before upload.", 413);
    photos = given.slice(0, 3).map((dataUrl) => ({ dataUrl }));
    urls = given.slice(0, 3);
  }

  const { result } = await withContext("Listing writer", mode, async () => {
    const draft = await draftListing(photos, hint, fixtureKey);
    const price = await suggestPrice(draft, fixtureKey, hint);
    return { draft, price };
  });
  return json({ ...result, photos: urls, hint });
});
