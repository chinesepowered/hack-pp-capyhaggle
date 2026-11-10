/**
 * The deal state machine: haggle, accept, hold, handoff, payout, void, refund.
 *
 * Money rules live here and in lib/guards.ts, in code. The models propose; this file decides.
 * PayPal is the source of truth for money: we store PayPal ids and re-read their status.
 */
import { agentTurn } from "./agents/negotiator";
import { checkMessage, refusalLine } from "./agents/scam";
import { decideHold, refundThroughToolkit, verifyHold } from "./agents/settlement";
import { summarizeDeal } from "./agents/summary";
import { currentContext, withFeature } from "./context";
import { env } from "./env";
import { shortId } from "./ids";
import { issueMandate } from "./mandate";
import { feeFor, formatUsd, formatUsdExact, sellerNetFor } from "./money";
import { PayPalApiError, PayPalUnknownOutcomeError, RuleError } from "./paypal/errors";
import { authorizeOrder, createHoldOrder, getOrder } from "./paypal/orders";
import { captureAuthorization, getAuthorization, getCapture, needsReauthorization, reauthorize, voidAuthorization } from "./paypal/payments";
import { createPayout, getPayout } from "./paypal/payouts";
import { checkQrAgainstDeal, issueQr, verifyQr } from "./qr";
import { dealWithinBothMandates, outcomeOf } from "./referee";
import { claimWrite, getListingPrivate, releaseWrite, saveListing } from "./repo";
import { AGENT_FOR, AGENT_LABEL, MAX_ROUNDS, OWNER_NAME } from "./types";
import type { AgentName, Deal, Listing, Mode, Role, Turn, TurnActor } from "./types";

const now = () => new Date().toISOString();

function pushTurn(deal: Deal, turn: Omit<Turn, "n" | "round" | "at"> & { at?: string }): Turn {
  const full: Turn = { n: deal.turns.length + 1, round: deal.round, at: turn.at ?? now(), ...turn };
  deal.turns.push(full);
  return full;
}

function requestId(deal: Deal, what: string): string {
  return `cvc-${deal.id}-${deal.salt}-${what}`;
}

function windowLabel(listing: Listing, id: string): string {
  return listing.pickupWindows.find((w) => w.id === id)?.label ?? id;
}

/* -------------------------------------------------------------- creation */

export interface CreateDealInput {
  listing: Listing;
  buyerName?: string;
  wantId?: string;
  ceilingCents: number;
  pickupWindowIds: string[];
  mode?: Mode;
  id?: string;
  seeded?: boolean;
}

export async function createDeal(input: CreateDealInput): Promise<Deal> {
  const { listing } = input;
  if (listing.status !== "active") throw new RuleError("LISTING_NOT_AVAILABLE", "This item is already reserved or sold.");
  const priv = await getListingPrivate(listing.id);
  if (!priv) throw new RuleError("LISTING_HAS_NO_MANDATE", "The seller has not set a floor for this listing.", 500);
  if (!Number.isInteger(input.ceilingCents) || input.ceilingCents < 100) throw new RuleError("BAD_CEILING", "Set a ceiling of at least $1.", 400);
  const known = new Set(listing.pickupWindows.map((w) => w.id));
  const windows = input.pickupWindowIds.filter((id) => known.has(id));
  const buyerName = input.buyerName ?? OWNER_NAME.buyer;
  const buyerMandate = issueMandate({ role: "buyer", owner: buyerName, listingId: listing.id, limitCents: input.ceilingCents, pickupWindowIds: windows }, env.mandateSecret);
  const created = now();
  const deal: Deal = {
    id: input.id ?? shortId("dl"),
    salt: shortId("s", 6).slice(2),
    mode: input.mode ?? "live",
    listingId: listing.id,
    wantId: input.wantId,
    buyerName,
    sellerName: listing.sellerName,
    createdAt: created,
    updatedAt: created,
    status: "negotiating",
    paused: false,
    mandates: { buyer: buyerMandate, seller: priv.mandate },
    turns: [],
    round: 1,
    nextActor: "barley",
    lastOffer: {},
    guidance: { buyer: [], seller: [] },
    accepts: {},
    payment: {},
    handoff: {},
    flags: [],
    calls: [],
    webhookEvents: [],
    tapeCounters: {},
    seeded: input.seeded,
  };
  pushTurn(deal, {
    actor: "system",
    kind: "system",
    message: `${buyerName} and ${listing.sellerName} each gave their capybara a signed mandate. Barley and Biscuit are haggling over "${listing.title}" (asking ${formatUsd(listing.askingCents)}).`,
  });
  return deal;
}

