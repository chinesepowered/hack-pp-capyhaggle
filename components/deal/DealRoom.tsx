"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatUsd, formatUsdExact } from "@/lib/money";
import type { AgentName } from "@/lib/types";
import type { DealView } from "@/lib/views";
import { api, ApiError, useApp } from "../app-context";
import { ListingFacts, ListingPhoto } from "../ListingCard";
import type { CapyMood } from "../mascots/Capy";
import { HotSpring, type HotSpringPhase } from "../mascots/HotSpring";
import { AiTag, Button, Card, ErrorNote, inputClass, Pill, Spinner, statusLabel } from "../ui";
import { BuyerQr, SellerScan } from "./Handoff";
import { AcceptCard, HoldBanner, MandateCard, OutcomePanel, PaidPanel, Tracker } from "./Panels";
import { PayPalHold, ReplayApproval } from "./PayPalHold";
import { PriceTrack } from "./PriceTrack";
import { Thread } from "./Thread";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SCAM_EXAMPLES: Record<"buyer" | "seller", string> = {
  buyer: "I'll send a courier to collect it. Just pay the shipping fee first and I'll add it to the total.",
  seller: "Skip the app. Pay a $20 deposit by gift card and I'll hold it for you.",
};

function scenePhase(deal: DealView): HotSpringPhase {
  if (deal.status === "negotiating") return deal.paused ? "paused" : "haggling";
  if (["agreed", "awaiting_payment", "held", "completed", "refunded"].includes(deal.status)) return "deal";
  return "walked";
}

