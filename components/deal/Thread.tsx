"use client";

import { useEffect, useRef } from "react";
import { formatUsd } from "@/lib/money";
import type { AgentName, Offer, Turn } from "@/lib/types";
import type { DealView } from "@/lib/views";
import { BarleyAvatar, BiscuitAvatar } from "../mascots/Capy";
import { AiTag, cx, Pill } from "../ui";

function OfferChips({ deal, offer, accepted }: { deal: DealView; offer: Offer; accepted?: boolean }) {
  const win = deal.listing.pickupWindows.find((w) => w.id === offer.pickupWindowId)?.label ?? deal.agreed?.pickupLabel ?? offer.pickupWindowId;
  const extras = offer.extras.map((id) => deal.listing.extras.find((e) => e.id === id)?.label ?? id);
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1.5" data-testid="offer">
      <span className={cx("rounded-lg px-2 py-0.5 font-display text-xl font-semibold", accepted ? "bg-money text-white" : "bg-ink text-white")}>{formatUsd(offer.priceCents)}</span>
      <Pill>Pickup {win}</Pill>
      {extras.map((e) => (
        <Pill key={e} tone="yuzu">
          + {e}
        </Pill>
      ))}
      {accepted ? <Pill tone="money">accepted</Pill> : null}
    </div>
  );
}

