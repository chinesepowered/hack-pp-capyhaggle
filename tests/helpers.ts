import { issueMandate } from "@/lib/mandate";
import type { RefereeInput, RefereeListing } from "@/lib/referee";
import type { AgentName, Deal, Offer, SignedMandate } from "@/lib/types";

export const SECRET = "test-mandate-secret";
export const NOW = new Date("2026-11-10T18:00:00Z");

export const listing: RefereeListing = {
  id: "lst_bike",
  title: "Green Kids Bike with Training Wheels",
  category: "kids bike",
  description: "A green children's bicycle with red accents. Bought new two summers ago.",
  conditionGrade: "good",
  askingCents: 9500,
  facts: [
    { id: "f1", kind: "condition", text: "Paint on the frame is bright" },
    { id: "f2", kind: "flaw", text: "Scuffs and paint chips on the red rear fender" },
    { id: "f3", kind: "flaw", text: "Surface rust on the chain and sprocket" },
    { id: "f4", kind: "measurement", text: "Wheel size: about 16 in", estimate: true },
    { id: "f5", kind: "included", text: "Training wheels" },
  ],
  extras: [
    { id: "helmet", label: "Kid's helmet" },
    { id: "lock", label: "Cable lock" },
  ],
  pickupWindows: [
    { id: "sat-am", label: "Sat, Nov 14, 10am to 12pm", startsAt: "2026-11-14T18:00:00Z", endsAt: "2026-11-14T20:00:00Z" },
    { id: "sun-mid", label: "Sun, Nov 15, 11am to 2pm", startsAt: "2026-11-15T19:00:00Z", endsAt: "2026-11-15T22:00:00Z" },
  ],
};

export function buyerMandate(ceilingCents = 9000, overrides: Partial<Parameters<typeof issueMandate>[0]> = {}): SignedMandate {
  return issueMandate({ role: "buyer", owner: "Maya", listingId: listing.id, limitCents: ceilingCents, now: NOW, ...overrides }, SECRET);
}

export function sellerMandate(floorCents = 7500, overrides: Partial<Parameters<typeof issueMandate>[0]> = {}): SignedMandate {
  return issueMandate({ role: "seller", owner: "Theo", listingId: listing.id, limitCents: floorCents, now: NOW, ...overrides }, SECRET);
}

export function input(actor: AgentName, extra: Partial<RefereeInput> = {}): RefereeInput {
  return { listing, actor, mandate: actor === "barley" ? buyerMandate() : sellerMandate(), secret: SECRET, round: 1, now: NOW, ...extra };
}

export const offer = (dollars: number, extras: string[] = [], pickupWindowId = "sat-am"): Offer => ({ priceCents: dollars * 100, pickupWindowId, extras });

export function agreedDeal(priceDollars = 82, overrides: Partial<Deal> = {}): Deal {
  const now = NOW.toISOString();
  return {
    id: "dl_test",
    salt: "abc123",
    mode: "live",
    listingId: listing.id,
    buyerName: "Maya",
    sellerName: "Theo",
    createdAt: now,
    updatedAt: now,
    status: "agreed",
    paused: false,
    mandates: { buyer: buyerMandate(), seller: sellerMandate() },
    turns: [],
    round: 4,
    nextActor: "biscuit",
    lastOffer: {},
    guidance: { buyer: [], seller: [] },
    agreed: {
      offer: offer(priceDollars, ["helmet"]),
      pickupLabel: "Sat, Nov 14, 10am to 12pm",
      pickupEndsAt: "2026-11-14T20:00:00Z",
      atTurn: 7,
      feeCents: 460,
      sellerNetCents: priceDollars * 100 - 460,
    },
    accepts: { buyer: now, seller: now },
    payment: {},
    handoff: {},
    flags: [],
    calls: [],
    webhookEvents: [],
    tapeCounters: {},
    ...overrides,
  };
}

export function codes(verdict: { ok: boolean; violations?: { code: string }[] }): string[] {
  return verdict.ok ? [] : (verdict.violations ?? []).map((v) => v.code);
}