/* ------------------------------------------------------------ the haggle */

/** Runs exactly one agent turn. The client calls this repeatedly, so there is no long-running process. */
export async function stepDeal(deal: Deal, listing: Listing): Promise<void> {
  if (deal.status !== "negotiating" || deal.paused) return;
  if (deal.round > MAX_ROUNDS) {
    endWithoutDeal(deal, "expired", `The referee ended the haggle: ${MAX_ROUNDS} rounds without a deal.`);
    return;
  }
  const actor = deal.nextActor;
  const result = await withFeature(`Haggle: ${AGENT_LABEL[actor]}'s move`, () => agentTurn(actor, deal, listing, env.mandateSecret));
  const outcome = outcomeOf(actor, result.move, deal.standing ? { by: deal.standing.by, offer: deal.standing.offer } : undefined);

  if (outcome.type === "walked") {
    pushTurn(deal, { actor, kind: "walk", message: result.move.message, ai: result.ai, trail: result.trail });
    endWithoutDeal(deal, "walked", `${AGENT_LABEL[actor]} walked away. No deal, and no money moved.`);
    return;
  }

  if (outcome.type === "deal") {
    // A second, independent check of both mandates before the referee declares a deal.
    const both = dealWithinBothMandates(listing, outcome.offer, deal.mandates, env.mandateSecret);
    if (!both.ok) {
      pushTurn(deal, { actor: "referee", kind: "system", message: `The referee refused the deal: ${both.violations.map((v) => v.detail).join(" ")}` });
      endWithoutDeal(deal, "walked", "The deal could not be confirmed inside both mandates.");
      return;
    }
    pushTurn(deal, { actor, kind: "accept", message: result.move.message, offer: outcome.offer, ai: result.ai, trail: result.trail });
    const feeCents = feeFor(outcome.offer.priceCents);
    const win = listing.pickupWindows.find((w) => w.id === outcome.offer.pickupWindowId);
    deal.agreed = {
      offer: outcome.offer,
      pickupLabel: win?.label ?? outcome.offer.pickupWindowId,
      pickupEndsAt: win?.endsAt ?? new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
      atTurn: deal.turns.length,
      feeCents,
      sellerNetCents: sellerNetFor(outcome.offer.priceCents),
    };
    deal.status = "agreed";
    deal.standing = undefined;
    pushTurn(deal, {
      actor: "referee",
      kind: "system",
      message: `Deal reached at ${formatUsd(outcome.offer.priceCents)}, pickup ${windowLabel(listing, outcome.offer.pickupWindowId)}. Both mandates check out. Waiting for ${deal.buyerName} and ${deal.sellerName} to tap Accept.`,
    });
    return;
  }

  const offer = outcome.standing.offer;
  pushTurn(deal, { actor, kind: "offer", message: result.move.message, offer, ai: result.ai, trail: result.trail });
  deal.standing = { by: actor, offer, turn: deal.turns.length };
  deal.lastOffer[actor] = offer;
  if (actor === "biscuit") {
    deal.round += 1;
    if (deal.round > MAX_ROUNDS) {
      endWithoutDeal(deal, "expired", `The referee ended the haggle: ${MAX_ROUNDS} rounds without a deal. No money moved.`);
      return;
    }
  }
  deal.nextActor = actor === "barley" ? "biscuit" : "barley";
}

function endWithoutDeal(deal: Deal, status: "walked" | "expired", note: string): void {
  deal.status = status;
  deal.outcomeNote = note;
  pushTurn(deal, { actor: "referee", kind: "system", message: note });
}

export function setPaused(deal: Deal, paused: boolean, role: Role): void {
  if (deal.status !== "negotiating") return;
  if (deal.paused === paused) return;
  deal.paused = paused;
  pushTurn(deal, { actor: "system", kind: "system", message: `${OWNER_NAME[role]} ${paused ? "paused" : "resumed"} the haggle.` });
}

