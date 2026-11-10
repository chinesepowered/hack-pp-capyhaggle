"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatUsdExact } from "@/lib/money";
import type { DealView } from "@/lib/views";
import type { PayPalOneTimePaymentSession } from "@/types/paypal-v6";
import { api, ApiError } from "../app-context";
import { Button, ErrorNote, Spinner } from "../ui";

const SDK_URL = "https://www.sandbox.paypal.com/web-sdk/v6/core";

let sdkLoading: Promise<void> | undefined;

function loadSdk(): Promise<void> {
  if (typeof window !== "undefined" && window.paypal) return Promise.resolve();
  if (!sdkLoading) {
    sdkLoading = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SDK_URL;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        sdkLoading = undefined;
        reject(new Error("The PayPal JS SDK could not be loaded."));
      };
      document.head.appendChild(script);
    });
  }
  return sdkLoading;
}

interface Props {
  deal: DealView;
  onDeal: (deal: DealView) => void;
}

/**
 * The buyer's approval, with PayPal JS SDK v6: createInstance, findEligibleMethods, a
 * <paypal-button> web component, and a one-time payment session started with the order that Barley
 * already created on the server (intent AUTHORIZE). On approval the server authorizes the order,
 * which places the hold.
 */
export function PayPalHold({ deal, onDeal }: Props) {
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? "";
  const orderId = deal.payment.orderId!;
  const [state, setState] = useState<"loading" | "ready" | "approving" | "authorizing" | "ineligible" | "failed">("loading");
  const [error, setError] = useState<{ message: string; debugId?: string } | null>(null);
  const sessionRef = useRef<PayPalOneTimePaymentSession | null>(null);
  const dealId = deal.id;

  const report = useCallback(
    (step: string, detail?: string) => {
      void api(`/api/deals/${dealId}/sdk-event`, { body: { as: "buyer", step, detail } }).catch(() => undefined);
    },
    [dealId],
  );

  const authorize = useCallback(async () => {
    setState("authorizing");
    try {
      const res = await api<{ deal: DealView }>(`/api/deals/${dealId}/authorize`, { body: { as: "buyer" } });
      onDeal(res.deal);
    } catch (e) {
      setError(e instanceof ApiError ? { message: e.message, debugId: e.debugId } : { message: "The hold could not be placed." });
      setState("ready");
    }
  }, [dealId, onDeal]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!clientId) throw new Error("NEXT_PUBLIC_PAYPAL_CLIENT_ID is not set.");
        await loadSdk();
        report("loaded");
        const instance = await window.paypal!.createInstance({ clientId, components: ["paypal-payments"], pageType: "checkout" });
        report("instance");
        const methods = await instance.findEligibleMethods({ currencyCode: "USD" });
        if (!alive) return;
        if (!methods.isEligible("paypal")) {
          setState("ineligible");
          return;
        }
        report("eligible");
        sessionRef.current = instance.createPayPalOneTimePaymentSession({
          onApprove: async () => {
            report("approved");
            await authorize();
          },
          onCancel: () => {
            report("cancelled");
            setState("ready");
          },
          onError: (err) => {
            report("error", err?.message);
            setError({ message: err?.message ?? "PayPal reported an error." });
            setState("ready");
          },
        });
        setState("ready");
      } catch (e) {
        if (!alive) return;
        setError({ message: e instanceof Error ? e.message : "The PayPal button could not be set up." });
        setState("failed");
      }
    })();
    return () => {
      alive = false;
    };
  }, [clientId, report, authorize]);

  async function start() {
    const session = sessionRef.current;
    if (!session) return;
    setError(null);
    setState("approving");
    report("started");
    try {
      // v6 expects a Promise of { orderId }. The order already exists, so it resolves at once.
      await session.start({ presentationMode: "auto" }, Promise.resolve({ orderId }));
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "PayPal's window could not be opened." });
      setState("ready");
    }
  }

  const amount = formatUsdExact(deal.agreed?.offer.priceCents ?? 0);

  return (
    <div className="flex flex-col gap-3" data-testid="paypal-hold">
      {state === "loading" ? (
        <p className="flex items-center gap-2 text-sm text-ink-soft" role="status">
          <Spinner /> Loading PayPal
        </p>
      ) : null}
      {state === "ready" || state === "approving" ? (
        <div className="flex flex-col gap-2">
          <paypal-button type="pay" class="paypal-gold" onClick={start} data-testid="paypal-button" style={{ width: "100%", maxWidth: 420 }} aria-label={`Pay with PayPal: hold ${amount}`}></paypal-button>
          <p className="text-xs text-ink-soft">
            PayPal opens in its own window. You approve a hold of {amount}; it is only captured when Theo scans your QR code at pickup.
          </p>
        </div>
      ) : null}
      {state === "approving" ? (
        <p className="flex items-center gap-2 text-sm text-ink-soft" role="status">
          <Spinner /> Waiting for your approval in PayPal&apos;s window
        </p>
      ) : null}
      {state === "authorizing" ? (
        <p className="flex items-center gap-2 text-sm font-semibold text-pay" role="status">
          <Spinner /> Approved. Asking PayPal to hold {amount}
        </p>
      ) : null}
      {state === "ineligible" ? <p className="text-sm text-ink-soft">PayPal is not available for this buyer and currency.</p> : null}
      {state === "failed" || state === "ineligible" ? (
        <Button variant="secondary" onClick={() => window.open(`https://www.sandbox.paypal.com/checkoutnow?token=${orderId}`, "_blank", "noopener")}>
          Open PayPal approval in a new tab
        </Button>
      ) : null}
      <ErrorNote error={error} />
    </div>
  );
}

/** Replay mode: no real order exists, so the approval step is shown as recorded, clearly labeled. */
export function ReplayApproval({ deal, onDeal }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string } | null>(null);
  const amount = formatUsdExact(deal.agreed?.offer.priceCents ?? 0);
  async function approve() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ deal: DealView }>(`/api/deals/${deal.id}/authorize`, { body: { as: "buyer" } });
      onDeal(res.deal);
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "Replay step failed." });
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[#f0d08a] bg-yuzu-soft p-3" data-testid="replay-approval">
      <p className="text-sm text-[#5a3e00]">
        <strong>Replay:</strong> in Live mode PayPal&apos;s own window opens here and the sandbox buyer approves a hold of {amount}. This recorded run already has that approval, so the next step replays
        PayPal&apos;s real answer to the authorize call.
      </p>
      <Button variant="secondary" onClick={approve} busy={busy} data-testid="replay-approve">
        Replay the buyer&apos;s approval
      </Button>
      <ErrorNote error={error} />
    </div>
  );
}
