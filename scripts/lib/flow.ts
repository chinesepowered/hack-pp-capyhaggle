/**
 * Shared steps for scripts that run a whole deal against the sandbox (seed, replay recorder).
 * They call the same library functions the API routes call.
 */
import type { Browser, BrowserContext } from "playwright";
import type { Deal } from "../../lib/types";
import { approveOrder } from "./approve";

export type Log = (line: string) => void;

export async function haggle(dealId: string, log: Log): Promise<Deal> {
  const deals = await import("../../lib/deals");
  const { withDeal } = await import("../../lib/runner");
  const { formatUsd } = await import("../../lib/money");
  let deal: Deal | undefined;
  for (let i = 0; i < 20; i++) {
    ({ deal } = await withDeal(dealId, "step", (d, l) => deals.stepDeal(d, l)));
    const t = deal.turns.filter((x) => x.actor === "barley" || x.actor === "biscuit").at(-1);
    if (t) log(`    ${t.actor.padEnd(7)} ${t.kind.padEnd(6)} ${t.offer ? formatUsd(t.offer.priceCents).padEnd(5) : "     "} ${t.message.slice(0, 96)}`);
    if (deal.status !== "negotiating") break;
  }
  if (!deal) throw new Error("The haggle did not run.");
  if (deal.status === "agreed") ({ deal } = await withDeal(dealId, "summary", (d, l) => deals.ensureSummary(d, l)));
  return deal;
}

export interface BuyerLogin {
  email: string;
  password: string;
}

/** Both owners accept, Barley creates the order, the sandbox buyer approves in PayPal's window, we authorize. */
export async function acceptAndHold(dealId: string, browser: Browser, context: BrowserContext, buyer: BuyerLogin, log: Log): Promise<Deal> {
  const deals = await import("../../lib/deals");
  const { withDeal } = await import("../../lib/runner");
  const { env } = await import("../../lib/env");
  await withDeal(dealId, "accept", (d, l) => deals.acceptDeal(d, l, "seller"));
  let { deal } = await withDeal(dealId, "accept", (d, l) => deals.acceptDeal(d, l, "buyer"));
  if (!deal.payment.orderId) throw new Error("No PayPal order was created.");
  log(`    order ${deal.payment.orderId} created (intent AUTHORIZE)`);
  await approveOrder(browser, {
    context,
    approveUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${deal.payment.orderId}`,
    buyerEmail: buyer.email,
    buyerPassword: buyer.password,
    returnUrlPrefix: `${env.appUrl}/deal/${deal.id}`,
    onStep: (s) => log(`    approval: ${s}`),
  });
  ({ deal } = await withDeal(dealId, "authorize", (d, l) => deals.authorizeHold(d, l)));
  log(`    held: authorization ${deal.payment.authorizationId} ${deal.payment.authorizationStatus}`);
  ({ deal } = await withDeal(dealId, "verify", (d) => deals.verifyHoldStep(d)));
  return deal;
}

/** The QR handoff: issue a code as the buyer, scan it as the seller, wait for the payout to settle. */
export async function handoff(dealId: string, log: Log, waitForPayoutMs = 60_000): Promise<Deal> {
  const deals = await import("../../lib/deals");
  const { withDeal } = await import("../../lib/runner");
  const { result: qr } = await withDeal(dealId, "qr", async (d) => deals.issuePickupQr(d));
  let { deal } = await withDeal(dealId, "scan", (d, l) => deals.completeHandoff(d, l, qr.token, "simulated"));
  log(`    captured ${deal.payment.captureId} ${deal.payment.captureStatus}, payout ${deal.payment.payoutBatchId} ${deal.payment.payoutBatchStatus}`);
  const until = Date.now() + waitForPayoutMs;
  while (deal.payment.payoutItemStatus !== "SUCCESS" && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 3000));
    ({ deal } = await withDeal(dealId, "refresh", (d, l) => deals.refreshFromPayPal(d, l)));
  }
  log(`    payout item ${deal.payment.payoutItemId ?? "?"} ${deal.payment.payoutItemStatus ?? deal.payment.payoutBatchStatus}`);
  return deal;
}

export function maskEmail(email: string | undefined): string {
  if (!email) return "(not set)";
  const [name, domain] = email.split("@");
  return `${name.slice(0, 6)}...@${domain ?? ""}`;
}
