"use client";

import { formatUsd } from "@/lib/money";
import type { DealView } from "@/lib/views";
import { cx, LockIcon, Pill } from "../ui";

/**
 * The scoreboard: both sides' latest offers on one price line, closing in on each other.
 * The viewer's own private limit is marked; the other side's limit is never in this browser.
 */
export function PriceTrack({ deal }: { deal: DealView }) {
  const offers = deal.turns.filter((t) => t.offer && (t.actor === "barley" || t.actor === "biscuit") && t.kind === "offer");
  const barley = offers.filter((t) => t.actor === "barley").map((t) => t.offer!.priceCents);
  const biscuit = offers.filter((t) => t.actor === "biscuit").map((t) => t.offer!.priceCents);
  const agreed = deal.agreed?.offer.priceCents;
  const ownLimit = deal.mandates[deal.role].limitCents;
  const asking = deal.listing.askingCents;

  const all = [...barley, ...biscuit, asking, ...(agreed ? [agreed] : []), ...(ownLimit ? [ownLimit] : [])];
  const lo = Math.min(...all, asking * 0.65);
  const hi = Math.max(...all);
  const pad = (hi - lo) * 0.08 || 100;
  const min = lo - pad;
  const max = hi + pad;
  const pos = (cents: number) => `${((cents - min) / (max - min)) * 100}%`;

  const lastBarley = barley.at(-1);
  const lastBiscuit = biscuit.at(-1);
  const gap = lastBarley !== undefined && lastBiscuit !== undefined ? lastBiscuit - lastBarley : undefined;
  const over = !["negotiating", "agreed", "awaiting_payment", "held", "completed", "refunded"].includes(deal.status);

  return (
    <section className="flex h-full flex-col justify-between gap-3 rounded-2xl border border-paper-3 bg-white p-4" aria-label="Price scoreboard" data-testid="price-track">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold">Scoreboard</h3>
        {agreed ? (
          <Pill tone="money">Deal</Pill>
        ) : over ? (
          <Pill>No deal</Pill>
        ) : (
          <Pill tone="spring">
            Round {Math.min(deal.round, deal.maxRounds)} of {deal.maxRounds}
          </Pill>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded-xl border border-spring-light bg-barley-soft px-2 py-1.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-spring-deep">Barley bids</p>
          <p className="font-display text-2xl font-semibold leading-tight" data-testid="barley-price">
            {lastBarley !== undefined ? formatUsd(lastBarley) : "..."}
          </p>
        </div>
        <div className="rounded-xl border border-[#f3cfa9] bg-biscuit-soft px-2 py-1.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[#7a3d12]">Biscuit asks</p>
          <p className="font-display text-2xl font-semibold leading-tight" data-testid="biscuit-price">
            {lastBiscuit !== undefined ? formatUsd(lastBiscuit) : formatUsd(asking)}
          </p>
        </div>
      </div>

      <div className="relative mx-2 h-16" aria-hidden="true">
        <div className="absolute inset-x-0 top-8 h-1.5 rounded-full bg-paper-3" />
        {lastBarley !== undefined && lastBiscuit !== undefined && !agreed ? (
          <div className="absolute top-8 h-1.5 rounded-full bg-yuzu transition-all duration-700" style={{ left: pos(lastBarley), width: `calc(${pos(lastBiscuit)} - ${pos(lastBarley)})` }} />
        ) : null}
        {barley.slice(0, -1).map((c, i) => (
          <span key={`b${i}`} className="absolute top-[30px] h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-spring-light" style={{ left: pos(c) }} />
        ))}
        {biscuit.slice(0, -1).map((c, i) => (
          <span key={`s${i}`} className="absolute top-[30px] h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-[#f3cfa9]" style={{ left: pos(c) }} />
        ))}
        {ownLimit !== undefined ? (
          <span className="absolute top-0 flex -translate-x-1/2 flex-col items-center text-[10px] font-semibold text-ink-soft" style={{ left: pos(ownLimit) }}>
            <LockIcon className="h-3 w-3" />
            <span className="h-[26px] w-px border-l border-dashed border-ink-soft" />
          </span>
        ) : null}
        {!agreed && lastBarley !== undefined ? (
          <span className={cx("absolute top-[25px] h-5 w-5 -translate-x-1/2 rounded-full border-2 border-white bg-spring-deep shadow transition-all duration-700")} style={{ left: pos(lastBarley) }} />
        ) : null}
        {!agreed && lastBiscuit !== undefined ? (
          <span className="absolute top-[25px] h-5 w-5 -translate-x-1/2 rounded-full border-2 border-white bg-scarf shadow transition-all duration-700" style={{ left: pos(lastBiscuit) }} />
        ) : null}
        {agreed ? (
          <span className="animate-pop-in absolute top-[21px] flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full border-2 border-white bg-money text-white shadow" style={{ left: pos(agreed) }}>
            <svg viewBox="0 0 16 16" className="h-4 w-4">
              <path d="m3 8.5 3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        ) : null}
        <span className="absolute top-[46px] -translate-x-full whitespace-nowrap pr-0 text-[11px] text-ink-soft" style={{ left: `calc(${pos(asking)} + 14px)` }}>
          asking {formatUsd(asking)}
        </span>
      </div>

      <p className="text-center text-sm" role="status">
        {agreed ? (
          <span className="font-display text-xl font-semibold text-money" data-testid="deal-price">
            Deal at {formatUsd(agreed)}
          </span>
        ) : gap !== undefined ? (
          <span>
            Gap: <strong className="font-display text-lg">{formatUsd(Math.max(0, gap))}</strong>
          </span>
        ) : over ? (
          <span className="text-ink-soft">The haggle ended without a deal.</span>
        ) : (
          <span className="text-ink-soft">Waiting for the first offer</span>
        )}
      </p>
      {ownLimit !== undefined ? (
        <p className="flex items-center justify-center gap-1 text-[11px] text-ink-soft">
          <LockIcon className="h-3 w-3" /> your private {deal.role === "buyer" ? "ceiling" : "floor"} {formatUsd(ownLimit)}, visible only to you
        </p>
      ) : null}
    </section>
  );
}
