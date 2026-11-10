/**
 * Small text helpers that use the model: the deal summary each owner reads before tapping Accept,
 * and parsing a buyer's free-text want. The numbers shown next to these texts always come from code.
 */
import { aiChat, AiUnavailableError, cleanText, extractJson } from "../ai";
import { formatUsd, formatUsdExact } from "../money";
import type { AiTag, Deal, Listing, Want } from "../types";

export function dealFacts(deal: Deal, listing: Listing): string[] {
  if (!deal.agreed) return [];
  const { offer, feeCents, sellerNetCents } = deal.agreed;
  const win = deal.agreed.pickupLabel;
  const extras = offer.extras.map((id) => listing.extras.find((e) => e.id === id)?.label ?? id);
  return [
    `Item: ${listing.title}`,
    `Agreed price: ${formatUsd(offer.priceCents)} (asking was ${formatUsd(listing.askingCents)})`,
    `Pickup: ${win}, ${listing.area}`,
    `Extras included: ${extras.length ? extras.join(", ") : "none"}`,
    `Marketplace fee: ${formatUsdExact(feeCents)}; seller receives ${formatUsdExact(sellerNetCents)}`,
    `Rounds used: ${Math.min(deal.round, 8)}`,
  ];
}

function scriptedSummary(deal: Deal, listing: Listing): { buyer: string; seller: string } {
  const { offer, sellerNetCents } = deal.agreed!;
  const win = deal.agreed!.pickupLabel;
  return {
    buyer: `Barley agreed ${formatUsd(offer.priceCents)} for the ${listing.title.toLowerCase()}, pickup ${win}. PayPal holds your money until the seller scans your QR code.`,
    seller: `Biscuit agreed ${formatUsd(offer.priceCents)} for the ${listing.title.toLowerCase()}, pickup ${win}. You receive ${formatUsdExact(sellerNetCents)} the moment you scan the buyer's QR code.`,
  };
}

/** Two short summaries, one per owner. Falls back to a code-written summary if the model is down. */
export async function summarizeDeal(deal: Deal, listing: Listing): Promise<{ buyer: string; seller: string; ai: AiTag }> {
  const facts = dealFacts(deal, listing);
  const thread = deal.turns
    .filter((t) => t.kind === "offer" || t.kind === "accept")
    .map((t) => `${t.actor}: ${t.offer ? formatUsd(t.offer.priceCents) + " " : ""}${t.message}`)
    .join("\n");
  try {
    const res = await aiChat({
      purpose: "deal.summary",
      label: "Deal summary",
      temperature: 0.4,
      maxTokens: 500,
      messages: [
        {
          role: "system",
          content: [
            "Two capybara agents just finished haggling for their owners. Write a short summary for each owner so they can decide to tap Accept.",
            "Use only the facts given. Do not add numbers that are not in the facts. Plain friendly words, 2 sentences each, no emojis, no em dashes.",
            `The buyer is ${deal.buyerName} (agent Barley). The seller is ${deal.sellerName} (agent Biscuit). Mention how the haggle went in a few words.`,
            'Answer with JSON only: {"buyer": "...", "seller": "..."}',
          ].join("\n"),
        },
        { role: "user", content: `FACTS\n${facts.join("\n")}\n\nTHREAD\n${thread}` },
      ],
    });
    const json = extractJson(res.content) as { buyer?: unknown; seller?: unknown };
    const buyer = cleanText(String(json.buyer ?? ""));
    const seller = cleanText(String(json.seller ?? ""));
    if (buyer.length < 10 || seller.length < 10) throw new Error("summary too short");
    return { buyer: buyer.slice(0, 400), seller: seller.slice(0, 400), ai: res.tag };
  } catch (err) {
    if (!(err instanceof AiUnavailableError) && !(err instanceof Error)) throw err;
    return { ...scriptedSummary(deal, listing), ai: { model: "scripted", purpose: "Deal summary", scripted: true } };
  }
}

export interface ParsedWant {
  category: string;
  keywords: string[];
  when: string;
  area: string;
  /** A budget the buyer mentioned in the text, in cents, if any. Shown as a suggestion only. */
  mentionedCeilingCents?: number;
  ai?: AiTag;
}

function scriptedWant(text: string): ParsedWant {
  const lower = text.toLowerCase();
  const category = /bike|bicycle/.test(lower) ? "kids bike" : /stroller|pram|pushchair/.test(lower) ? "stroller" : /table|desk|chair|shelf|dresser|furniture/.test(lower) ? "furniture" : "other";
  const money = lower.match(/\$\s?(\d{1,5})|under (\d{1,5})|(\d{1,5}) (?:dollars|bucks)/);
  const amount = money ? Number(money[1] ?? money[2] ?? money[3]) : undefined;
  return {
    category,
    keywords: lower.split(/[^a-z0-9]+/).filter((w) => w.length > 3).slice(0, 6),
    when: /weekend/.test(lower) ? "this weekend" : /today|tonight/.test(lower) ? "today" : "flexible",
    area: text.match(/near (?:the )?([A-Z][\w ]{2,24})/)?.[1]?.trim() ?? "nearby",
    mentionedCeilingCents: amount ? amount * 100 : undefined,
  };
}

/** Reads a free-text want into structured fields. The private ceiling is confirmed by the buyer separately. */
export async function parseWant(text: string): Promise<ParsedWant> {
  try {
    const res = await aiChat({
      purpose: "want.parse",
      label: "Understanding the request",
      temperature: 0,
      maxTokens: 400,
      messages: [
        {
          role: "system",
          content: [
            "Extract what a buyer on a local secondhand marketplace is looking for.",
            'Answer with JSON only: {"category": "kids bike | furniture | stroller | other", "keywords": ["3 to 6 lowercase search words"], "when": "short phrase such as this weekend", "area": "place name or nearby", "budget_usd": integer or null}',
          ].join("\n"),
        },
        { role: "user", content: text.slice(0, 500) },
      ],
    });
    const json = extractJson(res.content) as { category?: unknown; keywords?: unknown; when?: unknown; area?: unknown; budget_usd?: unknown };
    const budget = Number(json.budget_usd);
    return {
      category: cleanText(String(json.category ?? "other")).toLowerCase(),
      keywords: Array.isArray(json.keywords) ? json.keywords.map((k) => cleanText(String(k)).toLowerCase()).filter(Boolean).slice(0, 6) : [],
      when: cleanText(String(json.when ?? "flexible")),
      area: cleanText(String(json.area ?? "nearby")),
      mentionedCeilingCents: Number.isFinite(budget) && budget > 0 ? Math.round(budget) * 100 : undefined,
      ai: res.tag,
    };
  } catch (err) {
    if (!(err instanceof Error)) throw err;
    return scriptedWant(text);
  }
}

/** Scores a listing against a want. Code, not a model: simple and explainable. */
export function matchScore(want: Pick<Want["parsed"], "category" | "keywords">, listing: Pick<Listing, "title" | "category" | "description">): number {
  const hay = `${listing.title} ${listing.category} ${listing.description}`.toLowerCase();
  let score = 0;
  if (want.category !== "other" && (listing.category.toLowerCase().includes(want.category) || want.category.includes(listing.category.toLowerCase()))) score += 5;
  for (const k of want.keywords) if (k.length > 2 && hay.includes(k)) score += 1;
  return score;
}
