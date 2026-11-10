/**
 * The pickup QR code. The buyer shows it, the seller scans it, and the scan releases the money.
 *
 * Token format: "CVC1.<base64url payload>.<base64url HMAC-SHA256>". The payload names the deal, a
 * one-time nonce and an expiry. The server only accepts a token whose signature verifies, that has
 * not expired, and whose nonce is the deal's current unused nonce (single use).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const QR_PREFIX = "CVC1";
export const QR_TTL_SECONDS = 10 * 60;

export interface QrPayload {
  /** Deal id. */
  d: string;
  /** One-time nonce. */
  n: string;
  /** Expiry, unix seconds. */
  e: number;
}

const b64u = (buf: Buffer) => buf.toString("base64url");

export function newNonce(): string {
  return b64u(randomBytes(12));
}

export function signQr(payload: QrPayload, secret: string): string {
  const body = b64u(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64u(createHmac("sha256", secret).update(`${QR_PREFIX}.${body}`).digest());
  return `${QR_PREFIX}.${body}.${sig}`;
}

export function issueQr(dealId: string, secret: string, now = new Date(), ttlSeconds = QR_TTL_SECONDS) {
  const payload: QrPayload = { d: dealId, n: newNonce(), e: Math.floor(now.getTime() / 1000) + ttlSeconds };
  return { token: signQr(payload, secret), payload };
}

export type QrCheck = { ok: true; payload: QrPayload } | { ok: false; code: string; detail: string };

export function verifyQr(token: string, secret: string, now = new Date()): QrCheck {
  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts[0] !== QR_PREFIX) {
    return { ok: false, code: "QR_MALFORMED", detail: "This is not a Capy vs Capy pickup code." };
  }
  const [, body, sig] = parts;
  const expected = createHmac("sha256", secret).update(`${QR_PREFIX}.${body}`).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, code: "QR_BAD_SIGNATURE", detail: "The pickup code signature does not verify." };
  }
  let payload: QrPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as QrPayload;
  } catch {
    return { ok: false, code: "QR_MALFORMED", detail: "The pickup code could not be read." };
  }
  if (typeof payload.d !== "string" || typeof payload.n !== "string" || typeof payload.e !== "number") {
    return { ok: false, code: "QR_MALFORMED", detail: "The pickup code is missing fields." };
  }
  if (payload.e * 1000 <= now.getTime()) {
    return { ok: false, code: "QR_EXPIRED", detail: "This pickup code expired. Ask the buyer to show a fresh one." };
  }
  return { ok: true, payload };
}

/**
 * Single use: the token must carry the deal's current nonce, and that nonce must not have been
 * used. The caller burns the nonce (sets usedAt) before any money moves.
 */
export function checkQrAgainstDeal(
  payload: QrPayload,
  deal: { id: string; handoff: { nonce?: string; usedAt?: string } },
): QrCheck {
  if (payload.d !== deal.id) return { ok: false, code: "QR_WRONG_DEAL", detail: "This pickup code belongs to a different deal." };
  if (deal.handoff.usedAt) return { ok: false, code: "QR_ALREADY_USED", detail: "This pickup code was already scanned." };
  if (!deal.handoff.nonce || payload.n !== deal.handoff.nonce) {
    return { ok: false, code: "QR_SUPERSEDED", detail: "A newer pickup code was issued. Ask the buyer to show the latest one." };
  }
  return { ok: true, payload };
}
