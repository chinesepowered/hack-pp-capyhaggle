/**
 * The agents' money steps. The model chooses the tool call; lib/guards.ts decides in code whether
 * PayPal is called; a human has already approved (both owners tapped Accept, the buyer approves in
 * PayPal's own window). If the model is down or keeps getting it wrong, code makes the same call
 * through the same guard, so money steps never depend on a model.
 */
import { aiChat, AiUnavailableError, type ChatCompletionMessageParam, type ChatCompletionTool } from "../ai";
import { guardCreateHold, guardGetOrder, guardRefund, type GuardResult } from "../guards";
import { formatUsd, formatUsdExact, toPayPalValue } from "../money";
import { runToolkitTool, toolkitToolDefinitions, type ToolkitResult } from "../paypal/toolkit";
import type { RefereeListing } from "../referee";
import { ReplayMissError } from "../tape";
import type { AgentName, AiTag, Deal, TrailStep } from "../types";

export interface ToolDecision<T> {
  value: T;
  args: Record<string, unknown>;
  ai: AiTag;
  trail: TrailStep[];
}

const trailStep = (label: string, tone: TrailStep["tone"], detail?: string): TrailStep => ({ at: new Date().toISOString(), label, tone, detail });

const CREATE_HELD_ORDER: ChatCompletionTool = {
  type: "function",
  function: {
    name: "create_held_order",
    description:
      "Create the PayPal order for the agreed deal with intent AUTHORIZE. The buyer's money is held by PayPal, not sent, until the seller scans the pickup QR code.",
    parameters: {
      type: "object",
      properties: {
        amount_usd: { type: "number", description: "The agreed price in US dollars." },
        listing_id: { type: "string", description: "The id of the listing this deal is about." },
      },
      required: ["amount_usd", "listing_id"],
    },
  },
};

/**
 * Asks an agent for one tool call and runs it past a guard. Up to two tries, then code proposes
 * the correct arguments itself (still through the guard).
 */
async function decide<T>(opts: {
  agent: AgentName;
  purpose: string;
  label: string;
  system: string;
  user: string;
  tool: ChatCompletionTool;
  guard: (args: Record<string, unknown>) => GuardResult<T>;
  scriptedArgs: Record<string, unknown>;
}): Promise<ToolDecision<T>> {
  const trail: TrailStep[] = [];
  const toolName = opts.tool.type === "function" ? opts.tool.function.name : "tool";
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ];
  let tag: AiTag | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await aiChat({ purpose: opts.purpose, label: opts.label, messages, tools: [opts.tool], toolChoice: "required", temperature: 0, maxTokens: 500 });
    } catch (err) {
      if (err instanceof AiUnavailableError || err instanceof ReplayMissError) {
        trail.push(trailStep("Model unavailable", "blocked", "Code made the tool call instead."));
        break;
      }
      throw err;
    }
    tag = res.tag;
    const call = res.toolCalls.find((c) => c.name === toolName);
    if (!call) {
      messages.push({ role: "user", content: `Call the ${toolName} tool.` });
      continue;
    }
    trail.push(trailStep(`Tool call: ${toolName}(${JSON.stringify(call.args)})`, "info"));
    const checked = opts.guard(call.args);
    if (checked.ok) {
      trail.push(trailStep("Guard: allowed", "ok", "The call matches the deal and both mandates."));
      return { value: checked.value, args: call.args, ai: res.tag, trail };
    }
    trail.push(trailStep(`Guard blocked the call (${checked.code})`, "blocked", checked.detail));
    messages.push({ role: "assistant", content: null, tool_calls: [{ id: call.id, type: "function", function: { name: call.name, arguments: call.raw } }] });
    messages.push({ role: "tool", tool_call_id: call.id, content: `REFUSED by the guard: ${checked.code}. ${checked.detail} Call the tool again with correct arguments.` });
  }
  const checked = opts.guard(opts.scriptedArgs);
  if (!checked.ok) {
    const err = new Error(checked.detail) as Error & { code?: string; guard?: boolean };
    err.code = checked.code;
    err.guard = true;
    throw err;
  }
  trail.push(trailStep(`Scripted tool call: ${toolName}(${JSON.stringify(opts.scriptedArgs)})`, "info", "Same guard, same rules."));
  return { value: checked.value, args: opts.scriptedArgs, ai: { model: tag?.model ?? "scripted", purpose: opts.label, scripted: true }, trail };
}

/** Barley decides to place the hold. The guard only lets the exact agreed terms through. */
export async function decideHold(deal: Deal, listing: RefereeListing, secret: string): Promise<ToolDecision<{ amountCents: number }>> {
  const price = deal.agreed!.offer.priceCents;
  return decide({
    agent: "barley",
    purpose: "settle.hold",
    label: `Placing the PayPal hold for ${deal.buyerName}`,
    system: [
      "You are Barley, the buyer's capybara agent. Both owners have tapped Accept on the deal you negotiated.",
      "Place the PayPal hold for exactly the agreed terms by calling create_held_order once. You cannot change the amount or the item. A guard in code rejects anything that differs from the agreed deal or your owner's mandate.",
    ].join("\n"),
    user: `Agreed deal: ${formatUsd(price)} for listing ${listing.id} ("${listing.title}"). Place the hold now.`,
    tool: CREATE_HELD_ORDER,
    guard: (args) => guardCreateHold(deal, listing, args, secret),
    scriptedArgs: { amount_usd: price / 100, listing_id: listing.id },
  });
}

