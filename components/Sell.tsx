"use client";

import Link from "next/link";
import { useState } from "react";
import { formatUsd } from "@/lib/money";
import type { AiTag as AiTagData, FactKind, Listing, PickupWindow } from "@/lib/types";
import { api, ApiError, useApp } from "./app-context";
import { Biscuit } from "./mascots/Capy";
import { AiTag, Button, Card, ErrorNote, Field, inputClass, LockIcon, Pill } from "./ui";

const DEMO_SETS = [
  { key: "bike", label: "Kid's bike", photos: ["/items/bike-1.jpg", "/items/bike-2.jpg"], hint: "Bought new for $190 two summers ago and my kid outgrew it. Fits around age 5 to 7. The training wheels come off." },
  { key: "table", label: "Side table", photos: ["/items/table-1.jpg", "/items/table-2.jpg"], hint: "Teak side table, mid-century style, sturdy. Paid $160 for it at a vintage shop." },
  { key: "stroller", label: "Stroller", photos: ["/items/stroller-1.jpg"], hint: "Used for one kid, folds flat for the car. It cost $220 new." },
];

interface Fact {
  kind: FactKind;
  text: string;
  estimate?: boolean;
}

interface DraftResponse {
  draft: { title: string; category: string; description: string; conditionGrade: string; facts: (Fact & { id: string })[]; extras: { id: string; label: string }[]; ai: AiTagData };
  price: { lowCents: number; highCents: number; suggestedCents: number; basis: string; ai: AiTagData };
  photos: string[];
  hint: string;
}

const KIND_LABEL: Record<FactKind, string> = { condition: "Condition", flaw: "Visible wear", measurement: "Measurement", feature: "Feature", included: "Included" };

function upcomingWindows(): PickupWindow[] {
  // Mirrors lib/demo-data.ts for display; the server recomputes the real windows on publish.
  const now = new Date();
  const sat = new Date(now);
  sat.setHours(0, 0, 0, 0);
  const diff = (6 - sat.getDay() + 7) % 7;
  sat.setDate(sat.getDate() + (diff === 0 ? 7 : diff));
  const sun = new Date(sat);
  sun.setDate(sat.getDate() + 1);
  const day = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return [
    { id: "sat-am", label: `${day(sat)}, 10am to 12pm`, startsAt: "", endsAt: "" },
    { id: "sat-pm", label: `${day(sat)}, 2pm to 5pm`, startsAt: "", endsAt: "" },
    { id: "sun-mid", label: `${day(sun)}, 11am to 2pm`, startsAt: "", endsAt: "" },
  ];
}

async function resizeToDataUrl(file: File, max = 1024): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

