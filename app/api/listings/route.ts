import { cleanText } from "@/lib/ai";
import { SELLER, upcomingPickupWindows } from "@/lib/demo-data";
import { body, json, route } from "@/lib/http";
import { shortId } from "@/lib/ids";
import { RuleError } from "@/lib/paypal/errors";
import { saveListing, saveListingPrivate } from "@/lib/repo";
import type { AiTag, FactKind, Listing, ListingExtra, ListingFact, PriceSuggestion } from "@/lib/types";
import { sellerPrivate } from "@/lib/world";

export const dynamic = "force-dynamic";

const KINDS: FactKind[] = ["condition", "flaw", "measurement", "feature", "included"];

interface Body {
  title?: string;
  category?: string;
  description?: string;
  conditionGrade?: string;
  facts?: { kind?: string; text?: string; estimate?: boolean }[];
  extras?: { label?: string }[];
  photos?: string[];
  askingCents?: number;
  floorCents?: number;
  pickupWindowIds?: string[];
  bundlesOk?: boolean;
  ai?: AiTag;
  suggestion?: PriceSuggestion;
  [key: string]: unknown;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24) || "extra";

/** Publish a listing. The floor is private: it goes into the seller's signed mandate, not the listing. */
export const POST = route(async (req: Request) => {
  const b = await body<Body>(req);
  const title = cleanText(String(b.title ?? "")).slice(0, 80);
  if (title.length < 3) throw new RuleError("TITLE_REQUIRED", "Give the listing a title.", 400);
  const asking = Math.round(Number(b.askingCents));
  const floor = Math.round(Number(b.floorCents));
  if (!Number.isInteger(asking) || asking < 100 || asking % 100 !== 0) throw new RuleError("BAD_PRICE", "Set an asking price in whole dollars.", 400);
  if (!Number.isInteger(floor) || floor < 100 || floor > asking) throw new RuleError("BAD_FLOOR", "The private floor must be at least $1 and no more than the asking price.", 400);

  const facts: ListingFact[] = (Array.isArray(b.facts) ? b.facts : [])
    .map((f) => ({ kind: (KINDS.includes(f.kind as FactKind) ? f.kind : "condition") as FactKind, text: cleanText(String(f.text ?? "")).slice(0, 200), estimate: f.kind === "measurement" ? true : undefined }))
    .filter((f) => f.text.length > 2)
    .slice(0, 16)
    .map((f, i) => ({ id: `f${i + 1}`, ...f }));
  const extras: ListingExtra[] = (Array.isArray(b.extras) ? b.extras : [])
    .map((e) => cleanText(String(e.label ?? "")).slice(0, 40))
    .filter((label) => label.length > 1)
    .slice(0, 3)
    .map((label) => ({ id: slug(label), label }));
  const allWindows = upcomingPickupWindows();
  const chosen = Array.isArray(b.pickupWindowIds) ? allWindows.filter((w) => b.pickupWindowIds!.includes(w.id)) : [];
  const photos = (Array.isArray(b.photos) ? b.photos : []).filter((p) => typeof p === "string" && (p.startsWith("/items/") || p.startsWith("data:image/"))).slice(0, 3);

  const listing: Listing = {
    id: shortId("lst"),
    sellerName: SELLER.name,
    title,
    category: cleanText(String(b.category ?? "other")).toLowerCase().slice(0, 40),
    description: cleanText(String(b.description ?? "")).slice(0, 500),
    conditionGrade: cleanText(String(b.conditionGrade ?? "good")).toLowerCase().slice(0, 20),
    facts,
    extras,
    photos,
    askingCents: asking,
    suggestion: b.suggestion,
    area: SELLER.area,
    pickupWindows: chosen.length ? chosen : allWindows,
    prefs: { bundlesOk: b.bundlesOk !== false, noCash: true },
    status: "active",
    ai: b.ai,
    createdAt: new Date().toISOString(),
  };
  await saveListing(listing);
  await saveListingPrivate(sellerPrivate(listing.id, floor));
  return json({ id: listing.id, listing });
});
