/**
 * The listing writer (vision model) and the price suggestion (text model).
 *
 * The vision model looks at the seller's photos and drafts the listing: title, condition notes, and
 * measurements, which are always flagged as estimates because they are read from a photo. A second
 * call suggests a price range from the drafted facts. Both outputs are labeled as AI in the UI and
 * the seller can edit everything before publishing.
 */
import { aiChat, cleanText, extractJson } from "../ai";
import { env } from "../env";
import type { AiTag, FactKind, ListingExtra, ListingFact } from "../types";

export interface ListingDraft {
  title: string;
  category: string;
  description: string;
  conditionGrade: string;
  facts: ListingFact[];
  extras: ListingExtra[];
  ai: AiTag;
}

export interface PriceDraft {
  lowCents: number;
  highCents: number;
  suggestedCents: number;
  basis: string;
  ai: AiTag;
}

const GRADES = ["like new", "good", "fair", "needs work"];

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
}

function strings(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => cleanText(typeof v === "string" ? v : typeof v === "object" && v && "text" in v ? String((v as { text: unknown }).text) : ""))
    .filter((s) => s.length > 2 && s.length < 200)
    .slice(0, max);
}

/** Turns the model's JSON into a clean draft. Exported for tests. */
export function draftFromJson(json: Record<string, unknown>, tag: AiTag): ListingDraft {
  const facts: ListingFact[] = [];
  const add = (kind: FactKind, items: string[], estimate = false) => {
    for (const text of items) facts.push({ id: `f${facts.length + 1}`, kind, text, ...(estimate ? { estimate: true } : {}) });
  };
  add("condition", strings(json.condition_notes, 5));
  add("flaw", strings(json.flaws, 5));
  const measures = Array.isArray(json.measurements)
    ? json.measurements
        .map((m) => {
          if (typeof m === "string") return cleanText(m);
          if (m && typeof m === "object") {
            const o = m as { label?: unknown; value?: unknown };
            return cleanText(`${String(o.label ?? "").trim()}: ${String(o.value ?? "").trim()}`);
          }
          return "";
        })
        .filter((s) => s.length > 3)
        .slice(0, 5)
    : [];
  add("measurement", measures, true);
  add("feature", strings(json.features, 6));
  const included = strings(json.included, 4);
  add("included", included);
  const extras: ListingExtra[] = strings(json.possible_extras, 3).map((label) => ({ id: slug(label) || "extra", label }));
  const grade = String(json.condition_grade ?? "good").toLowerCase();
  return {
    title: cleanText(String(json.title ?? "Untitled item")).slice(0, 80),
    category: cleanText(String(json.category ?? "other")).toLowerCase().slice(0, 40),
    description: cleanText(String(json.description ?? "")).slice(0, 500),
    conditionGrade: GRADES.includes(grade) ? grade : "good",
    facts,
    extras,
    ai: tag,
  };
}

const VISION_PROMPT = [
  "You write listings for a local secondhand marketplace from the seller's photos.",
  "Look carefully at every photo and describe only what you can actually see. Do not guess a brand, do not invent history, and never claim anything is new or flawless unless it clearly is.",
  "Be a careful inspector. Check metal parts (chain, bolts, spokes, hinges) for rust, check paint and surfaces for scratches or scuffs, check fabric for stains or fading, check tires and wheels. Honest flaws make a listing trustworthy, so list each visible one concretely with where it is.",
  "List the accessories you can see attached (for example a bell, a rack, reflectors, a shelf, a canopy).",
  "If the seller added a note, treat what it says as true and include those facts, in the seller's words, without embellishing.",
  "Measurements are read from a photo, so every measurement is an estimate: write them like 'about 16 in'.",
  "Answer with JSON only, in this shape:",
  "{",
  '  "title": "short plain title, no brand names",',
  '  "category": "kids bike | furniture | stroller | other",',
  '  "condition_grade": "like new | good | fair | needs work",',
  '  "description": "2 or 3 plain sentences a buyer would find useful",',
  '  "condition_notes": ["what looks good, concretely"],',
  '  "flaws": ["each visible flaw with its location; empty if none is visible"],',
  '  "measurements": [{"label": "Wheel size", "value": "about 16 in"}],',
  '  "features": ["visible features and facts from the seller\'s note"],',
  '  "included": ["accessories that come with it, not the item itself"],',
  '  "possible_extras": ["up to 2 small things a seller of this item could plausibly throw in"]',
  "}",
].join("\n");

export interface PhotoInput {
  /** A data URL (data:image/jpeg;base64,...). */
  dataUrl: string;
}

/** Vision: photos in, listing draft out. */
export async function draftListing(photos: PhotoInput[], sellerHint: string, fixtureKey: string): Promise<ListingDraft> {
  const res = await aiChat({
    purpose: `listing.vision.${fixtureKey}`,
    label: "Listing written from photos",
    model: env.visionModel,
    temperature: 0.3,
    maxTokens: 1200,
    messages: [
      { role: "system", content: VISION_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: sellerHint ? `Seller's note: ${sellerHint.slice(0, 300)}` : "No note from the seller. Describe what you see." },
          ...photos.slice(0, 3).map((p) => ({ type: "image_url" as const, image_url: { url: p.dataUrl } })),
        ],
      },
    ],
  });
  const json = extractJson(res.content) as Record<string, unknown>;
  return draftFromJson(json, res.tag);
}

/** Price range from the drafted facts. Always labeled as an estimate. */
export async function suggestPrice(
  draft: Pick<ListingDraft, "title" | "category" | "conditionGrade" | "facts">,
  fixtureKey: string,
  sellerHint = "",
): Promise<PriceDraft> {
  const res = await aiChat({
    purpose: `listing.price.${fixtureKey}`,
    label: "Price estimate",
    temperature: 0.2,
    maxTokens: 500,
    messages: [
      {
        role: "system",
        content: [
          "You estimate a fair local resale price range in US dollars for a used item, from its condition and from what similar used items typically sell for locally.",
          "This is an estimate, not an appraisal. Be realistic for a person-to-person sale, not retail. If the seller's note gives the original price or age, use it: lightly used items in good condition commonly resell for around 40 to 60 percent of what they cost new.",
          'Answer with JSON only: {"low": integer dollars, "high": integer dollars, "suggested": integer dollars, "basis": "one sentence on what the range is based on, mentioning condition"}',
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Item: ${draft.title}`,
          `Category: ${draft.category}`,
          `Condition: ${draft.conditionGrade}`,
          ...(sellerHint ? [`Seller's note: ${sellerHint.slice(0, 300)}`] : []),
          "Facts:",
          ...draft.facts.map((f) => `- ${f.text}`),
        ].join("\n"),
      },
    ],
  });
  const json = extractJson(res.content) as { low?: unknown; high?: unknown; suggested?: unknown; basis?: unknown };
  const low = Math.max(1, Math.round(Number(json.low)));
  const high = Math.max(low, Math.round(Number(json.high)));
  if (!Number.isFinite(low) || !Number.isFinite(high)) throw new Error("The price model did not return numbers.");
  const suggested = Math.min(high, Math.max(low, Math.round(Number(json.suggested) || (low + high) / 2)));
  return { lowCents: low * 100, highCents: high * 100, suggestedCents: suggested * 100, basis: cleanText(String(json.basis ?? "")).slice(0, 240), ai: res.tag };
}
