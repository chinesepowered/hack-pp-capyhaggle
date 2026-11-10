/** Shared types. Private fields are stripped by lib/views.ts before anything reaches a browser. */

export type Role = "buyer" | "seller";
export type AgentName = "barley" | "biscuit";
export type Mode = "live" | "replay";

export const AGENT_FOR: Record<Role, AgentName> = { buyer: "barley", seller: "biscuit" };
export const ROLE_OF: Record<AgentName, Role> = { barley: "buyer", biscuit: "seller" };
export const OWNER_NAME: Record<Role, string> = { buyer: "Maya", seller: "Theo" };
export const AGENT_LABEL: Record<AgentName, string> = { barley: "Barley", biscuit: "Biscuit" };

export const MAX_ROUNDS = 8;

export interface AiTag {
  model: string;
  /** What the model was used for, shown in the "AI" tag tooltip. */
  purpose: string;
  /** True when the primary model failed and the fallback answered. */
  fallback?: boolean;
  /** True when no model answered and code wrote the output. */
  scripted?: boolean;
  /** True when this output was replayed from a recorded fixture. */
  replayed?: boolean;
}

export interface PickupWindow {
  id: string;
  label: string;
  /** ISO timestamps. */
  startsAt: string;
  endsAt: string;
}

export type FactKind = "condition" | "flaw" | "measurement" | "feature" | "included";

export interface ListingFact {
  id: string;
  kind: FactKind;
  text: string;
  /** Measurements read from a photo are estimates and are labeled as such. */
  estimate?: boolean;
}

export interface ListingExtra {
  id: string;
  label: string;
}

export interface PriceSuggestion {
  lowCents: number;
  highCents: number;
  basis: string;
  ai: AiTag;
}

export interface Listing {
  id: string;
  sellerName: string;
  title: string;
  category: string;
  description: string;
  conditionGrade: string;
  facts: ListingFact[];
  /** Things the seller is willing to throw in during a haggle. */
  extras: ListingExtra[];
  photos: string[];
  photoCredit?: string;
  askingCents: number;
  suggestion?: PriceSuggestion;
  area: string;
  pickupWindows: PickupWindow[];
  prefs: { bundlesOk: boolean; noCash: boolean; note?: string };
  status: "active" | "reserved" | "sold";
  ai?: AiTag;
  createdAt: string;
  seeded?: boolean;
}

/** The seller's private side of a listing. Never sent to the buyer view. */
export interface ListingPrivate {
  listingId: string;
  floorCents: number;
  mandate: SignedMandate;
}

export interface Want {
  id: string;
  buyerName: string;
  text: string;
  parsed: {
    category: string;
    keywords: string[];
    when: string;
    area: string;
    ai?: AiTag;
  };
  createdAt: string;
  seeded?: boolean;
}

/** The buyer's private side of a want. */
export interface WantPrivate {
  wantId: string;
  ceilingCents: number;
}

/**
 * An intent mandate: what an agent may do for its owner. The idea follows the intent mandates in
 * agent payment protocols such as AP2. This is our own format and does not claim AP2 compliance.
 */
export interface Mandate {
  v: 1;
  id: string;
  role: Role;
  agent: AgentName;
  owner: string;
  /** Item scope: the only listing this mandate can be used for. */
  listingId: string;
  /** Buyer: the most the agent may offer. Seller: the least it may accept. */
  limitCents: number;
  currency: "USD";
  /** Pickup windows the owner can make (ids from the listing). Empty means any. */
  pickupWindowIds: string[];
  issuedAt: string;
  expiresAt: string;
}

export interface SignedMandate {
  mandate: Mandate;
  /** Hex HMAC-SHA256 over the canonical JSON of the mandate. */
  sig: string;
}

export interface Offer {
  priceCents: number;
  pickupWindowId: string;
  extras: string[];
}

export type MoveKind = "offer" | "accept" | "walk";

export interface ProposedMove {
  kind: MoveKind;
  offer?: Offer;
  message: string;
  /** One line for the owner only. May mention private limits; never shown to the other side. */
  privateNote?: string;
}

export interface Violation {
  code: string;
  detail: string;
}

export type TurnActor = AgentName | "referee" | "maya" | "theo" | "system";