export function DealRoom({ id }: { id: string }) {
  const { role, setRole, setHoodDeal, ready } = useApp();
  const [deal, setDeal] = useState<DealView | null>(null);
  const [error, setError] = useState<{ message: string; debugId?: string } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [typing, setTyping] = useState<AgentName | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [halted, setHalted] = useState(false);
  const [draft, setDraft] = useState("");
  const stepping = useRef(false);
  const asked = useRef<{ summary?: boolean; verify?: boolean }>({});
  const dealRef = useRef<DealView | null>(null);

  const accept = useCallback((next: DealView) => {
    // Never let an older answer overwrite a newer one.
    const current = dealRef.current;
    if (current && current.role === next.role && next.updatedAt < current.updatedAt) return;
    dealRef.current = next;
    setDeal(next);
  }, []);

  const fail = useCallback((e: unknown, fallback: string) => {
    setError(e instanceof ApiError ? { message: e.message, debugId: e.debugId } : { message: fallback });
  }, []);

  const load = useCallback(
    async (refresh: boolean) => {
      try {
        const next = await api<DealView>(`/api/deals/${id}?as=${role}${refresh ? "&refresh=1" : ""}`);
        if (dealRef.current && dealRef.current.role !== next.role) dealRef.current = null;
        accept(next);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) setNotFound(true);
        else if (!dealRef.current) fail(e, "Could not load this deal.");
      }
    },
    [id, role, accept, fail],
  );

  // Load, and reload when the viewer switches between Maya and Theo.
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    api<DealView>(`/api/deals/${id}?as=${role}&refresh=1`)
      .then((next) => {
        if (!alive) return;
        if (dealRef.current && dealRef.current.role !== next.role) dealRef.current = null;
        accept(next);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 404) setNotFound(true);
        else if (!dealRef.current) fail(e, "Could not load this deal.");
      });
    return () => {
      alive = false;
    };
  }, [ready, id, role, accept, fail]);

  // Feed the "Under the hood" drawer.
  useEffect(() => {
    setHoodDeal(deal);
  }, [deal, setHoodDeal]);
  useEffect(() => () => setHoodDeal(null), [setHoodDeal]);

  const act = useCallback(
    async (action: string, body: Record<string, unknown> = {}, label = action) => {
      setBusy(label);
      setError(null);
      try {
        const res = await api<{ deal: DealView; flagged?: boolean }>(`/api/deals/${id}/${action}`, { body: { as: role, ...body } });
        accept(res.deal);
        return res;
      } catch (e) {
        fail(e, "That did not work. Nothing changed.");
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [id, role, accept, fail],
  );

  // The haggle runs itself: one server call per agent turn, so there is no long-running process.
  const stepKey = deal && deal.can.step && !halted ? deal.turns.length : -1;
  useEffect(() => {
    if (stepKey < 0 || stepping.current) return;
    const current = dealRef.current;
    if (!current) return;
    stepping.current = true;
    const actor = current.nextActor;
    (async () => {
      await sleep(650);
      setTyping(actor);
      const started = Date.now();
      try {
        const res = await api<{ deal: DealView }>(`/api/deals/${id}/step`, { body: { as: role } });
        const elapsed = Date.now() - started;
        if (elapsed < 1100) await sleep(1100 - elapsed);
        setTyping(null);
        accept(res.deal);
      } catch (e) {
        setTyping(null);
        setHalted(true);
        fail(e, "The haggle hit a problem.");
      } finally {
        stepping.current = false;
      }
    })();
  }, [stepKey, id, role, accept, fail]);

  // After the referee declares a deal: ask for the summary once.
  useEffect(() => {
    if (!deal || deal.status !== "agreed" || deal.agreed?.summary || asked.current.summary) return;
    asked.current.summary = true;
    void api<{ deal: DealView }>(`/api/deals/${id}/summary`, { body: { as: role } })
      .then((res) => accept(res.deal))
      .catch(() => undefined);
  }, [deal, id, role, accept]);

  // Once the money is held: Biscuit verifies it with PayPal (Agent Toolkit get_order), once.
  useEffect(() => {
    if (!deal || deal.status !== "held" || asked.current.verify) return;
    if (deal.turns.some((t) => t.tool?.name === "get_order")) return;
    asked.current.verify = true;
    void api<{ deal: DealView }>(`/api/deals/${id}/verify`, { body: { as: role } })
      .then((res) => accept(res.deal))
      .catch(() => undefined);
  }, [deal, id, role, accept]);

  // Polling: re-read PayPal whenever a money state can change, so nothing depends on webhooks.
  const status = deal?.status;
  const payoutPending = status === "completed" && deal?.payment.payoutItemStatus !== "SUCCESS";
  const paused = deal?.paused;
  useEffect(() => {
    if (!status) return;
    const plan: Record<string, { every: number; refresh: boolean } | undefined> = {
      agreed: { every: 3000, refresh: false },
      awaiting_payment: { every: 6000, refresh: true },
      held: { every: 12000, refresh: true },
      completed: payoutPending ? { every: 2500, refresh: true } : undefined,
      negotiating: paused ? { every: 3000, refresh: false } : undefined,
    };
    const p = plan[status];
    if (!p) return;
    const t = setInterval(() => {
      if (!stepping.current) void load(p.refresh);
    }, p.every);
    return () => clearInterval(t);
  }, [status, payoutPending, paused, load]);

  if (notFound) {
    return (
      <Card className="mx-auto max-w-lg p-6 text-center">
        <h1 className="text-2xl font-semibold">That deal is not here</h1>
        <p className="mt-2 text-ink-soft">It may have been cleared by a demo reset.</p>
        <Link href="/" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-spring-deep px-4 font-semibold text-white">
          Back to the shelf
        </Link>
      </Card>
    );
  }
  if (!deal) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-ink-soft" role="status">
        <Spinner className="h-6 w-6" />
        <p>Filling the hot spring</p>
        <ErrorNote error={error} />
      </div>
    );
  }

  const phase = scenePhase(deal);
  const lastAgent = [...deal.turns].reverse().find((t) => t.actor === "barley" || t.actor === "biscuit")?.actor as AgentName | undefined;
  const speaker = deal.status === "negotiating" && !typing ? (lastAgent ?? null) : null;
  const mood = (who: AgentName): CapyMood | undefined => {
    if (deal.status !== "negotiating") return undefined;
    if (typing === who) return "thinking";
    if (speaker === who) return "talking";
    return "idle";
  };
  const s = statusLabel(deal.status);
  const me = role === "buyer" ? deal.buyerName : deal.sellerName;
  const otherRole = role === "buyer" ? "seller" : "buyer";

  async function send(text: string) {
    const res = await act("message", { text }, "message");
    if (res) setDraft("");
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]" data-testid="deal-room" data-status={deal.status}>
      <div className="flex min-w-0 flex-col gap-3 lg:h-[calc(100dvh-104px)] lg:min-h-[640px]">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold sm:text-2xl">{deal.listing.title}</h1>
          <Pill tone={s.tone}>{s.label}</Pill>
          {deal.mode === "replay" ? <Pill tone="yuzu">Replay of a recorded sandbox run</Pill> : <Pill tone="money">Live sandbox</Pill>}
          {deal.seeded ? <Pill>seeded</Pill> : null}
        </div>

        <div className="grid shrink-0 gap-3 xl:grid-cols-[minmax(0,1fr)_250px]">
          <div className="overflow-hidden rounded-2xl border border-paper-3 bg-[#e9f5f1]">
            <HotSpring phase={phase} speaker={speaker} barleyMood={mood("barley")} biscuitMood={mood("biscuit")} className="mx-auto block h-auto max-h-[300px] w-full" />
          </div>
          <PriceTrack deal={deal} />
        </div>

        <Card className="flex min-h-[320px] flex-1 flex-col overflow-hidden lg:min-h-0">
          <Thread deal={deal} typing={typing} />
          {deal.can.jumpIn ? (
            <div className="border-t border-paper-3 bg-paper/60 p-3">
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (draft.trim()) void send(draft.trim());
                }}
              >
                <label htmlFor="jump-in" className="sr-only">
                  Jump in as {me}
                </label>
                <input
                  id="jump-in"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={`Jump in as ${me}. Messages are safety-checked first.`}
                  className={inputClass}
                  maxLength={500}
                  data-testid="jump-in"
                />
                <Button type="submit" variant="secondary" busy={busy === "message"} disabled={!draft.trim()} data-testid="send">
                  Send
                </Button>
              </form>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {deal.can.pause ? (
                  <Button size="sm" variant="secondary" onClick={() => act("pause", { paused: !deal.paused }, "pause")} busy={busy === "pause"} data-testid="pause">
                    {deal.paused ? "Resume the haggle" : "Pause"}
                  </Button>
                ) : null}
                {halted ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      setError(null);
                      setHalted(false);
                    }}
                  >
                    Try again
                  </Button>
                ) : null}
                {deal.status === "negotiating" || deal.status === "agreed" ? (
                  <Button size="sm" variant="ghost" onClick={() => act("walk", {}, "walk")} busy={busy === "walk"} data-testid="walk">
                    Walk away
                  </Button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setDraft(SCAM_EXAMPLES[role])}
                  className="ml-auto rounded-lg border border-dashed border-danger px-2.5 py-1.5 text-xs font-semibold text-danger hover:bg-danger-soft"
                  data-testid="scam-example"
                >
                  Try a scam message
                </button>
              </div>
            </div>
          ) : null}
        </Card>
        <ErrorNote error={error} />
      </div>

      <aside className="flex min-w-0 flex-col gap-3" aria-label="Deal status and actions">
        <Tracker deal={deal} />

        {deal.status === "agreed" ? (
          <AcceptCard deal={deal} onAccept={() => act("accept", {}, "accept")} busy={busy === "accept"} onSwitchRole={() => setRole(otherRole)} />
        ) : null}

        {deal.status === "awaiting_payment" ? (
          <Card className="flex flex-col gap-3 border-2 border-pay p-4" as="section">
            <h3 className="text-lg font-semibold">
              {role === "buyer" ? `Hold ${formatUsdExact(deal.agreed?.offer.priceCents ?? 0)} with PayPal` : `Waiting for ${deal.buyerName} to approve with PayPal`}
            </h3>
            <p className="text-sm text-ink-soft">
              Barley created PayPal order <span className="font-mono text-xs text-ink">{deal.payment.orderId}</span> with intent AUTHORIZE. Approving it places a hold. Nothing is sent to{" "}
              {deal.sellerName} yet.
            </p>
            {role === "buyer" ? (
              deal.mode === "replay" ? (
                <ReplayApproval deal={deal} onDeal={accept} />
              ) : (
                <PayPalHold deal={deal} onDeal={accept} />
              )
            ) : (
              <p className="text-sm">
                <button type="button" onClick={() => setRole("buyer")} className="font-semibold text-pay underline underline-offset-2" data-testid="switch-role">
                  Switch to {deal.buyerName}&apos;s view
                </button>{" "}
                to approve the payment.
              </p>
            )}
          </Card>
        ) : null}

        {deal.status === "held" ? (
          <>
            <HoldBanner deal={deal} />
            <Card className="flex flex-col gap-3 p-4" as="section">
              <h3 className="text-lg font-semibold">{role === "buyer" ? "Your pickup code" : "Handoff"}</h3>
              <p className="text-sm">
                <span className="text-ink-soft">Pickup window:</span> {deal.agreed?.pickupLabel}, {deal.listing.area}
              </p>
              {role === "buyer" ? <BuyerQr deal={deal} /> : <SellerScan deal={deal} onDeal={accept} />}
              <p className="text-xs text-ink-soft">
                {role === "buyer" ? (
                  <>
                    Demo on one screen?{" "}
                    <button type="button" onClick={() => setRole("seller")} className="font-semibold text-pay underline underline-offset-2" data-testid="switch-role">
                      Switch to {deal.sellerName}&apos;s view
                    </button>{" "}
                    to scan.
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => setRole("buyer")} className="font-semibold text-pay underline underline-offset-2" data-testid="switch-role">
                      Switch to {deal.buyerName}&apos;s view
                    </button>{" "}
                    to see the QR code.
                  </>
                )}
              </p>
            </Card>
            {deal.can.reportNoShow ? (
              <Card className="p-3 text-sm" as="section">
                <p className="text-ink-soft">
                  If {deal.buyerName} does not show by the end of the pickup window, the authorization is voided automatically and the hold is released.
                </p>
                <Button variant="danger" size="sm" className="mt-2" onClick={() => act("void", { demoFastForward: true }, "void")} busy={busy === "void"} data-testid="no-show">
                  Demo: fast-forward past the window (buyer no-show)
                </Button>
              </Card>
            ) : null}
          </>
        ) : null}

        {deal.status === "completed" ? <PaidPanel deal={deal} onRefund={() => act("refund", { reason: "The item was not as described." }, "refund")} refundBusy={busy === "refund"} /> : null}

        <OutcomePanel deal={deal} />

        {deal.status === "negotiating" || deal.status === "agreed" ? <MandateCard deal={deal} /> : null}

        <Card className="overflow-hidden" as="section">
          <div className="flex gap-3 p-3">
            <ListingPhoto listing={deal.listing} className="h-20 w-24 shrink-0 rounded-xl" />
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold">{deal.listing.title}</h3>
              <p className="text-sm text-ink-soft">
                Asking {formatUsd(deal.listing.askingCents)}, {deal.listing.conditionGrade}, {deal.listing.area}
              </p>
              <AiTag tag={deal.listing.ai} className="mt-1" />
            </div>
          </div>
          <details className="border-t border-paper-3 px-3 py-2 text-sm">
            <summary className="cursor-pointer font-semibold">Listing facts the agents may use</summary>
            <p className="my-2 text-ink-soft">{deal.listing.description}</p>
            <ListingFacts listing={deal.listing} compact />
            {deal.listing.photoCredit ? <p className="mt-2 text-xs text-ink-soft">{deal.listing.photoCredit}</p> : null}
          </details>
        </Card>
      </aside>
    </div>
  );
}
