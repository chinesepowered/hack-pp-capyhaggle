"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { formatUsd } from "@/lib/money";
import type { Listing, Want } from "@/lib/types";
import { api, ApiError, useApp } from "./app-context";
import { ListingFacts, ListingPhoto, ListingStatus } from "./ListingCard";
import { Barley } from "./mascots/Capy";
import { AiTag, Button, Card, ErrorNote, Field, inputClass, LockIcon, Pill } from "./ui";

const EXAMPLE = "A kid's bike for a 6-year-old, under $90, this weekend, near the Mission.";

interface WantResponse {
  want: Want;
  mentionedCeilingCents?: number;
  matches: { listing: Listing; score: number }[];
}

export function Buy() {
  const router = useRouter();
  const params = useSearchParams();
  const preselected = params.get("listing");
  const { mode, setRole } = useApp();
  const [text, setText] = useState(EXAMPLE);
  const [busy, setBusy] = useState<"find" | "start" | null>(null);
  const [error, setError] = useState<{ message: string } | null>(null);
  const [res, setRes] = useState<WantResponse | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [ceiling, setCeiling] = useState("");
  const [windows, setWindows] = useState<string[]>([]);

  function choose(l: Listing, suggestedCeilingCents?: number) {
    setListing(l);
    setWindows(l.pickupWindows.map((w) => w.id));
    setCeiling(String(Math.round((suggestedCeilingCents ?? l.askingCents * 0.95) / 100)));
  }

  // Arriving from the shelf with a listing already picked.
  useEffect(() => {
    if (!preselected) return;
    let alive = true;
    api<{ listings: Listing[] }>("/api/state")
      .then((s) => {
        const l = s.listings.find((x) => x.id === preselected);
        if (alive && l) choose(l);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [preselected]);

  async function find() {
    setBusy("find");
    setError(null);
    setListing(null);
    try {
      const r = await api<WantResponse>("/api/wants", { body: { text, mode } });
      setRes(r);
      if (r.matches.length === 1) choose(r.matches[0].listing, r.mentionedCeilingCents);
    } catch (e) {
      setError({ message: e instanceof ApiError ? e.message : "The search did not work." });
    } finally {
      setBusy(null);
    }
  }

  async function start() {
    if (!listing) return;
    setBusy("start");
    setError(null);
    try {
      const r = await api<{ id: string }>("/api/deals", {
        body: mode === "replay" ? { mode } : { mode, listingId: listing.id, ceilingCents: Math.round(Number(ceiling)) * 100, pickupWindowIds: windows, wantId: res?.want.id },
      });
      setRole("buyer");
      router.push(`/deal/${r.id}`);
    } catch (e) {
      setError({ message: e instanceof ApiError ? e.message : "Could not start the haggle." });
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[420px_minmax(0,1fr)]">
      <section className="flex flex-col gap-4" aria-labelledby="buy-title">
        <div>
          <h1 id="buy-title" className="text-3xl font-semibold">
            Find something
          </h1>
          <p className="mt-1 text-ink-soft">Say what you want in your own words. Then give Barley a private ceiling and let him haggle.</p>
        </div>
        <Card className="flex flex-col gap-3 p-4">
          <Field label="What are you looking for?" htmlFor="want" hint="Item, budget, when, and where. Plain words are fine.">
            <textarea id="want" value={text} onChange={(e) => setText(e.target.value)} rows={3} className={`${inputClass} py-2`} maxLength={500} data-testid="want-text" />
          </Field>
          <Button onClick={find} busy={busy === "find"} disabled={text.trim().length < 4} size="lg" data-testid="find">
            Find it
          </Button>
          {res ? (
            <div className="rounded-xl border border-paper-3 bg-paper p-3 text-sm" data-testid="parsed-want">
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <span className="font-semibold">Barley understood:</span>
                <AiTag tag={res.want.parsed.ai} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Pill tone="spring">{res.want.parsed.category}</Pill>
                <Pill>{res.want.parsed.when}</Pill>
                <Pill>{res.want.parsed.area}</Pill>
                {res.mentionedCeilingCents ? <Pill tone="yuzu">budget {formatUsd(res.mentionedCeilingCents)}</Pill> : null}
              </div>
            </div>
          ) : null}
        </Card>
        <ErrorNote error={error} />
      </section>

      <section className="flex min-w-0 flex-col gap-4" aria-live="polite">
        {!res && !listing ? (
          <Card className="flex min-h-[380px] flex-col items-center justify-center gap-3 p-8 text-center">
            <Barley mood={busy === "find" ? "thinking" : "idle"} size={170} />
            <p className="max-w-sm text-ink-soft">{busy === "find" ? "Barley is reading your request and checking the shelf." : "Barley will read your request, find matching listings and wait for your ceiling."}</p>
          </Card>
        ) : null}

        {res && !listing ? (
          <Card className="p-4">
            <h2 className="text-lg font-semibold">{res.matches.length ? "Matches on the shelf" : "Nothing on the shelf matches yet"}</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {res.matches.map(({ listing: l }) => (
                <li key={l.id}>
                  <button type="button" onClick={() => choose(l, res.mentionedCeilingCents)} className="flex w-full items-center gap-3 rounded-xl border border-paper-3 bg-white p-2 text-left hover:border-spring">
                    <ListingPhoto listing={l} className="h-16 w-20 rounded-lg" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{l.title}</span>
                      <span className="text-sm text-ink-soft">
                        {formatUsd(l.askingCents)}, {l.conditionGrade}, {l.area}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {listing ? (
          <>
            <Card className="overflow-hidden" data-testid="chosen-listing">
              <div className="grid sm:grid-cols-[260px_1fr]">
                <ListingPhoto listing={listing} className="h-52 w-full sm:h-full" />
                <div className="flex flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-xl font-semibold">{listing.title}</h2>
                    <p className="font-display text-2xl font-semibold">{formatUsd(listing.askingCents)}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <ListingStatus status={listing.status} />
                    <Pill>{listing.conditionGrade}</Pill>
                    <Pill>{listing.area}</Pill>
                    <AiTag tag={listing.ai} />
                  </div>
                  <p className="text-sm text-ink-soft">{listing.description}</p>
                  <ListingFacts listing={listing} />
                  {listing.photoCredit ? <p className="text-xs text-ink-soft">{listing.photoCredit}</p> : null}
                </div>
              </div>
            </Card>

            <Card className="flex flex-col gap-3 p-4">
              <h2 className="text-lg font-semibold">Give Barley his mandate</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Your ceiling (private)"
                  htmlFor="ceiling"
                  hint={
                    <span className="flex items-center gap-1">
                      <LockIcon className="h-3 w-3" /> Only Barley sees this. The seller and Biscuit never do.
                    </span>
                  }
                >
                  <input id="ceiling" inputMode="numeric" value={ceiling} onChange={(e) => setCeiling(e.target.value.replace(/[^\d]/g, ""))} className={inputClass} data-testid="ceiling" />
                </Field>
                <fieldset>
                  <legend className="text-sm font-semibold">Pickup times you can make</legend>
                  <div className="mt-1 flex flex-col gap-1">
                    {listing.pickupWindows.map((w) => (
                      <label key={w.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-spring-deep"
                          checked={windows.includes(w.id)}
                          onChange={(e) => setWindows(e.target.checked ? [...windows, w.id] : windows.filter((x) => x !== w.id))}
                        />
                        {w.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
              <p className="text-sm text-ink-soft">
                Barley gets a signed mandate: this listing only, never above your ceiling, expiring in 72 hours. A referee in code checks every offer against it. You can watch, pause or jump in.
              </p>
              <Button size="lg" onClick={start} busy={busy === "start"} disabled={listing.status !== "active" || !ceiling || windows.length === 0} data-testid="start-haggle">
                Send Barley to haggle
              </Button>
              {listing.status !== "active" ? <p className="text-sm text-danger">This item is already reserved or sold.</p> : null}
            </Card>
          </>
        ) : null}
      </section>
    </div>
  );
}