function Trail({ turn, owner }: { turn: Turn; owner: string }) {
  if (!turn.trail || turn.trail.length === 0) return null;
  const blocked = turn.trail.filter((s) => s.tone === "blocked").length;
  return (
    <details className="mt-2 rounded-lg border border-paper-3 bg-paper/70 px-2.5 py-1.5 text-xs">
      <summary className="cursor-pointer select-none font-semibold text-ink-soft">
        Reasoning trail, only {owner} sees this
        {blocked ? (
          <Pill tone="danger" className="ml-2">
            referee blocked {blocked}
          </Pill>
        ) : null}
      </summary>
      <ol className="mt-1.5 flex flex-col gap-1">
        {turn.trail.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span
              aria-hidden="true"
              className={cx("mt-1 h-2 w-2 shrink-0 rounded-full", s.tone === "blocked" ? "bg-danger" : s.tone === "ok" ? "bg-money" : "bg-ink-soft")}
            />
            <span>
              <span className={cx("font-semibold", s.tone === "blocked" && "text-danger")}>{s.label}</span>
              {s.detail ? <span className="text-ink-soft"> {s.detail}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

function AgentBubble({ deal, turn }: { deal: DealView; turn: Turn }) {
  const agent = turn.actor as AgentName;
  const isBarley = agent === "barley";
  const owner = isBarley ? deal.buyerName : deal.sellerName;
  return (
    <li className={cx("animate-pop-in flex items-end gap-2", isBarley ? "justify-start" : "flex-row-reverse justify-start")} data-testid={`turn-${agent}`}>
      <span className="shrink-0" aria-hidden="true">
        {isBarley ? <BarleyAvatar size={44} /> : <BiscuitAvatar size={44} />}
      </span>
      <div
        className={cx(
          "max-w-[min(84%,560px)] rounded-2xl border px-3.5 py-2.5",
          isBarley ? "rounded-bl-sm border-spring-light bg-barley-soft" : "rounded-br-sm border-[#f3cfa9] bg-biscuit-soft",
          turn.kind === "refusal" && "border-danger bg-white",
        )}
      >
        <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-display text-sm font-semibold">{isBarley ? "Barley" : "Biscuit"}</span>
          <span className="text-ink-soft">for {owner}</span>
          {turn.kind === "tool" ? <Pill tone="pay">tool call</Pill> : null}
          {turn.kind === "refusal" ? <Pill tone="danger">refused</Pill> : null}
          {turn.kind === "walk" ? <Pill>walked away</Pill> : null}
          <AiTag tag={turn.ai} />
        </div>
        {turn.offer ? <OfferChips deal={deal} offer={turn.offer} accepted={turn.kind === "accept"} /> : null}
        <p className="text-[15px] leading-snug">{turn.message}</p>
        {turn.tool ? (
          <div className="mt-2 rounded-lg border border-[#bcd2f5] bg-pay-soft px-2.5 py-1.5 font-mono text-[12px] leading-relaxed text-ink">
            <div>
              <span className="font-bold text-pay">{turn.tool.name}</span>({JSON.stringify(turn.tool.args)})
            </div>
            <div className="text-ink-soft">
              {turn.tool.source === "agent-toolkit" ? "PayPal Agent Toolkit tool" : "Capy tool on the PayPal server SDK"}, guarded in code. Result: {turn.tool.outcome}
            </div>
          </div>
        ) : null}
        <Trail turn={turn} owner={owner} />
      </div>
    </li>
  );
}

function HumanBubble({ deal, turn }: { deal: DealView; turn: Turn }) {
  const isBuyer = turn.actor === "maya";
  const flag = turn.flagId ? deal.flags.find((f) => f.id === turn.flagId) : undefined;
  return (
    <li className={cx("animate-pop-in flex", isBuyer ? "justify-start pl-12" : "justify-end pr-12")} data-testid="turn-human">
      <div className={cx("max-w-[min(84%,560px)] rounded-2xl border px-3.5 py-2", flag ? "border-danger bg-danger-soft" : "border-paper-3 bg-white")}>
        <div className="mb-0.5 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-semibold">{isBuyer ? deal.buyerName : deal.sellerName}</span>
          <span className="text-ink-soft">typed this</span>
        </div>
        <p className="text-[15px] leading-snug">{turn.message}</p>
        {flag ? (
          <div className="mt-2 rounded-lg border border-danger bg-white px-2.5 py-2 text-sm" role="alert" data-testid="scam-flag">
            <div className="flex flex-wrap items-center gap-1.5 font-semibold text-danger">
              <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
                <path d="M10 2 1.5 17h17L10 2Z" fill="currentColor" />
                <path d="M10 8v4.5M10 14.6v.2" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              Safety check: {flag.patterns.join(", ")}
              <Pill tone="danger">{flag.source === "rules+llm" ? "rules + AI" : flag.source === "rules" ? "rules" : "AI"}</Pill>
              <AiTag tag={flag.ai} />
            </div>
            <p className="mt-1 text-ink">{flag.explanation}</p>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function SystemLine({ turn }: { turn: Turn }) {
  const referee = turn.actor === "referee";
  return (
    <li className="animate-fade-in flex justify-center" data-testid="turn-system">
      <p className={cx("max-w-[92%] rounded-full border px-3 py-1 text-center text-[13px]", referee ? "border-ink bg-ink text-white" : "border-paper-3 bg-paper-2 text-ink-soft")}>
        {referee ? <span className="mr-1 font-bold">Referee:</span> : null}
        {turn.message}
      </p>
    </li>
  );
}

export function Thread({ deal, typing }: { deal: DealView; typing: AgentName | null }) {
  const endRef = useRef<HTMLLIElement>(null);
  const count = deal.turns.length;
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    endRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
  }, [count, typing]);

  const last = deal.turns[deal.turns.length - 1];
  const announce = last
    ? `${last.actor === "barley" ? "Barley" : last.actor === "biscuit" ? "Biscuit" : last.actor === "maya" ? deal.buyerName : last.actor === "theo" ? deal.sellerName : "Referee"}: ${
        last.offer ? `${formatUsd(last.offer.priceCents)}. ` : ""
      }${last.message}`
    : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ol className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 py-4 sm:px-4" aria-label="Haggle thread" data-testid="thread">
        {deal.turns.map((t) =>
          t.actor === "barley" || t.actor === "biscuit" ? (
            <AgentBubble key={t.n} deal={deal} turn={t} />
          ) : t.kind === "human" ? (
            <HumanBubble key={t.n} deal={deal} turn={t} />
          ) : (
            <SystemLine key={t.n} turn={t} />
          ),
        )}
        {typing ? (
          <li className={cx("flex items-end gap-2", typing === "barley" ? "" : "flex-row-reverse")} aria-hidden="true">
            <span className="shrink-0">{typing === "barley" ? <BarleyAvatar size={44} /> : <BiscuitAvatar size={44} />}</span>
            <span className={cx("flex gap-1 rounded-2xl border px-4 py-3", typing === "barley" ? "border-spring-light bg-barley-soft" : "border-[#f3cfa9] bg-biscuit-soft")}>
              {[0, 1, 2].map((i) => (
                <span key={i} className="typing-dot h-2 w-2 rounded-full bg-ink-soft" style={{ animationDelay: `${i * 0.16}s` }} />
              ))}
            </span>
          </li>
        ) : null}
        <li ref={endRef} aria-hidden="true" />
      </ol>
      {/* Screen readers hear each new move once, politely. */}
      <p className="sr-only" role="status" aria-live="polite">
        {typing ? `${typing === "barley" ? "Barley" : "Biscuit"} is thinking.` : announce}
      </p>
    </div>
  );
}