export function humanWalk(deal: Deal, role: Role): void {
  if (deal.status !== "negotiating" && deal.status !== "agreed") throw new RuleError("TOO_LATE_TO_WALK", "The haggle is already over.");
  pushTurn(deal, { actor: role === "buyer" ? "maya" : "theo", kind: "human", message: "I am walking away from this one. Thanks anyway." });
  endWithoutDeal(deal, "walked", `${OWNER_NAME[role]} walked away. No deal, and no money moved.`);
}

/** A human jumps in. The safety check runs first; a flagged message is refused by the other side's agent. */
export async function humanMessage(deal: Deal, role: Role, text: string): Promise<{ flagged: boolean }> {
  const clean = text.trim().slice(0, 500);
  if (!clean) throw new RuleError("EMPTY_MESSAGE", "Type a message first.", 400);
  if (!["negotiating", "agreed", "awaiting_payment", "held"].includes(deal.status)) throw new RuleError("THREAD_CLOSED", "This thread is closed.");
  const actor: TurnActor = role === "buyer" ? "maya" : "theo";
  const flag = await withFeature("Safety check", () => checkMessage(clean, role));
  if (flag) {
    deal.flags.push(flag);
    pushTurn(deal, { actor, kind: "human", message: clean, flagId: flag.id });
    const refuser: AgentName = role === "buyer" ? "biscuit" : "barley";
    pushTurn(deal, { actor: refuser, kind: "refusal", message: refusalLine(refuser, flag), ai: flag.ai });
    if (deal.status === "negotiating" && !deal.paused) {
      deal.paused = true;
      pushTurn(deal, { actor: "system", kind: "system", message: "The haggle is paused after a safety flag. Either owner can resume it." });
    }
    return { flagged: true };
  }
  pushTurn(deal, { actor, kind: "human", message: clean });
  // Guidance goes to that owner's own agent only, and still cannot widen the signed mandate.
  if (deal.status === "negotiating") deal.guidance[role].push(clean);
  return { flagged: false };
}

/* ---------------------------------------------------------------- accept */

export async function ensureSummary(deal: Deal, listing: Listing): Promise<void> {
  if (!deal.agreed || deal.agreed.summary) return;
  deal.agreed.summary = await withFeature("Deal summary", () => summarizeDeal(deal, listing));
}

/** An owner taps Accept. When both have, Barley places the PayPal hold. */
export async function acceptDeal(deal: Deal, listing: Listing, role: Role): Promise<void> {
  if (deal.status !== "agreed" || !deal.agreed) throw new RuleError("NOTHING_TO_ACCEPT", "There is no agreed deal to accept.");
  if (!deal.accepts[role]) {
    deal.accepts[role] = now();
    pushTurn(deal, { actor: "system", kind: "system", message: `${role === "buyer" ? deal.buyerName : deal.sellerName} tapped Accept on ${formatUsd(deal.agreed.offer.priceCents)}.` });
  }
  if (deal.accepts.buyer && deal.accepts.seller) await placeHold(deal, listing);
}

/** Creates the PayPal order with intent AUTHORIZE, through Barley's guarded tool. */
export async function placeHold(deal: Deal, listing: Listing): Promise<void> {
  if (deal.payment.orderId) return;
  if (!deal.agreed) throw new RuleError("NO_AGREED_DEAL", "There is no agreed deal to pay for.");
  await withFeature("Accept: Barley places the PayPal hold", async () => {
    let decision;
    try {
      decision = await decideHold(deal, listing, env.mandateSecret);
    } catch (err) {
      const e = err as Error & { guard?: boolean; code?: string };
      if (e.guard) throw new RuleError(e.code ?? "GUARD_REFUSED", e.message);
      throw err;
    }
    // Claim first, then call PayPal, then record (paypal-plan.md, DUPLICATE CLAIMS).
    const claimed = await claimWrite(deal.id, "order");
    if (!claimed && currentContext().mode === "live") throw new RuleError("ORDER_IN_PROGRESS", "The PayPal order for this deal is already being created.");
    try {
      const order = await createHoldOrder({
        dealId: deal.id,
        requestId: requestId(deal, "order"),
        amountCents: decision.value.amountCents,
        title: listing.title,
        description: `${listing.title}, local pickup ${deal.agreed!.pickupLabel}`,
        returnUrl: `${env.appUrl}/deal/${deal.id}?paypal=approved`,
        cancelUrl: `${env.appUrl}/deal/${deal.id}?paypal=cancelled`,
      });
      deal.payment.orderId = order.id;
      deal.payment.orderStatus = order.status;
      deal.payment.checkedAt = now();
      deal.status = "awaiting_payment";
      pushTurn(deal, {
        actor: "barley",
        kind: "tool",
        message: `I set up the PayPal payment for ${formatUsdExact(decision.value.amountCents)}. ${deal.buyerName}, approve it with PayPal and the money is held, not sent, until pickup.`,
        ai: decision.ai,
        trail: decision.trail,
        tool: { name: "create_held_order", args: decision.args, outcome: `PayPal order ${order.id} (${order.status}, intent AUTHORIZE)`, source: "capy" },
      });
    } catch (err) {
      if (err instanceof PayPalApiError) await releaseWrite(deal.id, "order");
      throw err;
    }
  });
}

