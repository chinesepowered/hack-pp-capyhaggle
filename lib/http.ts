/** Shared plumbing for route handlers: JSON answers, the error ladder, roles, and AI rate limits. */
import { NextResponse } from "next/server";
import { toClientError, RuleError } from "./paypal/errors";
import type { Mode, Role } from "./types";

export function json<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function fail(err: unknown): NextResponse {
  const e = toClientError(err);
  if (e.status >= 500) console.error("[api]", err);
  return NextResponse.json({ error: e }, { status: e.status, headers: { "Cache-Control": "no-store" } });
}

/** Wraps a handler so every failure goes through the same ladder (lib/paypal/errors.ts). */
export function route<Args extends unknown[]>(fn: (...args: Args) => Promise<NextResponse>) {
  return async (...args: Args): Promise<NextResponse> => {
    try {
      return await fn(...args);
    } catch (err) {
      return fail(err);
    }
  };
}

export function roleFrom(value: unknown): Role {
  return value === "seller" ? "seller" : "buyer";
}

export function modeFrom(value: unknown): Mode {
  return value === "replay" ? "replay" : "live";
}

export async function body<T extends Record<string, unknown>>(req: Request): Promise<T> {
  try {
    const parsed = (await req.json()) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as T) : ({} as T);
  } catch {
    return {} as T;
  }
}

/* ------------------------------------------------------------ rate limit */

interface Bucket {
  tokens: number;
  updated: number;
}

const buckets = new Map<string, Bucket>();
const CAPACITY = 80;
const REFILL_PER_MS = CAPACITY / (10 * 60_000); // 80 AI calls per 10 minutes per IP

export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

/**
 * Token bucket per IP for routes that call a model. In-memory, so it is per server instance:
 * good enough to keep a hosted demo from being drained, not a hard guarantee.
 */
export function limitAi(req: Request, cost = 1): void {
  const key = clientIp(req);
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: CAPACITY, updated: now };
  bucket.tokens = Math.min(CAPACITY, bucket.tokens + (now - bucket.updated) * REFILL_PER_MS);
  bucket.updated = now;
  if (bucket.tokens < cost) {
    buckets.set(key, bucket);
    throw new RuleError("RATE_LIMITED", "This demo limits AI calls per visitor. Give the capybaras a minute, or switch to Replay mode.", 429);
  }
  bucket.tokens -= cost;
  buckets.set(key, bucket);
  if (buckets.size > 5000) buckets.clear();
}
