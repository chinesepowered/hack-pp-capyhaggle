/**
 * Runs the recorded real sandbox run (fixtures/replay/kids-bike.json) through the real engine:
 * referee, guards, state machine. No network is touched. This is also the guard that a change to
 * the rules never silently breaks Replay mode.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.PAYPAL_ENVIRONMENT = "sandbox";
process.env.PAYPAL_CLIENT_ID = "test-client";
process.env.PAYPAL_CLIENT_SECRET = "test-secret";
process.env.PAYPAL_SANDBOX_SELLER_EMAIL = "seller@example.com";
process.env.OPENAI_BASE_URL = "https://models.invalid/v1";
process.env.OPENAI_API_KEY = "test-key";
process.env.MANDATE_SIGNING_SECRET = "test-mandate-secret";
process.env.QR_SIGNING_SECRET = "test-qr-secret";
process.env.CVC_REPLAY_SPEED = "0";
process.env.CVC_TOOLKIT_OFFLINE = "1";

import { acceptDeal, authorizeHold, completeHandoff, ensureSummary, humanMessage, issuePickupQr, refreshFromPayPal, stepDeal, verifyHoldStep } from "@/lib/deals";
import { RuleError } from "@/lib/paypal/errors";
import { createReplayDeal, scenario } from "@/lib/replay";
import { getListing } from "@/lib/repo";
import { withDeal } from "@/lib/runner";
import { memoryStore, setStoreForTests } from "@/lib/store";
import type { Deal } from "@/lib/types";
import { dealView } from "@/lib/views";

let dealId = "";
const fetchSpy = vi.fn(async () => {
  throw new Error("Replay must not touch the network");
});

beforeAll(async () => {
  setStoreForTests(memoryStore());
  vi.stubGlobal("fetch", fetchSpy);
  dealId = (await createReplayDeal()).id;
});

async function run<T>(fn: (deal: Deal, listing: import("@/lib/types").Listing) => Promise<T>) {
  return withDeal(dealId, "test", fn);
}

describe("Replay: the recorded run through the real rules", () => {
  it("haggles to the recorded deal without a single referee block", async () => {
    let deal: Deal | undefined;
    for (let i = 0; i < 20; i++) {
      ({ deal } = await run((d, l) => stepDeal(d, l)));
      if (deal.status !== "negotiating") break;
    }
    expect(deal?.status).toBe("agreed");
    expect(deal?.agreed?.offer.priceCents).toBe(8200);
    const agentTurns = deal!.turns.filter((t) => t.actor === "barley" || t.actor === "biscuit");
    expect(agentTurns.length).toBeGreaterThanOrEqual(4);
    for (const t of agentTurns) {
      expect(t.ai?.replayed).toBe(true);
      expect(t.ai?.scripted).toBeFalsy();
      expect((t.trail ?? []).filter((s) => s.tone === "blocked")).toEqual([]);
    }
    expect(deal!.round).toBeLessThanOrEqual(8);
  });

  it("keeps each side's limit out of the other side's view", async () => {
    const { deal, listing } = await run(async () => undefined);
    const asBuyer = dealView(deal, listing, "buyer");
    const asSeller = dealView(deal, listing, "seller");
    expect(asBuyer.mandates.buyer.limitCents).toBe(9000);
    expect(asBuyer.mandates.seller.limitCents).toBeUndefined();
    expect(asSeller.mandates.seller.limitCents).toBe(7500);
    expect(asSeller.mandates.buyer.limitCents).toBeUndefined();
    expect(JSON.stringify(asSeller)).not.toContain('"limitCents":9000');
    // An agent's private reasoning goes to its own owner only.
    expect(asSeller.turns.filter((t) => t.actor === "barley").every((t) => t.trail === undefined)).toBe(true);
    expect(asBuyer.turns.some((t) => t.actor === "barley" && (t.trail?.length ?? 0) > 0)).toBe(true);
  });

  it("creates no PayPal order until both owners have accepted", async () => {
    await run((d, l) => ensureSummary(d, l));
    let { deal } = await run((d, l) => acceptDeal(d, l, "buyer"));
    expect(deal.status).toBe("agreed");
    expect(deal.payment.orderId).toBeUndefined();
    expect(deal.calls).toHaveLength(0);
    ({ deal } = await run((d, l) => acceptDeal(d, l, "seller")));
    expect(deal.status).toBe("awaiting_payment");
    expect(deal.payment.orderId).toBeTruthy();
    const tool = deal.turns.find((t) => t.tool?.name === "create_held_order");
    expect(tool?.tool?.args).toEqual({ amount_usd: 82, listing_id: deal.listingId });
    expect(deal.calls.map((c) => `${c.method} ${c.path}`)).toContain("POST /v2/checkout/orders");
  });

  it("holds, verifies through the Agent Toolkit tool, and refuses a scam message", async () => {
    let { deal } = await run((d, l) => authorizeHold(d, l));
    expect(deal.status).toBe("held");
    expect(deal.payment.authorizationStatus).toBe("CREATED");
    ({ deal } = await run((d) => verifyHoldStep(d)));
    const verify = deal.turns.find((t) => t.tool?.name === "get_order");
    expect(verify?.tool?.source).toBe("agent-toolkit");
    expect(verify?.tool?.outcome).toContain("authorization CREATED");
    const { result } = await run(async (d) => humanMessage(d, "seller", (await scenario()).scamExample));
    expect(result.flagged).toBe(true);
    ({ deal } = await run(async () => undefined));
    expect(deal.flags[0].source).toBe("rules+llm");
    expect(deal.turns.at(-1)?.kind).toBe("refusal");
    expect(deal.status).toBe("held");
  });

  it("releases the money only for a valid, unused pickup code", async () => {
    const { result: qr } = await run(async (d) => issuePickupQr(d));
    await expect(run((d, l) => completeHandoff(d, l, `${qr.token}x`, "paste"))).rejects.toBeInstanceOf(RuleError);
    const { result: newer } = await run(async (d) => issuePickupQr(d));
    // The first code was replaced by a newer one, so it no longer works.
    await expect(run((d, l) => completeHandoff(d, l, qr.token, "paste"))).rejects.toMatchObject({ code: "QR_SUPERSEDED" });
    let { deal } = await run(async () => undefined);
    expect(deal.status).toBe("held");
    expect(deal.payment.captureId).toBeUndefined();

    ({ deal } = await run((d, l) => completeHandoff(d, l, newer.token, "simulated")));
    expect(deal.status).toBe("completed");
    expect(deal.payment.captureStatus).toBe("COMPLETED");
    expect(deal.payment.payoutBatchId).toBeTruthy();
    expect(deal.handoff.usedAt).toBeTruthy();
    for (let i = 0; i < 8 && deal.payment.payoutItemStatus !== "SUCCESS"; i++) {
      ({ deal } = await run((d, l) => refreshFromPayPal(d, l)));
    }
    expect(deal.payment.payoutItemStatus).toBe("SUCCESS");
  });

  it("answered every call from the recording and left the live shelf alone", async () => {
    const { deal } = await run(async () => undefined);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(deal.calls.length).toBeGreaterThanOrEqual(6);
    expect(deal.calls.every((c) => c.replayed)).toBe(true);
    expect(deal.calls.map((c) => c.path).some((p) => p.endsWith("/capture"))).toBe(true);
    expect(await getListing(deal.listingId)).toBeNull();
  });
});