/** After the buyer approved in PayPal's window: authorize. The money is now held. */
export async function authorizeHold(deal: Deal, listing: Listing): Promise<void> {
  if (deal.status === "held" && deal.payment.authorizationId) return;
  if (deal.status !== "awaiting_payment" || !deal.payment.orderId) throw new RuleError("NO_ORDER", "There is no PayPal order waiting for approval.");
  await withFeature("Pay: authorize the approved order (hold)", async () => {
    await claimWrite(deal.id, "authorize");
    try {
      const order = await authorizeOrder(deal.payment.orderId!, requestId(deal, "authorize"));
      if (!order.authorization) throw new RuleError("NOT_AUTHORIZED", "PayPal did not return an authorization for this order.", 502);
      if (order.authorization.amountCents !== undefined && order.authorization.amountCents !== deal.agreed!.offer.priceCents) {
        throw new RuleError("AMOUNT_MISMATCH", "PayPal's authorized amount does not match the agreed price.", 502);
      }
      deal.payment.orderStatus = order.status;
      deal.payment.authorizationId = order.authorization.id;
      deal.payment.authorizationStatus = order.authorization.status;
      deal.payment.authorizationExpiresAt = order.authorization.expiresAt;
      deal.payment.authorizedAt = order.authorization.createdAt ?? now();
      deal.payment.checkedAt = now();
      deal.status = "held";
      listing.status = "reserved";
      await saveListing(listing);
      pushTurn(deal, {
        actor: "system",
        kind: "system",
        message: `Payment held by PayPal: ${formatUsdExact(deal.agreed!.offer.priceCents)}. Nothing has been sent to the seller yet.`,
      });
    } catch (err) {
      if (err instanceof PayPalApiError) await releaseWrite(deal.id, "authorize");
      throw err;
    }
  });
}

/** Biscuit verifies the hold with PayPal through the Agent Toolkit. */
export async function verifyHoldStep(deal: Deal): Promise<void> {
  if (deal.status !== "held" || !deal.payment.orderId) throw new RuleError("NOTHING_TO_VERIFY", "There is no held payment to verify.");
  if (deal.turns.some((t) => t.tool?.name === "get_order")) return;
  await withFeature("Verify: Biscuit checks the hold (Agent Toolkit)", async () => {
    const v = await verifyHold(deal);
    pushTurn(deal, {
      actor: "biscuit",
      kind: "tool",
      message: v.line,
      ai: v.ai,
      trail: v.trail,
      tool: { name: "get_order", args: v.args, outcome: `order ${v.orderStatus ?? "unknown"}, authorization ${v.authorizationStatus ?? "none"}, ${v.amount ?? "?"} USD`, source: "agent-toolkit" },
    });
  });
}

/* --------------------------------------------------------------- handoff */

/** A fresh, signed, single-use pickup code for the buyer to show. */
export function issuePickupQr(deal: Deal): { token: string; expiresAt: string } {
  if (deal.status !== "held") throw new RuleError("NOT_HELD", "A pickup code exists only while PayPal holds the money.");
  const { token, payload } = issueQr(deal.id, env.qrSecret);
  deal.handoff = { nonce: payload.n, qrIssuedAt: now(), qrExpiresAt: new Date(payload.e * 1000).toISOString() };
  return { token, expiresAt: deal.handoff.qrExpiresAt! };
}

/**
 * The seller scans the buyer's QR code. The scan captures the authorization, and the marketplace
 * pays the seller at once through Payouts, minus the fee shown at Accept.
 */
