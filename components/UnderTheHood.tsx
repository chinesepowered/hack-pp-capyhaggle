"use client";

import { useEffect, useRef } from "react";
import { formatUsd } from "@/lib/money";
import type { PayPalCall } from "@/lib/types";
import { useApp } from "./app-context";
import { cx, Pill } from "./ui";

const VIA_LABEL: Record<string, string> = {
  "server-sdk": "Server SDK",
  rest: "REST",
  "agent-toolkit": "Agent Toolkit",
  "js-sdk": "JS SDK v6",
};

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour12: false });
}

/** Every PayPal call this deal made: method, path, status, PayPal-Debug-Id, and the feature that triggered it. */
export function UnderTheHood() {
  const { hoodOpen, setHoodOpen, hoodDeal, role } = useApp();
  const closeRef = useRef<HTMLButtonElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!hoodOpen) return;
    lastFocus.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHoodOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      lastFocus.current?.focus?.();
    };
  }, [hoodOpen, setHoodOpen]);

  if (!hoodOpen) return null;
  const deal = hoodDeal;
  // Newest first. Runs of the same polling GET collapse into one row with a count.
  const calls: (PayPalCall & { repeats: number })[] = [];
  for (const c of deal ? [...deal.calls].reverse() : []) {
    const prev = calls[calls.length - 1];
    if (prev && c.method === "GET" && prev.method === "GET" && prev.path === c.path && prev.feature === c.feature && prev.status === c.status) prev.repeats += 1;
    else calls.push({ ...c, repeats: 1 });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" data-testid="hood">
      <button type="button" aria-label="Close the drawer" className="absolute inset-0 bg-ink/40" onClick={() => setHoodOpen(false)} tabIndex={-1} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="hood-title"
        className="animate-fade-in relative flex h-full w-full max-w-[760px] flex-col border-l border-paper-3 bg-paper shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-paper-3 px-5 py-4">
          <div>
            <h2 id="hood-title" className="text-xl font-semibold">
              Under the hood
            </h2>
            <p className="text-sm text-ink-soft">
              {deal ? `Every PayPal call made for deal ${deal.id}, newest first.` : "Open a deal to see every PayPal call it makes."}
            </p>
          </div>
          <button ref={closeRef} type="button" onClick={() => setHoodOpen(false)} className="rounded-lg border border-paper-3 bg-white px-3 py-1.5 text-sm font-semibold hover:bg-paper-2">
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!deal ? (
            <p className="rounded-xl border border-dashed border-paper-3 bg-white p-4 text-sm text-ink-soft">
              Nothing to show yet. Start a haggle from the shelf, or open one of the seeded deals: its calls were made against the real PayPal sandbox.
            </p>
          ) : (
            <>
              <section aria-labelledby="hood-calls">
                <h3 id="hood-calls" className="mb-2 flex items-center gap-2 text-base font-semibold">
                  PayPal calls <Pill tone="pay">{deal.calls.length}</Pill>
                  {deal.mode === "replay" ? <Pill tone="yuzu">replayed from a recording</Pill> : <Pill tone="money">live sandbox</Pill>}
                </h3>
                {calls.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-paper-3 bg-white p-4 text-sm text-ink-soft">
                    No PayPal call yet. The first one happens when both owners tap Accept and Barley creates the order.
                  </p>
                ) : (
                  <ol className="flex flex-col gap-2" data-testid="hood-calls">
                    {calls.map((c) => (
                      <li key={c.id} className="rounded-xl border border-paper-3 bg-white p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cx(
                              "rounded-md px-1.5 py-0.5 font-mono text-xs font-bold",
                              c.method === "GET" ? "bg-spring-mist text-spring-deep" : c.method === "SDK" ? "bg-paper-2 text-ink-soft" : "bg-pay-soft text-pay",
                            )}
                          >
                            {c.method}
                          </span>
                          <code className="min-w-0 flex-1 break-all font-mono text-[13px] text-ink">{c.path}</code>
                          {c.repeats > 1 ? <Pill title="The same status re-read, polled until it settled">polled x{c.repeats}</Pill> : null}
                          <span
                            className={cx(
                              "rounded-md px-1.5 py-0.5 font-mono text-xs font-bold",
                              c.status >= 200 && c.status < 300 ? "bg-money-soft text-money" : c.status === 0 ? "bg-warn-soft text-warn" : "bg-danger-soft text-danger",
                            )}
                          >
                            {c.status === 0 ? "no answer" : c.status}
                          </span>
                        </div>
                        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-ink-soft sm:grid-cols-[auto_1fr_auto_1fr]">
                          <dt className="font-semibold">Feature</dt>
                          <dd className="text-ink">{c.feature}</dd>
                          <dt className="font-semibold">PayPal-Debug-Id</dt>
                          <dd className="font-mono text-ink">{c.debugId ?? (c.via === "js-sdk" ? "browser side" : "none returned")}</dd>
                          <dt className="font-semibold">Via</dt>
                          <dd className="text-ink">
                            {VIA_LABEL[c.via] ?? c.via}
                            {c.replayed ? " (replayed)" : ""}
                          </dd>
                          <dt className="font-semibold">When</dt>
                          <dd className="text-ink">
                            {time(c.at)}
                            {c.ms ? `, ${c.ms} ms` : ""}
                          </dd>
                          {c.requestId ? (
                            <>
                              <dt className="font-semibold">PayPal-Request-Id</dt>
                              <dd className="break-all font-mono text-ink sm:col-span-3">{c.requestId}</dd>
                            </>
                          ) : null}
                          {c.note ? (
                            <>
                              <dt className="font-semibold">Note</dt>
                              <dd className="text-ink sm:col-span-3">{c.note}</dd>
                            </>
                          ) : null}
                        </dl>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              <section aria-labelledby="hood-mandates" className="mt-6">
                <h3 id="hood-mandates" className="mb-2 text-base font-semibold">
                  Signed mandates
                </h3>
                <p className="mb-2 text-sm text-ink-soft">
                  Each agent can only act inside its owner&apos;s mandate: signed JSON with a limit, an item scope and an expiry (HMAC-SHA256). The idea follows the intent mandates of agent payment
                  protocols such as AP2; this is our own format and does not claim compliance. You are viewing as {role === "buyer" ? "Maya" : "Theo"}, so the other side&apos;s limit is hidden.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(["buyer", "seller"] as const).map((r) => {
                    const m = deal.mandates[r];
                    return (
                      <pre key={r} className="overflow-x-auto rounded-xl border border-paper-3 bg-white p-3 font-mono text-[12px] leading-relaxed text-ink">
                        {JSON.stringify(
                          {
                            id: m.id,
                            agent: m.agent,
                            owner: m.owner,
                            role: m.role,
                            listingId: deal.listing.id,
                            limit: m.limitCents !== undefined ? formatUsd(m.limitCents) : "hidden from you",
                            pickupWindows: m.pickupWindowIds ?? "hidden from you",
                            expiresAt: m.expiresAt,
                            sig: m.sigShort,
                          },
                          null,
                          2,
                        )}
                      </pre>
                    );
                  })}
                </div>
              </section>

              <section aria-labelledby="hood-webhooks" className="mt-6">
                <h3 id="hood-webhooks" className="mb-2 text-base font-semibold">
                  Webhook events
                </h3>
                {deal.webhookEvents.length === 0 ? (
                  <p className="text-sm text-ink-soft">
                    None received for this deal. That is fine: every screen re-reads PayPal directly, so nothing depends on delivery. Events arrive at <code className="font-mono">/api/paypal/webhook</code>{" "}
                    once the webhook is registered for the deployed URL.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1 text-sm">
                    {deal.webhookEvents.map((e) => (
                      <li key={e.id} className="rounded-lg border border-paper-3 bg-white px-3 py-1.5">
                        <span className="font-mono text-xs">{e.type}</span> <span className="text-ink-soft">at {time(e.at)}, verified, id {e.id}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
