/**
 * The referee. Deterministic code, no model involved.
 *
 * The agents propose; the referee decides. Every move is checked against the agent's signed
 * mandate and the listing before it reaches the thread:
 *   - an agent cannot bid over its ceiling or under its floor,
 *   - cannot reveal its owner's limit,
 *   - cannot invent facts about the item,
 *   - cannot move payment off the PayPal hold,
 *   - cannot exceed the round limit or backtrack on its own offers,
 * and the referee alone decides when a deal is reached.
 */
import { priceWithinMandate, verifyMandate } from "./mandate";
import { MAX_ROUNDS, ROLE_OF } from "./types";
import type { AgentName, Listing, Offer, ProposedMove, SignedMandate, Violation } from "./types";

export type RefereeListing = Pick<
  Listing,
  "id" | "title" | "description" | "conditionGrade" | "facts" | "extras" | "pickupWindows" | "askingCents" | "category"
>;

export interface RefereeInput {
  listing: RefereeListing;
  actor: AgentName;
  /** The actor's own mandate. The referee verifies the signature itself. */
  mandate: SignedMandate;
  secret: string;
  round: number;
  /** The offer currently on the table, if any, and who made it. */
  standing?: { by: AgentName; offer: Offer };
  /** The actor's own previous offer, for the no-backtracking rule. */
  ownLast?: Offer;
  now?: Date;
}

export type Verdict = { ok: true; move: ProposedMove } | { ok: false; violations: Violation[] };

export const MAX_MESSAGE_LENGTH = 420;

/* ------------------------------------------------------------ text checks */

const NUMBER_WORDS_ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const NUMBER_WORDS_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** 90 -> ["ninety"], 75 -> ["seventy-five", "seventy five"], 120 -> ["one hundred twenty", ...]. */
export function numberWords(n: number): string[] {
  if (!Number.isInteger(n) || n < 0 || n > 9999) return [];
  const under100 = (x: number): string[] => {
    if (x < 20) return [NUMBER_WORDS_ONES[x]];
    const tens = NUMBER_WORDS_TENS[Math.floor(x / 10)];
    const ones = x % 10;
    return ones === 0 ? [tens] : [`${tens}-${NUMBER_WORDS_ONES[ones]}`, `${tens} ${NUMBER_WORDS_ONES[ones]}`];
  };
  if (n < 100) return under100(n);
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const head = hundreds < 20 ? `${NUMBER_WORDS_ONES[hundreds]} hundred` : `${under100(hundreds)[0]} hundred`;
  if (rest === 0) return [head];
  return under100(rest).flatMap((r) => [`${head} ${r}`, `${head} and ${r}`]);
}

/** Dollar amounts written in a message: "$82", "$ 82.50", "82 dollars", "82 bucks". Returned in cents. */
export function moneyMentions(message: string): number[] {
  const out: number[] = [];
  const patterns = [/\$\s?(\d{1,6}(?:\.\d{1,2})?)/g, /\b(\d{1,6}(?:\.\d{1,2})?)\s?(?:dollars?|bucks|usd)\b/gi];
  for (const re of patterns) {
    for (const m of message.matchAll(re)) out.push(Math.round(parseFloat(m[1]) * 100));
  }
  return out;
}

