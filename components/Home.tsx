"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatUsd } from "@/lib/money";
import type { Listing, Want } from "@/lib/types";
import type { DealCard } from "@/lib/views";
import { api, ApiError, useApp } from "./app-context";
import { ListingCard, ListingPhoto } from "./ListingCard";
import { HotSpring } from "./mascots/HotSpring";
import { Button, Card, ErrorNote, Pill, statusLabel } from "./ui";

interface State {
  listings: Listing[];
  wants: Want[];
  wantCeilings: Record<string, number>;
  deals: DealCard[];
}

const STEPS = [
  { n: 1, title: "List", text: "Theo snaps photos. Vision AI writes the listing and suggests a price range. He sets a private floor." },
  { n: 2, title: "Want", text: "Maya says what she wants in plain words and sets a private ceiling." },
  { n: 3, title: "Haggle", text: "Barley and Biscuit negotiate in the open. A referee in code checks every offer against the signed mandates." },
  { n: 4, title: "Deal", text: "Both tap Accept. Maya approves with PayPal and the money is held, not sent." },
  { n: 5, title: "Handoff", text: "At pickup, Theo scans Maya's QR code. PayPal captures the hold and Theo is paid out in seconds." },
];

export function Home() {
  const router = useRouter();
  const { mode, setRole } = useApp();
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<{ message: string } | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let alive = true;
    api<State>("/api/state")
      .then((s) => alive && setState(s))
      .catch((e: Error) => alive && setError({ message: e.message }));
    return () => {
      alive = false;
    };
  }, []);

  const bike = state?.listings.find((l) => l.id === "lst_bike" && l.status === "active") ?? state?.listings.find((l) => l.status === "active");
  const want = state?.wants.find((w) => w.id === "want_bike") ?? state?.wants[0];

  async function watchHaggle() {
    setStarting(true);
    setError(null);
    try {
      const body =
        mode === "replay"
          ? { mode }
          : {
              mode,
              listingId: bike?.id,
              wantId: want?.id,
              ceilingCents: (want && state?.wantCeilings[want.id]) || Math.round(((bike?.askingCents ?? 9000) * 0.95) / 100) * 100,
              pickupWindowIds: bike?.pickupWindows.filter((w) => w.id !== "sat-pm").map((w) => w.id) ?? [],
            };
      const res = await api<{ id: string }>("/api/deals", { body });
      setRole("buyer");
      router.push(`/deal/${res.id}`);
    } catch (e) {
      setError({ message: e instanceof ApiError ? e.message : "Could not start the haggle." });
      setStarting(false);
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <section className="grid items-center gap-6 lg:grid-cols-[1.02fr_1fr]" aria-labelledby="hero-title">
        <div className="flex flex-col gap-4">
          <Pill tone="spring" className="self-start">
            Local secondhand deals, minus the awkward part
          </Pill>
          <h1 id="hero-title" className="text-4xl font-semibold leading-[1.05] sm:text-5xl">
            Two capybaras haggle.
            <br />
            <span className="text-spring-deep">PayPal holds the money.</span>
          </h1>
          <p className="max-w-xl text-lg text-ink-soft">
            Tell your capybara your limit in private. Barley and Biscuit negotiate in the open, you tap Accept, and PayPal holds the buyer&apos;s money until the seller scans a QR code at pickup. No
            no-shows, no fake payment screenshots, no &quot;send a deposit first&quot;.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button size="lg" onClick={watchHaggle} busy={starting} disabled={!state || (mode === "live" && !bike)} data-testid="watch-haggle">
              {mode === "replay" ? "Watch a recorded haggle" : "Watch a haggle"}
            </Button>
            <Link href="/sell" className="inline-flex min-h-12 items-center rounded-xl border border-paper-3 bg-white px-5 font-semibold hover:bg-paper-2">
              List something
            </Link>
            <Link href="/buy" className="inline-flex min-h-12 items-center rounded-xl border border-paper-3 bg-white px-5 font-semibold hover:bg-paper-2">
              Find something
            </Link>
          </div>
          {want && bike && mode === "live" ? (
            <p className="text-sm text-ink-soft">
              Demo: Maya wants &quot;{want.text}&quot; Theo is asking {formatUsd(bike.askingCents)} for his {bike.title.toLowerCase()}.
            </p>
          ) : null}
          <ErrorNote error={error} />
        </div>
        <div className="overflow-hidden rounded-3xl border border-paper-3 bg-white">
          <HotSpring phase="idle" barleyMood="happy" biscuitMood="talking" speaker="biscuit" className="block h-auto w-full" />
          <div className="flex items-center justify-between gap-3 border-t border-paper-3 px-4 py-2.5 text-sm">
            <span>
              <strong>Barley</strong> haggles for the buyer. Round glasses, a little frugal.
            </span>
            <span className="text-right">
              <strong>Biscuit</strong> haggles for the seller. Scarf, warm and chatty.
            </span>
          </div>
        </div>
      </section>

      <section aria-labelledby="how-title">
        <h2 id="how-title" className="mb-3 text-2xl font-semibold">
          How it works
        </h2>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {STEPS.map((s) => (
            <li key={s.n} className="rounded-2xl border border-paper-3 bg-white p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-spring-deep font-display text-sm font-semibold text-white" aria-hidden="true">
                  {s.n}
                </span>
                <h3 className="text-lg font-semibold">{s.title}</h3>
              </div>
              <p className="mt-2 text-sm text-ink-soft">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="shelf-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <h2 id="shelf-title" className="text-2xl font-semibold">
            Theo&apos;s shelf
          </h2>
          <p className="text-sm text-ink-soft">Listings written by vision AI from the photos, edited by the seller.</p>
        </div>
        {!state && !error ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading listings">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-80 animate-pulse rounded-2xl border border-paper-3 bg-paper-2" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {state?.listings.map((l) => (
              <ListingCard
                key={l.id}
                listing={l}
                action={
                  l.status === "active" ? (
                    <Link
                      href={`/buy?listing=${l.id}`}
                      className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-spring-deep bg-spring-deep px-4 font-semibold text-white hover:bg-[#0f4342]"
                    >
                      Send Barley to haggle
                    </Link>
                  ) : null
                }
              />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="deals-title">
        <h2 id="deals-title" className="mb-3 text-2xl font-semibold">
          Deals
        </h2>
        {state && state.deals.length === 0 ? (
          <Card className="p-5 text-sm text-ink-soft">No deals yet. Press &quot;Watch a haggle&quot; and the capybaras will get into the hot spring.</Card>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {state?.deals.map((d) => {
              const s = statusLabel(d.status);
              return (
                <li key={d.id}>
                  <Link href={`/deal/${d.id}`} className="flex items-center gap-3 rounded-2xl border border-paper-3 bg-white p-3 hover:border-spring" data-testid={`deal-card-${d.id}`}>
                    <ListingPhoto listing={{ photos: d.photo ? [d.photo] : [], title: d.listingTitle }} className="h-16 w-16 shrink-0 rounded-xl" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{d.listingTitle}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Pill tone={s.tone}>{s.label}</Pill>
                        {d.priceCents ? <span className="font-display font-semibold">{formatUsd(d.priceCents)}</span> : null}
                        {d.seeded ? <Pill>seeded in the sandbox</Pill> : null}
                        {d.mode === "replay" ? <Pill tone="yuzu">replay</Pill> : null}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
