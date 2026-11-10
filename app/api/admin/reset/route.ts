import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { json, route } from "@/lib/http";
import { RuleError } from "@/lib/paypal/errors";
import { resetToSeed } from "@/lib/world";

export const dynamic = "force-dynamic";

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /api/admin/reset with header x-admin-token. Restores the seeded demo state so judges land
 * on a clean demo. Deals made by visitors are removed; nothing at PayPal is touched.
 */
export const POST = route(async (req: Request) => {
  const expected = env.adminToken;
  if (!expected) throw new RuleError("RESET_DISABLED", "DEMO_ADMIN_TOKEN is not set on this deployment.", 503);
  const given = req.headers.get("x-admin-token") ?? "";
  if (!sameToken(given, expected)) throw new RuleError("FORBIDDEN", "Wrong or missing x-admin-token.", 403);
  const result = await resetToSeed();
  return json({ ok: true, ...result });
});