export function Sell() {
  const { mode, setRole } = useApp();
  const [demoKey, setDemoKey] = useState<string | null>("bike");
  const [photos, setPhotos] = useState<string[]>(DEMO_SETS[0].photos);
  const [hint, setHint] = useState(DEMO_SETS[0].hint);
  const [busy, setBusy] = useState<"draft" | "publish" | null>(null);
  const [error, setError] = useState<{ message: string } | null>(null);
  const [res, setRes] = useState<DraftResponse | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [grade, setGrade] = useState("good");
  const [facts, setFacts] = useState<Fact[]>([]);
  const [extras, setExtras] = useState<string[]>([]);
  const [asking, setAsking] = useState("");
  const [floor, setFloor] = useState("");
  const [windows] = useState<PickupWindow[]>(upcomingWindows);
  const [chosen, setChosen] = useState<string[]>(["sat-am", "sat-pm", "sun-mid"]);
  const [bundlesOk, setBundlesOk] = useState(true);
  const [published, setPublished] = useState<Listing | null>(null);

  function pickDemo(key: string) {
    const set = DEMO_SETS.find((s) => s.key === key)!;
    setDemoKey(key);
    setPhotos(set.photos);
    setHint(set.hint);
    setRes(null);
    setPublished(null);
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    try {
      const urls = await Promise.all([...files].slice(0, 3).map((f) => resizeToDataUrl(f)));
      setDemoKey(null);
      setPhotos(urls);
      setHint("");
      setRes(null);
      setPublished(null);
    } catch {
      setError({ message: "Those photos could not be read. Try JPEG or PNG files." });
    }
  }

  async function writeListing() {
    setBusy("draft");
    setError(null);
    try {
      const r = await api<DraftResponse>("/api/listings/draft", { body: demoKey ? { demoKey, hint, mode } : { photos, hint, mode } });
      setRes(r);
      setTitle(r.draft.title);
      setDescription(r.draft.description);
      setGrade(r.draft.conditionGrade);
      setFacts(r.draft.facts.map(({ kind, text, estimate }) => ({ kind, text, estimate })));
      setExtras(r.draft.extras.map((e) => e.label));
      const suggested = Math.round(r.price.highCents / 100);
      setAsking(String(suggested));
      setFloor(String(Math.round((r.price.lowCents + r.price.suggestedCents) / 200)));
    } catch (e) {
      setError({ message: e instanceof ApiError ? e.message : "The listing could not be written." });
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    if (!res) return;
    setBusy("publish");
    setError(null);
    try {
      const r = await api<{ listing: Listing }>("/api/listings", {
        body: {
          title,
          category: res.draft.category,
          description,
          conditionGrade: grade,
          facts,
          extras: extras.map((label) => ({ label })),
          photos: res.photos,
          askingCents: Math.round(Number(asking)) * 100,
          floorCents: Math.round(Number(floor)) * 100,
          pickupWindowIds: chosen,
          bundlesOk,
          ai: res.draft.ai,
          suggestion: { lowCents: res.price.lowCents, highCents: res.price.highCents, basis: res.price.basis, ai: res.price.ai },
        },
      });
      setPublished(r.listing);
      setRole("seller");
    } catch (e) {
      setError({ message: e instanceof ApiError ? e.message : "The listing could not be published." });
    } finally {
      setBusy(null);
    }
  }

  if (published) {
    return (
      <Card className="mx-auto flex max-w-2xl flex-col items-center gap-3 p-8 text-center" data-testid="published">
        <Biscuit mood="happy" size={150} />
        <h1 className="text-3xl font-semibold">It&apos;s on the shelf</h1>
        <p className="text-ink-soft">
          &quot;{published.title}&quot; is listed at {formatUsd(published.askingCents)}. Biscuit holds your signed mandate: she will never go below your private floor of ${floor}, and no buyer or
          buyer&apos;s agent ever sees that number.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Link href="/" className="inline-flex min-h-11 items-center rounded-xl bg-spring-deep px-4 font-semibold text-white">
            See the shelf
          </Link>
          <Link href={`/buy?listing=${published.id}`} className="inline-flex min-h-11 items-center rounded-xl border border-paper-3 bg-white px-4 font-semibold">
            Switch sides: haggle for it as Maya
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[420px_minmax(0,1fr)]">
      <section className="flex flex-col gap-4" aria-labelledby="sell-title">
        <div>
          <h1 id="sell-title" className="text-3xl font-semibold">
            Sell something
          </h1>
          <p className="mt-1 text-ink-soft">Snap photos. The listing writes itself, and you set a private floor for Biscuit.</p>
        </div>

        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-lg font-semibold">1. Photos</h2>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Demo photo sets">
            {DEMO_SETS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => pickDemo(s.key)}
                aria-pressed={demoKey === s.key}
                data-testid={`demo-${s.key}`}
                className={`overflow-hidden rounded-xl border-2 text-left ${demoKey === s.key ? "border-spring-deep" : "border-paper-3"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.photos[0]} alt="" className="aspect-square w-full object-cover" />
                <span className="block px-2 py-1 text-xs font-semibold">{s.label}</span>
              </button>
            ))}
          </div>
          <div>
            <label htmlFor="photo-upload" className="text-sm font-semibold">
              Or use your own photos (up to 3)
            </label>
            <input
              id="photo-upload"
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              onChange={(e) => void onFiles(e.target.files)}
              className="mt-1 block w-full text-sm file:mr-3 file:min-h-10 file:rounded-lg file:border file:border-paper-3 file:bg-white file:px-3 file:font-semibold"
            />
            <p className="mt-1 text-xs text-ink-soft">Photos are resized in your browser and sent to the vision model only when you press the button below.</p>
          </div>
          {!demoKey && photos.length > 0 ? (
            <div className="flex gap-2">
              {photos.map((p, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={p} alt={`Your photo ${i + 1}`} className="h-20 w-20 rounded-lg object-cover" />
              ))}
            </div>
          ) : null}
          <Field label="A note for the listing (optional)" htmlFor="hint" hint="Anything a photo cannot show: age, what it cost, why you are selling.">
            <textarea id="hint" value={hint} onChange={(e) => setHint(e.target.value)} rows={2} className={`${inputClass} py-2`} maxLength={300} />
          </Field>
          <Button onClick={writeListing} busy={busy === "draft"} disabled={photos.length === 0} size="lg" data-testid="write-listing">
            {res ? "Write it again" : "Write my listing"}
          </Button>
          {mode === "replay" ? <p className="text-xs text-[#5a3e00]">Replay mode: the three demo sets use the recorded model output. Your own photos need Live mode.</p> : null}
        </Card>
        <ErrorNote error={error} />
      </section>

      <section className="flex min-w-0 flex-col gap-4" aria-live="polite" aria-busy={busy === "draft"}>
        {!res ? (
          <Card className="flex min-h-[420px] flex-col items-center justify-center gap-3 p-8 text-center">
            <Biscuit mood={busy === "draft" ? "thinking" : "idle"} size={170} />
            <p className="max-w-sm text-ink-soft">
              {busy === "draft" ? "Biscuit is looking closely at your photos: paint, rust, wheels, what comes with it." : "Pick photos and press the button. Biscuit drafts the title, the condition notes, estimated measurements and a price range."}
            </p>
          </Card>
        ) : (
          <>
            <Card className="flex flex-col gap-3 p-4" data-testid="draft">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">2. Your listing, drafted from the photos</h2>
                <AiTag tag={res.draft.ai} />
              </div>
              <div className="flex gap-2 overflow-x-auto">
                {res.photos.map((p, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={p} alt={`Listing photo ${i + 1}`} className="h-36 w-48 shrink-0 rounded-xl object-cover" />
                ))}
              </div>
              <Field label="Title" htmlFor="title">
                <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} maxLength={80} />
              </Field>
              <Field label="Description" htmlFor="description">
                <textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={`${inputClass} py-2`} maxLength={500} />
              </Field>
              <Field label="Condition" htmlFor="grade">
                <select id="grade" value={grade} onChange={(e) => setGrade(e.target.value)} className={inputClass}>
                  {["like new", "good", "fair", "needs work"].map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </Field>
              <div>
                <h3 className="font-sans text-sm font-semibold">Facts the agents may use</h3>
                <p className="text-xs text-ink-soft">Biscuit and the buyer&apos;s agent can only make claims that appear here. Remove anything that is wrong.</p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {facts.map((f, i) => (
                    <li key={i} className="flex items-center gap-2 rounded-lg border border-paper-3 bg-paper px-2 py-1.5 text-sm">
                      <Pill tone={f.kind === "flaw" ? "danger" : f.kind === "measurement" ? "warn" : "neutral"}>{KIND_LABEL[f.kind]}</Pill>
                      <span className="min-w-0 flex-1">{f.text}</span>
                      {f.estimate ? <Pill tone="warn">estimate</Pill> : null}
                      <button type="button" onClick={() => setFacts(facts.filter((_, j) => j !== i))} className="rounded-md px-1.5 text-ink-soft hover:bg-paper-2" aria-label={`Remove fact: ${f.text}`}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>

            <Card className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">3. Price and your private floor</h2>
                <AiTag tag={res.price.ai} />
              </div>
              <div className="rounded-xl border border-[#efd591] bg-warn-soft p-3 text-sm text-[#5a3e00]" data-testid="price-estimate">
                <p className="font-semibold">
                  Estimated range: {formatUsd(res.price.lowCents)} to {formatUsd(res.price.highCents)}
                </p>
                <p>{res.price.basis}</p>
                <p className="mt-1 text-xs">An AI estimate from the condition and typical used prices. Not an appraisal.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Asking price (public)" htmlFor="asking" hint="Shown on the listing. Whole dollars.">
                  <input id="asking" inputMode="numeric" value={asking} onChange={(e) => setAsking(e.target.value.replace(/[^\d]/g, ""))} className={inputClass} />
                </Field>
                <Field
                  label="Your floor (private)"
                  htmlFor="floor"
                  hint={
                    <span className="flex items-center gap-1">
                      <LockIcon className="h-3 w-3" /> Only Biscuit sees this. It goes into a signed mandate, never into the listing.
                    </span>
                  }
                >
                  <input id="floor" inputMode="numeric" value={floor} onChange={(e) => setFloor(e.target.value.replace(/[^\d]/g, ""))} className={inputClass} data-testid="floor" />
                </Field>
              </div>
              <fieldset>
                <legend className="text-sm font-semibold">Pickup windows</legend>
                <div className="mt-1 flex flex-col gap-1">
                  {windows.map((w) => (
                    <label key={w.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-spring-deep"
                        checked={chosen.includes(w.id)}
                        onChange={(e) => setChosen(e.target.checked ? [...chosen, w.id] : chosen.filter((c) => c !== w.id))}
                      />
                      {w.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div>
                <h3 className="font-sans text-sm font-semibold">Extras Biscuit may throw in</h3>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {extras.map((e, i) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded-full border border-[#f0d08a] bg-yuzu-soft px-2 py-0.5 text-xs font-semibold text-[#6b4a00]">
                      {e}
                      <button type="button" onClick={() => setExtras(extras.filter((_, j) => j !== i))} aria-label={`Remove extra: ${e}`} className="rounded-full px-1 hover:bg-white/60">
                        x
                      </button>
                    </span>
                  ))}
                  {extras.length === 0 ? <span className="text-xs text-ink-soft">None</span> : null}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-spring-deep" checked={bundlesOk} onChange={(e) => setBundlesOk(e.target.checked)} />
                Bundles are OK
              </label>
              <p className="flex items-center gap-2 text-sm">
                <Pill tone="pay">No cash</Pill> Payment is always the PayPal hold, released by the QR scan at pickup.
              </p>
              <Button size="lg" onClick={publish} busy={busy === "publish"} disabled={!title || !asking || !floor || chosen.length === 0} data-testid="publish">
                Sign Biscuit&apos;s mandate and publish
              </Button>
            </Card>
          </>
        )}
      </section>
    </div>
  );
}
