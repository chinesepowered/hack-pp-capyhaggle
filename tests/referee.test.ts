import { describe, expect, it } from "vitest";
import { signMandate } from "@/lib/mandate";
import { dealWithinBothMandates, inventedClaims, judgeMove, measurements, moneyMentions, numberWords, outcomeOf, proposesOffPlatformPayment, revealsLimit } from "@/lib/referee";
import { buyerMandate, codes, input, listing, NOW, offer, SECRET, sellerMandate } from "./helpers";

describe("referee: an agent cannot bid outside its mandate", () => {
  it("refuses a buyer bid over the ceiling", () => {
    const v = judgeMove(input("barley"), { kind: "offer", offer: offer(91), message: "How about this price?" });
    expect(codes(v)).toContain("OVER_CEILING");
  });

  it("allows a buyer bid at the ceiling", () => {
    const v = judgeMove(input("barley"), { kind: "offer", offer: offer(90), message: "I can do $90." });
    expect(v.ok).toBe(true);
  });

  it("refuses a seller price under the floor", () => {
    const v = judgeMove(input("biscuit"), { kind: "offer", offer: offer(74), message: "I can come down to this." });
    expect(codes(v)).toContain("UNDER_FLOOR");
  });

  it("refuses accepting an offer that is outside the acceptor's mandate", () => {
    const v = judgeMove(input("barley", { standing: { by: "biscuit", offer: offer(93) } }), { kind: "accept", message: "Deal." });
    expect(codes(v)).toContain("ACCEPT_OUTSIDE_MANDATE");
    const v2 = judgeMove(input("biscuit", { standing: { by: "barley", offer: offer(70) } }), { kind: "accept", message: "Deal." });
    expect(codes(v2)).toContain("ACCEPT_OUTSIDE_MANDATE");
  });

  it("refuses a pickup window the owner cannot make", () => {
    const mandate = buyerMandate(9000, { pickupWindowIds: ["sun-mid"] });
    const v = judgeMove(input("barley", { mandate }), { kind: "offer", offer: offer(80, [], "sat-am"), message: "Saturday morning?" });
    expect(codes(v)).toContain("PICKUP_NOT_IN_MANDATE");
  });
});

describe("referee: the mandate itself is verified", () => {
  it("refuses a mandate whose limit was edited after signing", () => {
    const signed = buyerMandate(9000);
    const tampered = { ...signed, mandate: { ...signed.mandate, limitCents: 20000 } };
    const v = judgeMove(input("barley", { mandate: tampered }), { kind: "offer", offer: offer(150), message: "Money is no object." });
    expect(codes(v)).toEqual(["MANDATE_BAD_SIGNATURE"]);
  });

  it("refuses a mandate signed with another secret", () => {
    const forged = signMandate(buyerMandate().mandate, "someone-elses-secret");
    expect(codes(judgeMove(input("barley", { mandate: forged }), { kind: "offer", offer: offer(80), message: "Hello." }))).toEqual(["MANDATE_BAD_SIGNATURE"]);
  });

  it("refuses an expired mandate", () => {
    const later = new Date(NOW.getTime() + 73 * 3600_000);
    expect(codes(judgeMove(input("barley", { now: later }), { kind: "offer", offer: offer(80), message: "Hello." }))).toEqual(["MANDATE_EXPIRED"]);
  });

  it("refuses a mandate for a different item or the wrong role", () => {
    const other = buyerMandate(9000, { listingId: "lst_table" });
    expect(codes(judgeMove(input("barley", { mandate: other }), { kind: "offer", offer: offer(80), message: "Hello." }))).toEqual(["MANDATE_WRONG_ITEM"]);
    expect(codes(judgeMove(input("barley", { mandate: sellerMandate() }), { kind: "offer", offer: offer(80), message: "Hello." }))).toEqual(["MANDATE_WRONG_ROLE"]);
  });
});

