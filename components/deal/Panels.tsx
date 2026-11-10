"use client";

import Link from "next/link";
import { formatUsd, formatUsdExact } from "@/lib/money";
import type { DealView } from "@/lib/views";
import { AiTag, Button, Card, cx, LockIcon, Pill, Spinner } from "../ui";

const STAGES = ["Haggle", "Accept", "Hold", "Handoff", "Paid"] as const;

function stageIndex(deal: DealView): number {
  switch (deal.status) {
    case "negotiating":
      return 0;
    case "agreed":
      return 1;
    case "awaiting_payment":
      return 2;
    case "held":
      return 3;
    case "completed":
    case "refunded":
      return 4;
    default:
      return -1;
  }
}

export function Tracker({ deal }: { deal: DealView }) {
  const current = stageIndex(deal);
  const done = deal.status === "completed" || deal.status === "refunded";
  return (
    <ol className="flex items-center gap-1" aria-label="Deal progress" data-testid="tracker">
      {STAGES.map((s, i) => {
        const state = current < 0 ? "off" : i < current || done ? "done" : i === current ? "now" : "todo";
        return (
          <li key={s} className="flex flex-1 items-center gap-1" aria-current={state === "now" ? "step" : undefined}>
            <span
              className={cx(
                "flex min-w-0 flex-1 items-center justify-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold",
                state === "done" && "border-money bg-money text-white",
                state === "now" && "border-ink bg-ink text-white",
                (state === "todo" || state === "off") && "border-paper-3 bg-white text-ink-soft",
              )}
            >
              {state === "done" ? (
                <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0" aria-hidden="true">
                  <path d="m3 8.5 3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : null}
              <span className="truncate">{s}</span>
              <span className="sr-only">{state === "done" ? "(done)" : state === "now" ? "(current)" : ""}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The viewer's own private limit. The other side's is never sent to this browser. */
export function MandateCard({ deal }: { deal: DealView }) {
  const mine = deal.mandates[deal.role];
  const isBuyer = deal.role === "buyer";
  const windows = (mine.pickupWindowIds ?? []).map((id) => deal.listing.pickupWindows.find((w) => w.id === id)?.label ?? id);
  return (
    <Card className="p-4" as="section">
      <div className="flex items-center gap-2">
        <LockIcon className="text-spring-deep" />
        <h3 className="text-base font-semibold">
          {isBuyer ? "Maya's" : "Theo's"} private mandate for {isBuyer ? "Barley" : "Biscuit"}
        </h3>
      </div>
      <p className="mt-2 flex items-baseline gap-2">
        <span className="font-display text-3xl font-semibold" data-testid="own-limit">
          {mine.limitCents !== undefined ? formatUsd(mine.limitCents) : "hidden"}
        </span>
        <span className="text-sm text-ink-soft">{isBuyer ? "ceiling: Barley may not bid above this" : "floor: Biscuit may not go below this"}</span>
      </p>
      <ul className="mt-2 flex flex-col gap-1 text-sm text-ink-soft">
        <li>
          Item scope: <span className="text-ink">{deal.listing.title}</span> only
        </li>
        {windows.length ? (
          <li>
            Pickup you can make: <span className="text-ink">{windows.join("; ")}</span>
          </li>
        ) : null}
        <li>
          Signed <span className="font-mono text-xs text-ink">{mine.sigShort}</span>, expires {new Date(mine.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </li>
        <li>{isBuyer ? "Theo and Biscuit" : "Maya and Barley"} never see this number. The referee checks every move against it in code.</li>
      </ul>
    </Card>
  );
}

export function StandingOffer({ deal }: { deal: DealView }) {
  if (deal.status !== "negotiating") return null;
  return (
    <Card className="p-4" as="section">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold">On the table</h3>
        <Pill tone="spring">
          Round {Math.min(deal.round, deal.maxRounds)} of {deal.maxRounds}
        </Pill>
      </div>
      {deal.standing ? (
        <p className="mt-1 text-sm">
          <span className="font-display text-2xl font-semibold">{formatUsd(deal.standing.offer.priceCents)}</span>{" "}
          <span className="text-ink-soft">from {deal.standing.by === "barley" ? "Barley" : "Biscuit"}. Asking was {formatUsd(deal.listing.askingCents)}.</span>
        </p>
      ) : (
        <p className="mt-1 text-sm text-ink-soft">No offer yet. Asking price is {formatUsd(deal.listing.askingCents)}.</p>
      )}
    </Card>
  );
}

/** The summary both owners read before tapping Accept. Numbers come from code; the prose is AI. */
export function AcceptCard({ deal, onAccept, busy, onSwitchRole }: { deal: DealView; onAccept: () => void; busy: boolean; onSwitchRole: () => void }) {
  if (!deal.agreed) return null;
  const { offer, feeCents, sellerNetCents, summary, pickupLabel } = deal.agreed;
  const extras = offer.extras.map((id) => deal.listing.extras.find((e) => e.id === id)?.label ?? id);
  const mine = deal.accepts[deal.role];
  const theirs = deal.accepts[deal.role === "buyer" ? "seller" : "buyer"];
  const me = deal.role === "buyer" ? deal.buyerName : deal.sellerName;
  const other = deal.role === "buyer" ? deal.sellerName : deal.buyerName;
  return (
    <Card className="overflow-hidden border-2 border-ink" as="section">
      <div className="bg-ink px-4 py-2 text-white">
        <h3 className="text-base font-semibold">The deal Barley and Biscuit reached</h3>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-ink-soft">Price</dt>
          <dd className="font-display text-2xl font-semibold leading-none" data-testid="agreed-price">
            {formatUsdExact(offer.priceCents)}
          </dd>
          <dt className="text-ink-soft">Pickup</dt>
          <dd>
            {pickupLabel}, {deal.listing.area}
          </dd>
          <dt className="text-ink-soft">Included</dt>
          <dd>{extras.length ? extras.join(", ") : "Nothing extra"}</dd>
          <dt className="text-ink-soft">Fee</dt>
          <dd>
            {formatUsdExact(feeCents)} <span className="text-ink-soft">({deal.fee.percent}% + {formatUsdExact(deal.fee.fixedCents)}, taken from the seller&apos;s side)</span>
          </dd>
          <dt className="text-ink-soft">{deal.sellerName} receives</dt>
          <dd className="font-semibold text-money">{formatUsdExact(sellerNetCents)}</dd>
          <dt className="text-ink-soft">Payment</dt>
          <dd>Held by PayPal until the QR scan at pickup. No cash, no deposits.</dd>
        </dl>
        <div className="rounded-xl border border-paper-3 bg-paper p-3 text-sm">
          {summary ? (
            <>
              <p>{deal.role === "buyer" ? summary.buyer : summary.seller}</p>
              <AiTag tag={summary.ai} className="mt-2" />
            </>
          ) : (
            <p className="flex items-center gap-2 text-ink-soft" role="status">
              <Spinner /> Writing your summary
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {mine ? (
            <p className="flex items-center gap-2 text-sm font-semibold text-money" role="status">
              <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
                <path d="m3 8.5 3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {me} accepted.
            </p>
          ) : (
            <Button size="lg" variant="money" onClick={onAccept} busy={busy} data-testid="accept">
              Accept as {me}
            </Button>
          )}
          {theirs ? (
            <p className="text-sm font-semibold text-money">{other} accepted too.</p>
          ) : (
            <p className="text-sm text-ink-soft">
              Waiting for {other} to accept.{" "}
              {mine ? (
                <button type="button" onClick={onSwitchRole} className="font-semibold text-pay underline underline-offset-2" data-testid="switch-role">
                  Switch to {other}&apos;s view
                </button>
              ) : null}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

/** The crisp money fact. Values come from PayPal re-reads, never from a model. */
export function HoldBanner({ deal }: { deal: DealView }) {
  const p = deal.payment;
  const amount = formatUsdExact(deal.agreed?.offer.priceCents ?? 0);
  return (
    <div className="rounded-2xl border-2 border-pay bg-white p-4" data-testid="hold-banner" role="status">
      <p className="text-xs font-bold uppercase tracking-wide text-pay">Payment held by PayPal</p>
      <p className="font-display text-4xl font-semibold leading-tight text-ink">{amount}</p>
      <p className="mt-1 text-sm text-ink-soft">
        {deal.role === "buyer"
          ? "Approved by you, held by PayPal. Nothing has been sent to Theo. It is captured only when he scans your QR code."
          : "Maya approved it and PayPal is holding it. It is released to you the moment you scan her QR code at pickup."}
      </p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[12px]">
        <dt className="text-ink-soft">order</dt>
        <dd>
          {p.orderId} <span className="text-ink-soft">{p.orderStatus}</span>
        </dd>
        <dt className="text-ink-soft">authorization</dt>
        <dd>
          {p.authorizationId} <span className="text-ink-soft">{p.authorizationStatus}</span>
        </dd>
        {p.authorizationExpiresAt ? (
          <>
            <dt className="text-ink-soft">valid until</dt>
            <dd>{new Date(p.authorizationExpiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

export function PaidPanel({ deal, onRefund, refundBusy }: { deal: DealView; onRefund: () => void; refundBusy: boolean }) {
  const p = deal.payment;
  const a = deal.agreed!;
  const payoutDone = p.payoutItemStatus === "SUCCESS";
  return (
    <div className="flex flex-col gap-3" data-testid="paid-panel">
      <div className="rounded-2xl border-2 border-money bg-white p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-money">{deal.role === "seller" ? "You were paid" : "Handoff complete"}</p>
        <p className="font-display text-4xl font-semibold leading-tight">{formatUsdExact(deal.role === "seller" ? a.sellerNetCents : a.offer.priceCents)}</p>
        <p className="mt-1 text-sm text-ink-soft">
          {deal.role === "seller"
            ? `Price ${formatUsdExact(a.offer.priceCents)} minus the ${formatUsdExact(a.feeCents)} fee, sent to your PayPal account by Payouts.`
            : `PayPal captured your hold when Theo scanned your code. Theo was paid ${formatUsdExact(a.sellerNetCents)}.`}
        </p>
        <ol className="mt-3 flex flex-col gap-1.5 text-sm">
          <li className="flex items-start gap-2">
            <Pill tone="money">1</Pill>
            <span>
              QR scanned{deal.handoff.scannedVia ? ` (${deal.handoff.scannedVia})` : ""}: signature, expiry and single use verified
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Pill tone="money">2</Pill>
            <span>
              Captured <span className="font-mono text-xs">{p.captureId}</span> <span className="text-ink-soft">{p.captureStatus}</span>
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Pill tone={payoutDone ? "money" : "pay"}>3</Pill>
            <span data-testid="payout-status">
              Payout <span className="font-mono text-xs">{p.payoutBatchId}</span>{" "}
              {payoutDone ? (
                <span className="font-semibold text-money">SUCCESS, in {deal.sellerName}&apos;s PayPal account</span>
              ) : (
                <span className="inline-flex items-center gap-1 text-pay">
                  <Spinner className="h-3 w-3" /> {p.payoutBatchStatus ?? "PENDING"}, checking with PayPal
                </span>
              )}
            </span>
          </li>
        </ol>
      </div>
      {deal.can.refund ? (
        <Card className="p-3 text-sm">
          <p className="text-ink-soft">Something wrong with the item? You can report a problem within 24 hours of pickup. Barley issues the refund through PayPal.</p>
          <Button variant="danger" size="sm" className="mt-2" onClick={onRefund} busy={refundBusy} data-testid="refund">
            Report a problem and refund {formatUsdExact(a.offer.priceCents)}
          </Button>
        </Card>
      ) : null}
    </div>
  );
}

export function OutcomePanel({ deal }: { deal: DealView }) {
  const text: Record<string, { title: string; body: string }> = {
    walked: { title: "No deal this time", body: deal.outcomeNote ?? "One side walked away. No money moved." },
    expired: { title: "No deal this time", body: deal.outcomeNote ?? "The haggle hit the round limit. No money moved." },
    voided: {
      title: "Hold released",
      body: `PayPal voided the authorization${deal.payment.voidReason ? `: ${deal.payment.voidReason}` : "."} ${deal.buyerName} was never charged, and the listing is available again.`,
    },
    refunded: { title: "Refunded", body: `PayPal refund ${deal.payment.refundId ?? ""} (${deal.payment.refundStatus ?? "issued"}). The money is on its way back to ${deal.buyerName}.` },
  };
  const t = text[deal.status];
  if (!t) return null;
  return (
    <Card className="p-4" as="section">
      <h3 className="text-lg font-semibold">{t.title}</h3>
      <p className="mt-1 text-sm text-ink-soft" data-testid="outcome">
        {t.body}
      </p>
      {deal.payment.authorizationId && deal.status === "voided" ? (
        <p className="mt-2 font-mono text-[12px] text-ink-soft">
          authorization {deal.payment.authorizationId} {deal.payment.authorizationStatus}
        </p>
      ) : null}
      <Link href="/" className="mt-3 inline-flex min-h-11 items-center rounded-xl border border-paper-3 bg-white px-4 font-semibold hover:bg-paper-2">
        Back to the shelf
      </Link>
    </Card>
  );
}