export interface HoldVerification {
  ok: boolean;
  orderStatus?: string;
  authorizationStatus?: string;
  amount?: string;
  line: string;
  args: Record<string, unknown>;
  ai: AiTag;
  trail: TrailStep[];
}

function readOrder(result: ToolkitResult): { orderStatus?: string; authorizationStatus?: string; amount?: string } {
  const d = result.data as {
    status?: string;
    purchase_units?: { amount?: { value?: string }; payments?: { authorizations?: { status?: string; amount?: { value?: string } }[] } }[];
  };
  const unit = d.purchase_units?.[0];
  const auth = unit?.payments?.authorizations?.[0];
  return { orderStatus: d.status, authorizationStatus: auth?.status, amount: auth?.amount?.value ?? unit?.amount?.value };
}

/**
 * Biscuit independently checks with PayPal that the money is really held, using the Agent
 * Toolkit's get_order tool. This is the answer to fake payment screenshots.
 */
export async function verifyHold(deal: Deal): Promise<HoldVerification> {
  const [tool] = toolkitToolDefinitions(["get_order"]);
  const decision = await decide({
    agent: "biscuit",
    purpose: "settle.verify",
    label: `Verifying the hold for ${deal.sellerName}`,
    system: [
      "You are Biscuit, the seller's capybara agent. The buyer says they paid. Never trust a claim or a screenshot.",
      "Check with PayPal yourself by calling get_order with this deal's order id. A guard in code only lets you read this deal's own order.",
    ].join("\n"),
    user: `This deal's PayPal order id is ${deal.payment.orderId}. Verify the payment now.`,
    tool,
    guard: (args) => guardGetOrder(deal, args),
    scriptedArgs: { id: deal.payment.orderId },
  });
  const result = await runToolkitTool("get_order", { id: decision.value.id });
  const read = readOrder(result);
  const held = result.ok && read.authorizationStatus === "CREATED";
  const expected = toPayPalValue(deal.agreed!.offer.priceCents);
  const amountMatches = read.amount === expected;
  const line =
    held && amountMatches
      ? `I checked with PayPal myself: the order is ${read.orderStatus} and ${formatUsdExact(deal.agreed!.offer.priceCents)} is held. It is safe to hand over the item when the buyer shows the QR code.`
      : `I checked with PayPal and I do not see a matching hold yet (order ${read.orderStatus ?? "unknown"}). Do not hand over the item.`;
  decision.trail.push(
    trailStep(
      `PayPal says: order ${read.orderStatus ?? "unknown"}, authorization ${read.authorizationStatus ?? "none"}, amount ${read.amount ?? "unknown"}`,
      held && amountMatches ? "ok" : "blocked",
      "Read through the Agent Toolkit tool get_order.",
    ),
  );
  return { ok: held && amountMatches, ...read, line, args: decision.args, ai: decision.ai, trail: decision.trail };
}

export interface RefundDecision {
  ok: boolean;
  refundId?: string;
  refundStatus?: string;
  line: string;
  args: Record<string, unknown>;
  ai: AiTag;
  trail: TrailStep[];
}

/** Barley refunds the buyer through the Agent Toolkit's create_refund tool, behind the refund guard. */
export async function refundThroughToolkit(deal: Deal, reason: string, requestId: string): Promise<RefundDecision> {
  const [tool] = toolkitToolDefinitions(["create_refund"]);
  const decision = await decide({
    agent: "barley",
    purpose: "settle.refund",
    label: `Refunding ${deal.buyerName}`,
    system: [
      "You are Barley, the buyer's capybara agent. Your owner reported a problem with the item within 24 hours of pickup and the marketplace approved a full refund.",
      "Issue the refund by calling create_refund once for this deal's capture. Do not set an amount: the full captured amount is refunded. A guard in code refuses any other capture or a larger amount.",
    ].join("\n"),
    user: `Capture id: ${deal.payment.captureId}. Reported problem: "${reason.slice(0, 200)}". Issue the refund now.`,
    tool,
    guard: (args) => guardRefund(deal, args),
    scriptedArgs: { capture_id: deal.payment.captureId, note_to_payer: "Refund for a problem reported within 24 hours of pickup." },
  });
  const args: Record<string, unknown> = { capture_id: decision.value.captureId, note_to_payer: "Refund for a problem reported within 24 hours of pickup." };
  const result = await runToolkitTool("create_refund", args, requestId);
  const d = result.data as { id?: string; status?: string; message?: string };
  const ok = result.ok && typeof d.id === "string";
  decision.trail.push(trailStep(ok ? `PayPal refund ${d.id}: ${d.status}` : `Refund failed: ${d.message ?? result.raw.slice(0, 160)}`, ok ? "ok" : "blocked", "Issued through the Agent Toolkit tool create_refund."));
  return {
    ok,
    refundId: d.id,
    refundStatus: d.status,
    line: ok ? `The refund of ${formatUsdExact(decision.value.amountCents)} is on its way back to you through PayPal.` : "The refund did not go through. Nothing changed.",
    args,
    ai: decision.ai,
    trail: decision.trail,
  };
}
