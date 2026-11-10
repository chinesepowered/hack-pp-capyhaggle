/**
 * Intent mandates: signed JSON that says what an agent may do for its owner.
 *
 * The idea follows the intent mandate in agent payment protocols such as AP2 (a user-signed
 * statement of what an agent is allowed to buy, with limits and an expiry). This is our own compact
 * format, signed with an HMAC by the marketplace. It does not claim AP2 compliance.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { shortId } from "./ids";
import type { AgentName, Mandate, Role, SignedMandate } from "./types";
import { AGENT_FOR } from "./types";

/** Stable JSON: keys sorted, no whitespace. The signature covers exactly these bytes. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

export function signMandate(mandate: Mandate, secret: string): SignedMandate {
  const sig = createHmac("sha256", secret).update(canonicalJson(mandate)).digest("hex");
  return { mandate, sig };
}

export interface IssueMandateInput {
  role: Role;
  owner: string;
  listingId: string;
  limitCents: number;
  pickupWindowIds?: string[];
  /** Lifetime in hours. Default 72. */
  ttlHours?: number;
  now?: Date;
}

export function issueMandate(input: IssueMandateInput, secret: string): SignedMandate {
  if (!Number.isInteger(input.limitCents) || input.limitCents <= 0) throw new Error("A mandate needs a positive limit in cents.");
  const now = input.now ?? new Date();
  const agent: AgentName = AGENT_FOR[input.role];
  const mandate: Mandate = {
    v: 1,
    id: shortId("mdt"),
    role: input.role,
    agent,
    owner: input.owner,
    listingId: input.listingId,
    limitCents: input.limitCents,
    currency: "USD",
    pickupWindowIds: input.pickupWindowIds ?? [],
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + (input.ttlHours ?? 72) * 3600_000).toISOString(),
  };
  return signMandate(mandate, secret);
}

export type MandateCheck = { ok: true; mandate: Mandate } | { ok: false; code: string; detail: string };

/** Verifies the signature, the expiry, and that the mandate is for this role and listing. */
export function verifyMandate(
  signed: SignedMandate | undefined,
  secret: string,
  expect: { role: Role; listingId: string; now?: Date },
): MandateCheck {
  if (!signed || !signed.mandate || typeof signed.sig !== "string") {
    return { ok: false, code: "MANDATE_MISSING", detail: "No mandate was presented." };
  }
  const expected = createHmac("sha256", secret).update(canonicalJson(signed.mandate)).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signed.sig, "hex");
  } catch {
    return { ok: false, code: "MANDATE_BAD_SIGNATURE", detail: "The mandate signature is not valid hex." };
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, code: "MANDATE_BAD_SIGNATURE", detail: "The mandate signature does not match its contents." };
  }
  const m = signed.mandate;
  if (m.v !== 1 || m.currency !== "USD") return { ok: false, code: "MANDATE_UNSUPPORTED", detail: "Unknown mandate version or currency." };
  if (m.role !== expect.role || m.agent !== AGENT_FOR[expect.role]) {
    return { ok: false, code: "MANDATE_WRONG_ROLE", detail: `This mandate is for the ${m.role}, not the ${expect.role}.` };
  }
  if (m.listingId !== expect.listingId) {
    return { ok: false, code: "MANDATE_WRONG_ITEM", detail: "This mandate covers a different listing." };
  }
  const now = expect.now ?? new Date();
  if (new Date(m.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, code: "MANDATE_EXPIRED", detail: `The mandate expired at ${m.expiresAt}.` };
  }
  if (new Date(m.issuedAt).getTime() > now.getTime() + 5 * 60_000) {
    return { ok: false, code: "MANDATE_NOT_YET_VALID", detail: "The mandate is dated in the future." };
  }
  return { ok: true, mandate: m };
}

/** True when a price is inside the mandate: at or under a buyer's ceiling, at or over a seller's floor. */
export function priceWithinMandate(m: Mandate, priceCents: number): boolean {
  return m.role === "buyer" ? priceCents <= m.limitCents : priceCents >= m.limitCents;
}