export interface Turn {
  n: number;
  round: number;
  actor: TurnActor;
  kind: "offer" | "accept" | "walk" | "human" | "refusal" | "system" | "tool";
  message: string;
  offer?: Offer;
  at: string;
  ai?: AiTag;
  /** Owner-only reasoning trail for this step. Stripped from the other side's view. */
  trail?: TrailStep[];
  /** Set on human messages the safety check flagged. */
  flagId?: string;
  /** Tool calls the agent made in this step (settlement and verification steps). */
  tool?: { name: string; args: Record<string, unknown>; outcome: string; source: "agent-toolkit" | "capy" };
}

export interface TrailStep {
  at: string;
  label: string;
  detail?: string;
  /** "blocked" marks a move the referee refused. */
  tone: "info" | "ok" | "blocked";
  private?: boolean;
}

export interface ScamFlag {
  id: string;
  at: string;
  from: Role;
  text: string;
  source: "rules" | "llm" | "rules+llm";
  patterns: string[];
  explanation: string;
  ai?: AiTag;
}

export type DealStatus =
  | "negotiating"
  | "agreed"
  | "awaiting_payment"
  | "held"
  | "completed"
  | "voided"
  | "refunded"
  | "walked"
  | "expired";

export interface PayPalCall {
  id: string;
  at: string;
  method: string;
  path: string;
  status: number;
  debugId?: string;
  feature: string;
  via: "server-sdk" | "rest" | "agent-toolkit" | "js-sdk";
  ms: number;
  requestId?: string;
  replayed?: boolean;
  note?: string;
}

export interface PaymentState {
  orderId?: string;
  orderStatus?: string;
  authorizationId?: string;
  authorizationStatus?: string;
  authorizationExpiresAt?: string;
  authorizedAt?: string;
  reauthorized?: boolean;
  captureId?: string;
  captureStatus?: string;
  capturedAt?: string;
  paypalFeeCents?: number;
  payoutBatchId?: string;
  payoutBatchStatus?: string;
  payoutItemId?: string;
  payoutItemStatus?: string;
  payoutTransactionId?: string;
  paidOutAt?: string;
  voidedAt?: string;
  voidReason?: string;
  refundId?: string;
  refundStatus?: string;
  refundedAt?: string;
  /** Last time we re-read these values from PayPal. */
  checkedAt?: string;
  /** Set when a write's outcome is unknown and is being settled by a re-read. */
  unknown?: string;
}

export interface HandoffState {
  /** The current QR nonce. A new QR replaces it; a scan burns it. */
  nonce?: string;
  qrIssuedAt?: string;
  qrExpiresAt?: string;
  usedAt?: string;
  scannedVia?: "camera" | "paste" | "simulated";
}

export interface WebhookEventRecord {
  id: string;
  type: string;
  at: string;
  resourceId?: string;
}

export interface Deal {
  id: string;
  /** Random per deal. Part of every PayPal-Request-Id so ids are stable per deal and never reused across deals. */
  salt: string;
  mode: Mode;
  listingId: string;
  wantId?: string;
  buyerName: string;
  sellerName: string;
  createdAt: string;
  updatedAt: string;
  status: DealStatus;
  paused: boolean;
  mandates: { buyer: SignedMandate; seller: SignedMandate };
  turns: Turn[];
  /** 1-based round. A round is one move by Barley and one reply by Biscuit. */
  round: number;
  nextActor: AgentName;
  standing?: { by: AgentName; offer: Offer; turn: number };
  lastOffer: Partial<Record<AgentName, Offer>>;
  /** Owner guidance typed by a human, fed to that owner's agent only. */
  guidance: { buyer: string[]; seller: string[] };
  agreed?: {
    offer: Offer;
    /** Copied from the listing at deal time so history stays readable when windows roll forward. */
    pickupLabel: string;
    pickupEndsAt: string;
    atTurn: number;
    feeCents: number;
    sellerNetCents: number;
    summary?: { buyer: string; seller: string; ai: AiTag };
  };
  accepts: { buyer?: string; seller?: string };
  payment: PaymentState;
  handoff: HandoffState;
  flags: ScamFlag[];
  calls: PayPalCall[];
  webhookEvents: WebhookEventRecord[];
  /** Per-key counters for the replay tape (see lib/tape.ts). */
  tapeCounters: Record<string, number>;
  outcomeNote?: string;
  seeded?: boolean;
}
