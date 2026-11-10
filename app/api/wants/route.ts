import { matchScore, parseWant } from "@/lib/agents/summary";
import { BUYER } from "@/lib/demo-data";
import { body, json, limitAi, modeFrom, route } from "@/lib/http";
import { shortId } from "@/lib/ids";
import { RuleError } from "@/lib/paypal/errors";
import { isReplayListing } from "@/lib/replay";
import { listListings, saveWant, saveWantPrivate } from "@/lib/repo";
import { withContext } from "@/lib/runner";
import type { Want } from "@/lib/types";
import { ensureDemoWorld, freshenListing } from "@/lib/world";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** The buyer says what they want in plain words. The model structures it; code finds the matches. */
export const POST = route(async (req: Request) => {
  limitAi(req);
  const b = await body<{ text?: string; ceilingCents?: number; mode?: string }>(req);
  const text = String(b.text ?? "").trim().slice(0, 500);
  if (text.length < 4) throw new RuleError("WANT_REQUIRED", "Describe what you are looking for.", 400);
  await ensureDemoWorld();
  const { result: parsed } = await withContext("Understanding the request", modeFrom(b.mode), () => parseWant(text));

  const want: Want = {
    id: shortId("want"),
    buyerName: BUYER.name,
    text,
    parsed: { category: parsed.category, keywords: parsed.keywords, when: parsed.when, area: parsed.area, ai: parsed.ai },
    createdAt: new Date().toISOString(),
  };
  await saveWant(want);
  const ceiling = Math.round(Number(b.ceilingCents));
  if (Number.isInteger(ceiling) && ceiling >= 100) await saveWantPrivate({ wantId: want.id, ceilingCents: ceiling });

  const listings = [];
  for (const l of await listListings()) {
    if (l.status !== "active" || isReplayListing(l)) continue;
    listings.push(await freshenListing(l));
  }
  const matches = listings
    .map((listing) => ({ listing, score: matchScore(want.parsed, listing) }))
    .filter((m) => m.score > 0)
    .sort((a, b2) => b2.score - a.score);
  return json({ want, mentionedCeilingCents: parsed.mentionedCeilingCents, matches });
});