describe("referee: an agent cannot reveal its owner's limit", () => {
  it("catches the limit as a dollar amount", () => {
    const v = judgeMove(input("barley"), { kind: "offer", offer: offer(80), message: "I can do $80, though I am allowed to go to $90." });
    expect(codes(v)).toContain("LIMIT_REVEALED");
  });

  it("catches limit language even when the number is the offer itself", () => {
    const v = judgeMove(input("barley"), { kind: "offer", offer: offer(90), message: "$90 is my max, I cannot go above that." });
    expect(codes(v)).toContain("LIMIT_REVEALED");
  });

  it("catches the limit spelled out in words", () => {
    expect(revealsLimit("My owner said ninety and not a penny more.", 9000)).toBe(true);
    expect(revealsLimit("We will not take less than seventy-five dollars.", 7500)).toBe(true);
  });

  it("catches a seller revealing the floor", () => {
    const v = judgeMove(input("biscuit"), { kind: "offer", offer: offer(85), message: "I can do $85. The lowest I can go is $75." });
    expect(codes(v)).toContain("LIMIT_REVEALED");
  });

  it("does not flag ordinary price talk", () => {
    expect(revealsLimit("I can come up to $82 with the helmet.", 9000, [8200])).toBe(false);
    expect(revealsLimit("Asking is $95, could you do $78?", 9000, [9500, 7800])).toBe(false);
    // Offering exactly the limit without saying it is the limit is allowed.
    expect(revealsLimit("I can do $90 for Saturday morning.", 9000, [9000])).toBe(false);
  });

  it("reads money mentions and number words", () => {
    expect(moneyMentions("$82, or 85 dollars, or 90 bucks")).toEqual([8200, 8500, 9000]);
    expect(numberWords(90)).toEqual(["ninety"]);
    expect(numberWords(75)).toContain("seventy-five");
  });
});

describe("referee: an agent cannot invent facts about the item", () => {
  it("refuses a condition claim the listing does not make", () => {
    const v = judgeMove(input("biscuit"), { kind: "offer", offer: offer(92), message: "It is in mint condition with brand new tires." });
    expect(codes(v)).toContain("INVENTED_FACT");
  });

  it("refuses an accessory that is not on the listing", () => {
    expect(inventedClaims("It comes with a basket and lights.", listing)).toEqual(expect.arrayContaining(["basket", "lights"]));
  });

  it("refuses a buyer inventing damage to push the price down", () => {
    const v = judgeMove(input("barley"), { kind: "offer", offer: offer(70), message: "With that dent in the frame and the flat tire, $70 is fair." });
    expect(codes(v)).toContain("INVENTED_FACT");
  });

  it("refuses a measurement that differs from the listing", () => {
    expect(inventedClaims("Those 20-inch wheels are great.", listing)).toContain("20 in");
    expect(inventedClaims("The 16 inch wheels suit a 6-year-old.", listing)).toEqual([]);
    expect(measurements('about 16 in, 3 years, 7-speed, 20"')).toEqual(["16in", "3yr", "7speed", "20in"]);
  });

  it("allows claims the listing backs up, including listed extras", () => {
    const v = judgeMove(input("barley"), {
      kind: "offer",
      offer: offer(78, ["helmet"]),
      message: "The chain has surface rust and the rear fender has paint chips, so I can do $78 with the helmet.",
    });
    expect(v.ok).toBe(true);
  });

  it("does not treat a question as a claim", () => {
    expect(inventedClaims("Does it come with a basket?", listing)).toEqual([]);
  });
});

describe("referee: payment stays on the PayPal hold", () => {
  it("refuses cash, deposits and other rails", () => {
    for (const message of ["I can pay cash on Saturday.", "Send a deposit by gift card and it is yours.", "Let us settle it by Venmo instead."]) {
      expect(codes(judgeMove(input("barley"), { kind: "offer", offer: offer(80), message }))).toContain("OFF_PLATFORM_PAYMENT");
    }
  });

  it("allows saying no to them", () => {
    expect(proposesOffPlatformPayment("No cash and no deposits, only the PayPal hold.")).toBe(false);
  });
});