export async function completeHandoff(deal: Deal, listing: Listing, token: string, via: "camera" | "paste" | "simulated"): Promise<void> {
  if (deal.status === "completed") return;
  if (deal.status !== "held" || !deal.payment.authorizationId || !deal.payment.orderId || !deal.agreed) {
    throw new RuleError("NOT_HELD", "There is no held payment to release.");
  }
  const verified = verifyQr(token, env.qrSecret);
  if (!verified.ok) throw new RuleError(verified.code, verified.detail, 400);
  const matches = checkQrAgainstDeal(verified.payload, deal);
  if (!matches.ok) throw new RuleError(matches.code, matches.detail, 400);

  await withFeature("Handoff: QR scan captures the hold", async () => {
    // Burn the nonce before any money moves: the code is single use even if a later step fails.
    deal.handoff.usedAt = now();
    deal.handoff.scannedVia = via;
    await claimWrite(deal.id, "capture");
    try {
      const auth = await getAuthorization(deal.payment.authorizationId!);
      deal.payment.authorizationStatus = auth.status;
      if (auth.status === "CREATED" && needsReauthorization(auth)) {
        // Past the 3-day honor period: reauthorize first so the capture is not declined.
        const fresh = await reauthorize(deal.payment.authorizationId!, requestId(deal, "reauthorize"));
        deal.payment.authorizationId = fresh.id || deal.payment.authorizationId;
        deal.payment.authorizationExpiresAt = fresh.expiresAt;
        deal.payment.reauthorized = true;
      } else if (auth.status !== "CREATED" && auth.status !== "CAPTURED") {
        throw new RuleError("HOLD_GONE", `PayPal says the hold is ${auth.status}. Nothing was charged.`);
      }
      const capture = await captureAuthorization({
        authorizationId: deal.payment.authorizationId!,
        orderId: deal.payment.orderId!,
        requestId: requestId(deal, "capture"),
        invoiceId: `${deal.id}-${deal.salt}`,
        noteToPayer: `Pickup confirmed by QR scan: ${listing.title}`,
      });
      deal.payment.captureId = capture.id;
      deal.payment.captureStatus = capture.status;
      deal.payment.capturedAt = capture.createdAt ?? now();
      deal.payment.paypalFeeCents = capture.paypalFeeCents;
      deal.payment.authorizationStatus = "CAPTURED";
      pushTurn(deal, { actor: "system", kind: "system", message: `QR code scanned. PayPal captured ${formatUsdExact(deal.agreed!.offer.priceCents)} from the hold.` });
    } catch (err) {
      if (err instanceof PayPalApiError || err instanceof RuleError) {
        await releaseWrite(deal.id, "capture");
        // The scan did not move money, so the buyer can show a fresh code.
        deal.handoff.usedAt = undefined;
      }
      if (err instanceof PayPalUnknownOutcomeError) deal.payment.unknown = "capture";
      throw err;
    }
  });
  await payoutSeller(deal, listing);
}

/** Pays the seller: price minus the marketplace fee, through Payouts. */
export async function payoutSeller(deal: Deal, listing: Listing): Promise<void> {
  if (deal.payment.payoutBatchId || !deal.payment.captureId || !deal.agreed) return;
  if (deal.payment.captureStatus !== "COMPLETED") return; // a pending capture pays out once it completes (see refreshFromPayPal)
  await withFeature("Handoff: payout to the seller", async () => {
    await claimWrite(deal.id, "payout");
    try {
      const payout = await createPayout({
        senderBatchId: requestId(deal, "payout"),
        senderItemId: requestId(deal, "item"),
        receiverEmail: env.sellerEmail,
        amountCents: deal.agreed!.sellerNetCents,
        note: `${listing.title}: sold for ${formatUsdExact(deal.agreed!.offer.priceCents)}, fee ${formatUsdExact(deal.agreed!.feeCents)}`,
        emailSubject: "Your Capy vs Capy sale was paid out",
        emailMessage: `The buyer's QR code was scanned at pickup, so your money for "${listing.title}" is on its way.`,
      });
      deal.payment.payoutBatchId = payout.batchId;
      deal.payment.payoutBatchStatus = payout.batchStatus;
      deal.payment.payoutItemId = payout.itemId;
      deal.payment.payoutItemStatus = payout.itemStatus;
      deal.payment.payoutTransactionId = payout.transactionId;
      deal.payment.checkedAt = now();
      deal.status = "completed";
      listing.status = "sold";
      await saveListing(listing);
      pushTurn(deal, {
        actor: "system",
        kind: "system",
        message: `Payout sent to ${deal.sellerName}: ${formatUsdExact(deal.agreed!.sellerNetCents)} (price ${formatUsdExact(deal.agreed!.offer.priceCents)} minus the ${formatUsdExact(deal.agreed!.feeCents)} fee).`,
      });
    } catch (err) {
      if (err instanceof PayPalApiError) await releaseWrite(deal.id, "payout");
      if (err instanceof PayPalUnknownOutcomeError) deal.payment.unknown = "payout";
      throw err;
    }
  });
}

