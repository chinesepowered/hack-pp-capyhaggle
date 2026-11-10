/**
 * What each person is allowed to see. The buyer never receives the seller's floor, the seller never
 * receives the buyer's ceiling, and an agent's private notes go to its own owner only.
 */
import { REFUND_WINDOW_MS } from "./guards";
import { FEE_FIXED_CENTS, FEE_PERCENT } from "./money";
import { ROLE_OF } from "./types";
import type { Deal, Listing, ListingPrivate, Role, Turn } from "./types";

export interface MandateView {
  id: string;
  agent: string;
  owner: string;
  role: Role;
  issuedAt: string;
  expiresAt: string;
  /** First characters of the signature, enough to show it is signed without being useful. */
  sigShort: string;
  /** Present only in the owner's own view. */
  limitCents?: number;
  pickupWindowIds?: string[];
}

export interface DealView {
  id: string;
  mode: Deal["mode"];
  role: Role;
  status: Deal["status"];
  paused: boolean;
  buyerName: string;
  sellerName: string;
  createdAt: string;
  updatedAt: string;
  round: number;
  maxRounds: number;
  nextActor: Deal["nextActor"];
  standing?: Deal["standing"];
  turns: Turn[];
  mandates: { buyer: MandateView; seller: MandateView };
  agreed?: Deal["agreed"];
  accepts: Deal["accepts"];
  payment: Deal["payment"];
  handoff: { qrIssuedAt?: string; qrExpiresAt?: string; usedAt?: string; scannedVia?: string };
  flags: Deal["flags"];
  calls: Deal["calls"];
  webhookEvents: Deal["webhookEvents"];
  outcomeNote?: string;
  seeded?: boolean;
  fee: { percent: number; fixedCents: number };
  listing: Listing;
  can: {
    step: boolean;
    pause: boolean;
    jumpIn: boolean;
    accept: boolean;
    pay: boolean;
    showQr: boolean;
    scan: boolean;
    reportNoShow: boolean;
    refund: boolean;
  };
}

function mandateView(deal: Deal, which: Role, viewer: Role): MandateView {
  const { mandate, sig } = deal.mandates[which];
  return {
    id: mandate.id,
    agent: mandate.agent,
    owner: mandate.owner,
    role: mandate.role,
    issuedAt: mandate.issuedAt,
    expiresAt: mandate.expiresAt,
    sigShort: `${sig.slice(0, 10)}...`,
    ...(which === viewer ? { limitCents: mandate.limitCents, pickupWindowIds: mandate.pickupWindowIds } : {}),
  };
}

function turnView(turn: Turn, viewer: Role): Turn {
  if (turn.actor !== "barley" && turn.actor !== "biscuit") return turn;
  if (ROLE_OF[turn.actor] === viewer) return turn;
  // The other side's agent: the public move stays, the private reasoning goes.
  const rest: Turn = { ...turn };
  delete rest.trail;
  return rest;
}

export function dealView(deal: Deal, listing: Listing, viewer: Role, at = new Date()): DealView {
  const refundOpen =
    deal.status === "completed" && !!deal.payment.capturedAt && at.getTime() - new Date(deal.payment.capturedAt).getTime() <= REFUND_WINDOW_MS && !deal.payment.refundId;
  return {
    id: deal.id,
    mode: deal.mode,
    role: viewer,
    status: deal.status,
    paused: deal.paused,
    buyerName: deal.buyerName,
    sellerName: deal.sellerName,
    createdAt: deal.createdAt,
    updatedAt: deal.updatedAt,
    round: deal.round,
    maxRounds: 8,
    nextActor: deal.nextActor,
    standing: deal.standing,
    turns: deal.turns.map((t) => turnView(t, viewer)),
    mandates: { buyer: mandateView(deal, "buyer", viewer), seller: mandateView(deal, "seller", viewer) },
    agreed: deal.agreed,
    accepts: deal.accepts,
    payment: deal.payment,
    handoff: { qrIssuedAt: deal.handoff.qrIssuedAt, qrExpiresAt: deal.handoff.qrExpiresAt, usedAt: deal.handoff.usedAt, scannedVia: deal.handoff.scannedVia },
    flags: deal.flags,
    calls: deal.calls,
    webhookEvents: deal.webhookEvents,
    outcomeNote: deal.outcomeNote,
    seeded: deal.seeded,
    fee: { percent: FEE_PERCENT, fixedCents: FEE_FIXED_CENTS },
    listing,
    can: {
      step: deal.status === "negotiating" && !deal.paused,
      pause: deal.status === "negotiating",
      jumpIn: ["negotiating", "agreed", "awaiting_payment", "held"].includes(deal.status),
      accept: deal.status === "agreed" && !deal.accepts[viewer],
      pay: deal.status === "awaiting_payment" && viewer === "buyer",
      showQr: deal.status === "held" && viewer === "buyer",
      scan: deal.status === "held" && viewer === "seller",
      // Replay has no recording of a void or a refund, so those two stay Live only.
      reportNoShow: deal.status === "held" && viewer === "seller" && deal.mode === "live",
      refund: refundOpen && viewer === "buyer" && deal.mode === "live",
    },
  };
}

export interface DealCard {
  id: string;
  status: Deal["status"];
  mode: Deal["mode"];
  listingId: string;
  listingTitle: string;
  photo?: string;
  priceCents?: number;
  updatedAt: string;
  seeded?: boolean;
}

export function dealCard(deal: Deal, listing: Listing | null): DealCard {
  return {
    id: deal.id,
    status: deal.status,
    mode: deal.mode,
    listingId: deal.listingId,
    listingTitle: listing?.title ?? "Listing",
    photo: listing?.photos[0],
    priceCents: deal.agreed?.offer.priceCents,
    updatedAt: deal.updatedAt,
    seeded: deal.seeded,
  };
}

export interface ListingView extends Listing {
  /** Only in the seller's own view. */
  floorCents?: number;
}

export function listingView(listing: Listing, priv: ListingPrivate | null, viewer: Role): ListingView {
  return viewer === "seller" && priv ? { ...listing, floorCents: priv.floorCents } : listing;
}