const LIMIT_WORDS =
  /\b(max(?:imum)?|ceiling|floor|budget|limit|cap|lowest|highest|minimum|bottom line|most i|most we|most (?:she|he|they|maya|theo)|least i|least we|least (?:she|he|they|maya|theo)|can(?:'|no)?t go (?:above|over|below|under|lower|higher)|won'?t go (?:above|over|below|under|lower|higher)|no (?:more|less|lower|higher) than|authori[sz]ed (?:up )?to|allowed (?:up )?to|up to)\b/i;

/**
 * True when a message gives away the owner's private limit.
 * allowedCents are prices that are already public in the thread (this offer, the offer on the table).
 */
export function revealsLimit(message: string, limitCents: number, allowedCents: number[] = []): boolean {
  const limitDollars = limitCents / 100;
  const publicPrices = new Set(allowedCents);
  // 1. The limit as a dollar amount that is not simply the price being discussed.
  for (const cents of moneyMentions(message)) {
    if (cents === limitCents && !publicPrices.has(cents)) return true;
  }
  // 2. Limit language next to the limit number, even when the number equals the current price
  //    ("$90 is my max" tells the other side there is nothing above it).
  const lower = message.toLowerCase();
  for (const sentence of lower.split(/(?<=[.!?])\s+/)) {
    if (!LIMIT_WORDS.test(sentence)) continue;
    const numbers = [...sentence.matchAll(/\d{1,6}(?:\.\d{1,2})?/g)].map((m) => parseFloat(m[0]));
    if (numbers.some((n) => n === limitDollars)) return true;
    if (Number.isInteger(limitDollars) && numberWords(limitDollars).some((w) => sentence.includes(w))) return true;
  }
  // 3. The limit spelled out in words anywhere, unless it is the public price.
  if (Number.isInteger(limitDollars) && !publicPrices.has(limitCents)) {
    if (numberWords(limitDollars).some((w) => new RegExp(`\\b${w}\\b`).test(lower))) return true;
  }
  return false;
}

/** Words that assert something about an item. Each must be backed by the listing to be used. */
const CLAIM_TERMS: string[] = [
  // condition grades and history
  "brand new", "like new", "as new", "mint", "pristine", "flawless", "spotless", "immaculate", "perfect condition", "excellent condition",
  "never used", "unused", "barely used", "hardly used", "lightly used", "showroom", "refurbished", "restored", "refinished",
  "professionally serviced", "recently serviced", "tuned up", "tune-up", "tune up", "warranty", "receipt", "original box", "original packaging",
  "certified", "authentic", "vintage", "antique", "smoke-free", "smoke free", "pet-free", "pet free", "one owner",
  "works perfectly", "rides perfectly", "runs perfectly", "good as new", "great shape", "excellent shape", "perfect shape", "great condition",
  // claims that a flaw is trivial are claims too
  "quick wipe", "wipe down", "wipe-down", "wipes off", "easy fix", "easily fixed", "buffs out", "polishes out", "just needs", "only needs", "cosmetic only", "purely cosmetic",
  // negated defects are claims too
  "no scratches", "no scuffs", "no rust", "no damage", "no stains", "no tears", "no dents", "no cracks", "no chips", "no wear", "no wobble",
  // parts and materials
  "new tires", "new tyres", "new brakes", "new chain", "new seat", "new wheels", "new grips", "new fabric",
  "solid wood", "real wood", "hardwood", "teak", "walnut", "oak", "mahogany", "rosewood", "maple", "birch", "veneer", "laminate",
  "leather", "aluminum", "aluminium", "carbon", "steel frame", "alloy", "chrome", "brass", "marble", "glass top",
  // accessories and features
  "helmet", "bell", "basket", "lock", "lights", "kickstand", "training wheels", "water bottle", "bottle cage", "pump", "fenders", "mudguards",
  "rain cover", "cup holder", "car seat", "bassinet", "adapter", "sun shade", "canopy", "storage basket", "footmuff", "diaper bag", "tray",
  "drawer", "shelf", "coasters", "lamp", "hand brake", "coaster brake", "gears", "suspension", "reclines", "one-hand fold", "one hand fold",
  // defects (a buyer may not invent these to push the price down)
  "scratch", "scuff", "rust", "dent", "stain", "tear", "crack", "chip", "wobble", "wobbly", "faded", "worn", "broken", "squeak", "flat tire",
  "flat tyre", "loose", "missing", "bent", "torn", "mold", "mould", "water damage", "water ring", "sticky", "peeling", "frayed",
];

function norm(text: string): string {
  return text.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9'".\- ]+/g, " ").replace(/\s+/g, " ").trim();
}

function stem(term: string): string {
  // Light stemming so "scratch" covers "scratches" and "scratched", "scuff" covers "scuffed".
  return term.replace(/(ches|shes)$/, (m) => m.slice(0, 2)).replace(/(ed|es|s|ing)$/, "");
}

function containsTerm(haystack: string, term: string): boolean {
  const t = term.toLowerCase();
  const pattern = t.includes(" ") || t.includes("-") ? t.replace(/[-\s]+/g, "[-\\s]+") : `${stem(t)}[a-z]*`;
  return new RegExp(`(^|[^a-z])${pattern}([^a-z]|$)`).test(haystack);
}

export function listingCorpus(listing: RefereeListing): string {
  return norm(
    [listing.title, listing.description, listing.conditionGrade, listing.category, ...listing.facts.map((f) => f.text), ...listing.extras.map((e) => e.label)].join(
      " . ",
    ),
  );
}

const UNIT_FAMILIES: [RegExp, string][] = [
  [/^(?:in|inch|inches|")$/, "in"],
  [/^(?:cm|centimeters?|centimetres?)$/, "cm"],
  [/^(?:ft|foot|feet)$/, "ft"],
  [/^(?:lb|lbs|pounds?)$/, "lb"],
  [/^(?:kg|kilos?|kilograms?)$/, "kg"],
  [/^(?:yr|yrs|years?)$/, "yr"],
  [/^(?:mo|mos|months?)$/, "mo"],
  [/^(?:speed|speeds|gear|gears)$/, "speed"],
];

/** Number-with-unit pairs in a text: "16-inch", "about 22 in", "3 years", "7 speed". */
export function measurements(text: string): string[] {
  const out: string[] = [];
  const re = /(\d+(?:\.\d+)?)\s*-?\s*(inches|inch|in|"|centimeters?|centimetres?|cm|feet|foot|ft|pounds?|lbs?|kilograms?|kilos?|kg|years?|yrs?|months?|mos?|speeds?|gears?)(?![a-z])/gi;
  for (const m of text.toLowerCase().matchAll(re)) {
    const family = UNIT_FAMILIES.find(([r]) => r.test(m[2]))?.[1];
    if (family) out.push(`${parseFloat(m[1])}${family}`);
  }
  return out;
}

/**
 * Claims in a message that the listing does not back up. Questions are not claims, so sentences
 * that end with a question mark are skipped.
 */
export function inventedClaims(message: string, listing: RefereeListing): string[] {
  const corpus = listingCorpus(listing);
  const corpusMeasures = new Set(measurements(corpus));
  const invented = new Set<string>();
  for (const sentence of message.split(/(?<=[.!?])\s+/)) {
    if (sentence.trim().endsWith("?")) continue;
    const s = norm(sentence);
    for (const term of CLAIM_TERMS) {
      if (containsTerm(s, term) && !containsTerm(corpus, term)) invented.add(term);
    }
    for (const m of measurements(s)) {
      if (!corpusMeasures.has(m)) invented.add(m.replace(/([a-z]+)$/, " $1"));
    }
  }
  return [...invented];
}

const OFF_PLATFORM =
  /\b(cash|venmo|zelle|cash ?app|wire(?: transfer)?|western union|moneygram|gift ?cards?|crypto|bitcoin|che(?:ck|que)|money order|deposit|bank transfer|pay (?:me |you )?directly|outside (?:of )?(?:paypal|the app)|off[- ]platform|friends and family)\b/i;
const NEGATION = /\b(no|not|never|won't|can't|cannot|don't|without|only through|only via|instead of)\b/i;

/** True when a message proposes paying any way other than the PayPal hold. */
export function proposesOffPlatformPayment(message: string): boolean {
  for (const sentence of message.split(/(?<=[.!?])\s+/)) {
    if (OFF_PLATFORM.test(sentence) && !NEGATION.test(sentence)) return true;
  }
  return false;
}

/* --------------------------------------------------------------- offers */

export function sameOffer(a: Offer, b: Offer): boolean {
  return a.priceCents === b.priceCents && a.pickupWindowId === b.pickupWindowId && [...a.extras].sort().join("|") === [...b.extras].sort().join("|");
}

function checkOfferShape(input: RefereeInput, offer: Offer, violations: Violation[]): void {
  const { listing } = input;
  if (!Number.isInteger(offer.priceCents) || offer.priceCents % 100 !== 0 || offer.priceCents < 100) {
    violations.push({ code: "PRICE_FORMAT", detail: "Prices are whole dollars, at least $1." });
  } else if (offer.priceCents > listing.askingCents * 2) {
    violations.push({ code: "PRICE_FORMAT", detail: "That price is more than double the asking price." });
  }
  if (!listing.pickupWindows.some((w) => w.id === offer.pickupWindowId)) {
    violations.push({ code: "UNKNOWN_PICKUP_WINDOW", detail: `"${offer.pickupWindowId}" is not one of the seller's pickup windows.` });
  }
  const known = new Set(listing.extras.map((e) => e.id));
  const seen = new Set<string>();
  for (const extra of offer.extras) {
    if (!known.has(extra)) violations.push({ code: "UNKNOWN_EXTRA", detail: `"${extra}" is not an extra on this listing.` });
    if (seen.has(extra)) violations.push({ code: "DUPLICATE_EXTRA", detail: `"${extra}" is listed twice.` });
    seen.add(extra);
  }
}

/** Judges one proposed move. Pure: same input, same verdict. */
export function judgeMove(input: RefereeInput, move: ProposedMove): Verdict {
  const violations: Violation[] = [];
  const role = ROLE_OF[input.actor];
  const check = verifyMandate(input.mandate, input.secret, { role, listingId: input.listing.id, now: input.now });
  if (!check.ok) return { ok: false, violations: [{ code: check.code, detail: check.detail }] };
  const mandate = check.mandate;

  if (input.round > MAX_ROUNDS) {
    return { ok: false, violations: [{ code: "ROUND_LIMIT", detail: `The haggle is limited to ${MAX_ROUNDS} rounds.` }] };
  }

  const message = (move.message ?? "").trim();
  if (message.length === 0) violations.push({ code: "EMPTY_MESSAGE", detail: "A move needs a short message." });
  if (message.length > MAX_MESSAGE_LENGTH) violations.push({ code: "MESSAGE_TOO_LONG", detail: `Keep the message under ${MAX_MESSAGE_LENGTH} characters.` });

  const publicPrices: number[] = [input.listing.askingCents];
  if (input.standing) publicPrices.push(input.standing.offer.priceCents);
  if (move.kind === "offer" && move.offer) publicPrices.push(move.offer.priceCents);

  if (revealsLimit(message, mandate.limitCents, publicPrices)) {
    violations.push({ code: "LIMIT_REVEALED", detail: "The message gives away the owner's private limit." });
  }
  const invented = inventedClaims(message, input.listing);
  if (invented.length > 0) {
    violations.push({ code: "INVENTED_FACT", detail: `Not in the listing: ${invented.slice(0, 4).join(", ")}.` });
  }
  if (proposesOffPlatformPayment(message)) {
    violations.push({ code: "OFF_PLATFORM_PAYMENT", detail: "Payment only happens through the PayPal hold." });
  }

  if (move.kind === "offer") {
    const offer = move.offer;
    if (!offer) {
      violations.push({ code: "OFFER_MISSING", detail: "An offer needs a price, a pickup window and extras." });
    } else {
      checkOfferShape(input, offer, violations);
      if (Number.isInteger(offer.priceCents) && !priceWithinMandate(mandate, offer.priceCents)) {
        violations.push(
          role === "buyer"
            ? { code: "OVER_CEILING", detail: "That bid is over the buyer's ceiling." }
            : { code: "UNDER_FLOOR", detail: "That price is under the seller's floor." },
        );
      }
      if (mandate.pickupWindowIds.length > 0 && !mandate.pickupWindowIds.includes(offer.pickupWindowId)) {
        violations.push({ code: "PICKUP_NOT_IN_MANDATE", detail: "The owner cannot make that pickup window." });
      }
      if (input.ownLast) {
        const backtracked = role === "buyer" ? offer.priceCents < input.ownLast.priceCents : offer.priceCents > input.ownLast.priceCents;
        if (backtracked) violations.push({ code: "BACKTRACK", detail: "An agent cannot make a worse offer than its own previous one." });
      }
    }
  } else if (move.kind === "accept") {
    if (!input.standing || input.standing.by === input.actor) {
      violations.push({ code: "NOTHING_TO_ACCEPT", detail: "There is no offer from the other side to accept." });
    } else {
      const offer = input.standing.offer;
      if (!priceWithinMandate(mandate, offer.priceCents)) {
        violations.push({ code: "ACCEPT_OUTSIDE_MANDATE", detail: "That offer is outside the owner's limit and cannot be accepted." });
      }
      if (mandate.pickupWindowIds.length > 0 && !mandate.pickupWindowIds.includes(offer.pickupWindowId)) {
        violations.push({ code: "PICKUP_NOT_IN_MANDATE", detail: "The owner cannot make that pickup window." });
      }
    }
  } else if (move.kind !== "walk") {
    violations.push({ code: "UNKNOWN_MOVE", detail: "A move is an offer, an accept or a walk-away." });
  }

  if (violations.length > 0) return { ok: false, violations };
  return { ok: true, move: { ...move, message } };
}

/* ------------------------------------------------------------ outcomes */

export type Outcome =
  | { type: "continue"; standing: { by: AgentName; offer: Offer } }
  | { type: "deal"; offer: Offer }
  | { type: "walked"; by: AgentName };

/**
 * Decides what a legal move does to the haggle. A deal exists only when one side accepts the
 * other's standing offer, or repeats it exactly.
 */
export function outcomeOf(actor: AgentName, move: ProposedMove, standing?: { by: AgentName; offer: Offer }): Outcome {
  if (move.kind === "walk") return { type: "walked", by: actor };
  if (move.kind === "accept") {
    if (!standing || standing.by === actor) throw new Error("accept without a standing offer from the other side");
    return { type: "deal", offer: standing.offer };
  }
  if (!move.offer) throw new Error("offer move without an offer");
  if (standing && standing.by !== actor && sameOffer(standing.offer, move.offer)) return { type: "deal", offer: standing.offer };
  return { type: "continue", standing: { by: actor, offer: move.offer } };
}

/** Both mandates must cover the agreed terms before any money step. Used again at order time. */
export function dealWithinBothMandates(
  listing: RefereeListing,
  offer: Offer,
  mandates: { buyer: SignedMandate; seller: SignedMandate },
  secret: string,
  now?: Date,
): { ok: true } | { ok: false; violations: Violation[] } {
  const violations: Violation[] = [];
  for (const role of ["buyer", "seller"] as const) {
    const check = verifyMandate(mandates[role], secret, { role, listingId: listing.id, now });
    if (!check.ok) {
      violations.push({ code: check.code, detail: `${role}: ${check.detail}` });
      continue;
    }
    if (!priceWithinMandate(check.mandate, offer.priceCents)) {
      violations.push({ code: role === "buyer" ? "OVER_CEILING" : "UNDER_FLOOR", detail: `The price is outside the ${role}'s mandate.` });
    }
    if (check.mandate.pickupWindowIds.length > 0 && !check.mandate.pickupWindowIds.includes(offer.pickupWindowId)) {
      violations.push({ code: "PICKUP_NOT_IN_MANDATE", detail: `The ${role} cannot make that pickup window.` });
    }
  }
  return violations.length > 0 ? { ok: false, violations } : { ok: true };
}