/* --------------------------------------------------------- void / refund */

export function pickupWindowEnded(deal: Deal, at = new Date()): boolean {
  return deal.agreed ? at.getTime() > new Date(deal.agreed.pickupEndsAt).getTime() : false;
}

/** No-show: the authorization is voided and the hold on the buyer's money is released. */
export async function voidHold(deal: Deal, listing: Listing, reason: string): Promise<void> {
  if (deal.status === "voided") return;
  if (!["held", "awaiting_payment"].includes(deal.status)) throw new RuleError("NOTHING_TO_VOID", "There is no hold to release.");
  await withFeature("No-show: void the authorization", async () => {
    if (deal.payment.authorizationId) {
      await claimWrite(deal.id, "void");
      try {
        const auth = await voidAuthorization(deal.payment.authorizationId, requestId(deal, "void"));
        deal.payment.authorizationStatus = auth.status;
      } catch (err) {
        if (err instanceof PayPalApiError) await releaseWrite(deal.id, "void");
        throw err;
      }
    }
    deal.payment.voidedAt = now();
    deal.payment.voidReason = reason;
    deal.payment.checkedAt = now();
    deal.status = "voided";
    deal.handoff = {};
    listing.status = "active";
    await saveListing(listing);
    pushTurn(deal, {
      actor: "system",
      kind: "system",
      message: deal.payment.authorizationId
        ? `${reason} PayPal voided the authorization, so the hold on ${deal.buyerName}'s ${formatUsdExact(deal.agreed?.offer.priceCents ?? 0)} is released. Nobody was charged.`
        : `${reason} The order was never approved, so nothing was held.`,
    });
  });
}

/** The buyer reports a problem within 24 hours: Barley refunds through the Agent Toolkit, behind the guard. */
export async function refundBuyer(deal: Deal, listing: Listing, reason: string): Promise<void> {
  if (deal.status === "refunded") return;
  await withFeature("Problem reported: refund (Agent Toolkit)", async () => {
    const claimed = await claimWrite(deal.id, "refund");
    if (!claimed && currentContext().mode === "live") throw new RuleError("REFUND_IN_PROGRESS", "A refund for this deal is already in progress.");
    let result;
    try {
      result = await refundThroughToolkit(deal, reason);
    } catch (err) {
      await releaseWrite(deal.id, "refund");
      const e = err as Error & { guard?: boolean; code?: string };
      if (e.guard) throw new RuleError(e.code ?? "GUARD_REFUSED", e.message);
      throw err;
    }
    pushTurn(deal, {
      actor: "barley",
      kind: "tool",
      message: result.line,
      ai: result.ai,
      trail: result.trail,
      tool: { name: "create_refund", args: result.args, outcome: result.ok ? `refund ${result.refundId} (${result.refundStatus})` : "refused by PayPal", source: "agent-toolkit" },
    });
    if (!result.ok) {
      await releaseWrite(deal.id, "refund");
      throw new RuleError("REFUND_FAILED", "PayPal did not accept the refund. Nothing changed.", 502);
    }
    deal.payment.refundId = result.refundId;
    deal.payment.refundStatus = result.refundStatus;
    deal.payment.refundedAt = now();
    deal.status = "refunded";
    void listing;
  });
}

/* ------------------------------------------------------- re-read PayPal */

/**
 * Polling path: re-read whatever PayPal objects this deal has and bring the stored state in line.
 * Screens call this whenever they need fresh state, so nothing depends on webhook delivery.
 */
