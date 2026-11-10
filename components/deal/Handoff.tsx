"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { formatUsdExact } from "@/lib/money";
import type { DealView } from "@/lib/views";
import { api, ApiError } from "../app-context";
import { Button, ErrorNote, inputClass, Pill, Spinner } from "../ui";

const QrScanner = dynamic(() => import("./QrScanner"), { ssr: false, loading: () => <p className="text-sm text-ink-soft">Loading the scanner</p> });

interface Qr {
  token: string;
  expiresAt: string;
  svg: string;
}

function useCountdown(expiresAt?: string): number {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!expiresAt) return;
    const update = () => setLeft(Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  return left;
}

/** Buyer side: the signed, single-use, expiring pickup code. */
export function BuyerQr({ deal }: { deal: DealView }) {
  const [qr, setQr] = useState<Qr | null>(null);
  const [error, setError] = useState<{ message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const left = useCountdown(qr?.expiresAt);
  const dealId = deal.id;

  const issue = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ qr: Qr }>(`/api/deals/${dealId}/qr`, { body: { as: "buyer" } });
      setQr(res.qr);
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "Could not create the pickup code." });
    } finally {
      setBusy(false);
    }
  }, [dealId]);

  const expired = qr !== null && left === 0;

  return (
    <div className="flex flex-col gap-3" data-testid="buyer-qr">
      <p className="text-sm text-ink-soft">
        At pickup, check the item, then show this code. When Theo scans it, PayPal captures the {formatUsdExact(deal.agreed?.offer.priceCents ?? 0)} hold. Until then, nothing is charged.
      </p>
      {qr && !expired ? (
        <div className="flex flex-col items-center gap-2">
          <div
            className="w-full max-w-[260px] rounded-2xl border-2 border-ink bg-white p-3"
            role="img"
            aria-label="Pickup QR code. Show it to the seller."
            data-testid="qr-image"
            // The SVG is generated on our own server from a signed token (no user input).
            dangerouslySetInnerHTML={{ __html: qr.svg }}
          />
          <p className="text-xs text-ink-soft" role="timer">
            Single use. Expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
          </p>
          <details className="w-full text-xs">
            <summary className="cursor-pointer font-semibold text-ink-soft">Show the code as text (for the paste fallback)</summary>
            <code className="mt-1 block break-all rounded-lg border border-paper-3 bg-paper p-2 font-mono text-[11px]" data-testid="qr-token">
              {qr.token}
            </code>
          </details>
          <Button variant="secondary" size="sm" onClick={issue} busy={busy}>
            New code
          </Button>
        </div>
      ) : (
        <Button onClick={issue} busy={busy} data-testid="show-qr">
          {expired ? "That code expired. Show a fresh one" : "I am at pickup: show my QR code"}
        </Button>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

/** Seller side: scan with the camera, paste the code, or (demo) simulate the scan. */
export function SellerScan({ deal, onDeal }: { deal: DealView; onDeal: (d: DealView) => void }) {
  const [tab, setTab] = useState<"camera" | "paste" | "simulate">("simulate");
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; debugId?: string } | null>(null);
  const dealId = deal.id;

  const submit = useCallback(
    async (token: string, via: "camera" | "paste" | "simulated") => {
      setBusy(via);
      setError(null);
      try {
        const res = await api<{ deal: DealView }>(`/api/deals/${dealId}/scan`, { body: { as: "seller", token, via } });
        onDeal(res.deal);
      } catch (e) {
        setError(e instanceof ApiError ? { message: e.message, debugId: e.debugId } : { message: "The scan did not go through." });
        setBusy(null);
      }
    },
    [dealId, onDeal],
  );

  async function simulate() {
    setBusy("simulated");
    setError(null);
    try {
      // On one screen there is no second phone, so the demo asks the buyer side for a fresh code and scans it.
      const res = await api<{ qr: Qr }>(`/api/deals/${dealId}/qr`, { body: { as: "buyer" } });
      await submit(res.qr.token, "simulated");
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "Could not simulate the scan." });
      setBusy(null);
    }
  }

  const tabs: { id: typeof tab; label: string }[] = [
    { id: "simulate", label: "Simulate scan" },
    { id: "camera", label: "Camera" },
    { id: "paste", label: "Paste code" },
  ];

  return (
    <div className="flex flex-col gap-3" data-testid="seller-scan">
      <p className="text-sm text-ink-soft">
        Hand over the item, then scan Maya&apos;s code. The scan captures the hold and pays you {formatUsdExact(deal.agreed?.sellerNetCents ?? 0)} at once.
      </p>
      <div role="tablist" aria-label="How to scan" className="flex rounded-xl border border-paper-3 bg-paper p-0.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-[10px] px-2 py-1.5 text-sm font-semibold ${tab === t.id ? "bg-white text-ink shadow-sm" : "text-ink-soft"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {busy ? (
        <p className="flex items-center gap-2 text-sm font-semibold text-pay" role="status">
          <Spinner /> Code accepted. Capturing the hold and paying you out
        </p>
      ) : tab === "camera" ? (
        <QrScanner onCode={(code) => submit(code, "camera")} onError={(message) => setError({ message })} />
      ) : tab === "paste" ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (pasted.trim()) void submit(pasted.trim(), "paste");
          }}
        >
          <label htmlFor="paste-code" className="text-sm font-semibold">
            Pickup code
          </label>
          <textarea id="paste-code" value={pasted} onChange={(e) => setPasted(e.target.value)} rows={3} className={`${inputClass} py-2 font-mono text-xs`} placeholder="CVC1...." data-testid="paste-code" />
          <Button type="submit" disabled={!pasted.trim()}>
            Verify code and release the money
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-2">
          <Button variant="money" size="lg" onClick={simulate} data-testid="simulate-scan">
            Simulate scanning Maya&apos;s QR code
          </Button>
          <p className="text-xs text-ink-soft">
            <Pill tone="warn">demo</Pill> For desktop and video. It requests a real signed code from the buyer side and submits it, so the same signature, expiry and single-use checks run.
          </p>
        </div>
      )}
      <ErrorNote error={error} />
    </div>
  );
}
