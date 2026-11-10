"use client";

import { formatUsd } from "@/lib/money";
import type { Listing } from "@/lib/types";
import { AiTag, cx, Pill } from "./ui";

export function ListingPhoto({ listing, className, index = 0 }: { listing: Pick<Listing, "photos" | "title">; className?: string; index?: number }) {
  const src = listing.photos[index] ?? listing.photos[0];
  if (!src) {
    return <div className={cx("flex items-center justify-center bg-paper-2 text-sm text-ink-soft", className)}>No photo</div>;
  }
  // Demo photos are small local files and user photos are data URLs, so a plain img is right here.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={`Photo of ${listing.title}`} className={cx("object-cover", className)} loading="lazy" />;
}

export function ListingStatus({ status }: { status: Listing["status"] }) {
  if (status === "active") return <Pill tone="spring">Available</Pill>;
  if (status === "reserved") return <Pill tone="pay">Reserved, held by PayPal</Pill>;
  return <Pill tone="neutral">Sold</Pill>;
}

/** Public facts of a listing. Measurements read from a photo carry an "estimate" chip. */
export function ListingFacts({ listing, compact }: { listing: Listing; compact?: boolean }) {
  const groups: { label: string; kinds: string[] }[] = [
    { label: "Condition", kinds: ["condition"] },
    { label: "Visible wear", kinds: ["flaw"] },
    { label: "Measurements", kinds: ["measurement"] },
    { label: "Features", kinds: ["feature", "included"] },
  ];
  return (
    <div className={cx("grid gap-3", compact ? "" : "sm:grid-cols-2")}>
      {groups.map((g) => {
        const facts = listing.facts.filter((f) => g.kinds.includes(f.kind));
        if (facts.length === 0) return null;
        return (
          <div key={g.label}>
            <h4 className="font-sans text-xs font-bold uppercase tracking-wide text-ink-soft">{g.label}</h4>
            <ul className="mt-1 flex flex-col gap-1 text-sm">
              {facts.map((f) => (
                <li key={f.id} className="flex flex-wrap items-baseline gap-1.5">
                  <span>{f.text}</span>
                  {f.estimate ? <Pill tone="warn">estimate from photo</Pill> : null}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export function ListingCard({ listing, action }: { listing: Listing; action?: React.ReactNode }) {
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-paper-3 bg-white" data-testid={`listing-${listing.id}`}>
      <ListingPhoto listing={listing} className="aspect-[4/3] w-full" />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold leading-tight">{listing.title}</h3>
          <p className="shrink-0 font-display text-xl font-semibold text-ink">{formatUsd(listing.askingCents)}</p>
        </div>
        <p className="line-clamp-2 text-sm text-ink-soft">{listing.description}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <ListingStatus status={listing.status} />
          <Pill>{listing.conditionGrade}</Pill>
          <Pill>{listing.area}</Pill>
          <AiTag tag={listing.ai} />
        </div>
        {listing.suggestion ? (
          <p className="text-xs text-ink-soft">
            AI price estimate: {formatUsd(listing.suggestion.lowCents)} to {formatUsd(listing.suggestion.highCents)}. An estimate, not an appraisal.
          </p>
        ) : null}
        {action ? <div className="mt-auto pt-2">{action}</div> : null}
      </div>
    </article>
  );
}