export async function refreshFromPayPal(deal: Deal, listing: Listing): Promise<boolean> {
  const before = JSON.stringify([deal.status, deal.payment]);
  await withFeature("Refresh: re-read PayPal status", async () => {
    const p = deal.payment;
    if (deal.status === "awaiting_payment" && p.orderId) {
      const order = await getOrder(p.orderId);
      p.orderStatus = order.status;
      if (order.authorization) {
        // Authorized elsewhere (for example the buyer finished in another tab).
        p.authorizationId = order.authorization.id;
        p.authorizationStatus = order.authorization.status;
        p.authorizationExpiresAt = order.authorization.expiresAt;
        p.authorizedAt = order.authorization.createdAt ?? now();
        deal.status = "held";
        listing.status = "reserved";
        await saveListing(listing);
        pushTurn(deal, { actor: "system", kind: "system", message: `Payment held by PayPal: ${formatUsdExact(deal.agreed?.offer.priceCents ?? 0)}. Nothing has been sent to the seller yet.` });
      }
    } else if (deal.status === "held" && p.authorizationId) {
      const auth = await getAuthorization(p.authorizationId);
      p.authorizationStatus = auth.status;
      p.authorizationExpiresAt = auth.expiresAt ?? p.authorizationExpiresAt;
      if (auth.status === "VOIDED") {
        p.voidedAt = p.voidedAt ?? now();
        deal.status = "voided";
        listing.status = "active";
        await saveListing(listing);
        pushTurn(deal, { actor: "system", kind: "system", message: "PayPal reports the authorization was voided. The hold is released and nobody was charged." });
      } else if (auth.status === "CAPTURED" && !p.captureId) {
        // A capture whose answer we never received: settle it from what PayPal holds.
        const order = await getOrder(p.orderId!);
        if (order.captureId) {
          const capture = await getCapture(order.captureId);
          p.captureId = capture.id;
          p.captureStatus = capture.status;
          p.capturedAt = capture.createdAt ?? now();
          p.paypalFeeCents = capture.paypalFeeCents;
          p.unknown = undefined;
        }
      }
    }
    if (p.captureId && p.captureStatus && p.captureStatus !== "COMPLETED" && deal.status === "held") {
      const capture = await getCapture(p.captureId);
      p.captureStatus = capture.status;
    }
    if (p.payoutBatchId && !["SUCCESS", "DENIED", "CANCELED"].includes(p.payoutBatchStatus ?? "")) {
      const payout = await getPayout(p.payoutBatchId);
      p.payoutBatchStatus = payout.batchStatus;
      p.payoutItemId = payout.itemId ?? p.payoutItemId;
      p.payoutItemStatus = payout.itemStatus ?? p.payoutItemStatus;
      p.payoutTransactionId = payout.transactionId ?? p.payoutTransactionId;
      if (payout.itemStatus === "SUCCESS" && !p.paidOutAt) {
        p.paidOutAt = payout.timeCompleted ?? now();
        pushTurn(deal, { actor: "system", kind: "system", message: `PayPal confirms the payout reached ${deal.sellerName}: ${formatUsdExact(deal.agreed?.sellerNetCents ?? 0)}.` });
      }
    } else if (p.payoutBatchId && p.payoutItemStatus !== "SUCCESS" && p.payoutBatchStatus === "SUCCESS") {
      const payout = await getPayout(p.payoutBatchId);
      p.payoutItemStatus = payout.itemStatus ?? p.payoutItemStatus;
      p.payoutTransactionId = payout.transactionId ?? p.payoutTransactionId;
    }
    p.checkedAt = now();
  });
  // A capture that completed without a payout (for example after an unknown outcome) pays out now.
  if (deal.payment.captureId && deal.payment.captureStatus === "COMPLETED" && !deal.payment.payoutBatchId && deal.status === "held") {
    await payoutSeller(deal, listing);
  }
  // The buyer did not show by the end of the pickup window (plus an hour of grace): release the hold.
  if (deal.status === "held" && !deal.payment.captureId && pickupWindowEnded(deal, new Date(Date.now() - 3600_000))) {
    await voidHold(deal, listing, `${deal.buyerName} did not show by the end of the pickup window.`);
  }
  return JSON.stringify([deal.status, deal.payment]) !== before;
}

export { AGENT_FOR };