describe("referee: structure, rounds and backtracking", () => {
  it("refuses unknown pickup windows and extras", () => {
    const v = judgeMove(input("barley"), { kind: "offer", offer: { priceCents: 8000, pickupWindowId: "mon-am", extras: ["pump"] }, message: "Monday?" });
    expect(codes(v)).toEqual(expect.arrayContaining(["UNKNOWN_PICKUP_WINDOW", "UNKNOWN_EXTRA"]));
  });

  it("refuses prices that are not whole dollars", () => {
    const v = judgeMove(input("barley"), { kind: "offer", offer: { priceCents: 8050, pickupWindowId: "sat-am", extras: [] }, message: "Split it?" });
    expect(codes(v)).toContain("PRICE_FORMAT");
  });

  it("refuses backtracking on an agent's own previous offer", () => {
    expect(codes(judgeMove(input("barley", { ownLast: offer(80) }), { kind: "offer", offer: offer(78), message: "Actually, less." }))).toContain("BACKTRACK");
    expect(codes(judgeMove(input("biscuit", { ownLast: offer(85) }), { kind: "offer", offer: offer(88), message: "Actually, more." }))).toContain("BACKTRACK");
  });

  it("enforces the 8 round limit", () => {
    expect(codes(judgeMove(input("barley", { round: 9 }), { kind: "offer", offer: offer(80), message: "One more?" }))).toEqual(["ROUND_LIMIT"]);
    expect(judgeMove(input("barley", { round: 8 }), { kind: "offer", offer: offer(80), message: "Last one." }).ok).toBe(true);
  });

  it("refuses an accept when nothing from the other side is on the table", () => {
    expect(codes(judgeMove(input("barley"), { kind: "accept", message: "Deal." }))).toContain("NOTHING_TO_ACCEPT");
    expect(codes(judgeMove(input("barley", { standing: { by: "barley", offer: offer(80) } }), { kind: "accept", message: "Deal." }))).toContain("NOTHING_TO_ACCEPT");
  });

  it("always lets an agent walk away", () => {
    expect(judgeMove(input("biscuit"), { kind: "walk", message: "We are too far apart. Thank you for the soak." }).ok).toBe(true);
  });
});

describe("referee: only the referee declares a deal", () => {
  it("a legal accept of the standing offer is a deal at that offer", () => {
    const standing = { by: "biscuit" as const, offer: offer(82, ["helmet"]) };
    const v = judgeMove(input("barley", { standing, ownLast: offer(80) }), { kind: "accept", message: "Deal at $82." });
    expect(v.ok).toBe(true);
    expect(outcomeOf("barley", { kind: "accept", message: "Deal." }, standing)).toEqual({ type: "deal", offer: standing.offer });
  });

  it("repeating the other side's offer exactly is a deal, a different offer is not", () => {
    const standing = { by: "biscuit" as const, offer: offer(82, ["helmet"]) };
    expect(outcomeOf("barley", { kind: "offer", offer: offer(82, ["helmet"]), message: "OK." }, standing).type).toBe("deal");
    expect(outcomeOf("barley", { kind: "offer", offer: offer(82, []), message: "No helmet." }, standing).type).toBe("continue");
    expect(outcomeOf("biscuit", { kind: "walk", message: "Bye." }, standing)).toEqual({ type: "walked", by: "biscuit" });
  });

  it("checks both mandates again before any money step", () => {
    const mandates = { buyer: buyerMandate(9000), seller: sellerMandate(7500) };
    expect(dealWithinBothMandates(listing, offer(82), mandates, SECRET, NOW).ok).toBe(true);
    const tooHigh = dealWithinBothMandates(listing, offer(92), mandates, SECRET, NOW);
    expect(tooHigh.ok).toBe(false);
    const tooLow = dealWithinBothMandates(listing, offer(70), mandates, SECRET, NOW);
    expect(tooLow.ok).toBe(false);
  });
});
