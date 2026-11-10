"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApp } from "./app-context";
import { BarleyAvatar, BiscuitAvatar } from "./mascots/Capy";
import { UnderTheHood } from "./UnderTheHood";
import { cx } from "./ui";

const NAV = [
  { href: "/", label: "Shelf" },
  { href: "/sell", label: "Sell" },
  { href: "/buy", label: "Buy" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { role, setRole, mode, setMode, setHoodOpen, hoodDeal, sound, setSound } = useApp();
  const pathname = usePathname();
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only-focusable absolute left-3 top-3 z-50 rounded-lg bg-ink px-3 py-2 text-sm font-semibold text-white">
        Skip to content
      </a>
      <header className="z-30 border-b border-paper-3 bg-paper/95 backdrop-blur sm:sticky sm:top-0">
        <div className="mx-auto flex max-w-[1360px] flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 sm:gap-x-4 sm:px-4 sm:py-2.5">
          <Link href="/" className="flex items-center gap-2 rounded-lg pr-1" aria-label="Capy vs Capy, home">
            <span className="flex -space-x-2" aria-hidden="true">
              <BarleyAvatar size={34} />
              <BiscuitAvatar size={34} />
            </span>
            <span className="font-display text-xl font-semibold leading-none text-ink">
              Capy <span className="text-spring-deep">vs</span> Capy
            </span>
          </Link>

          <nav aria-label="Main" className="order-3 flex items-center gap-1 sm:order-none">
            {NAV.map((n) => {
              const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={cx("rounded-lg px-3 py-2 text-sm font-semibold", active ? "bg-ink text-white" : "text-ink hover:bg-paper-2")}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>

          <div className="order-4 ml-auto flex items-center gap-1.5 sm:order-none sm:ml-auto sm:gap-2">
            <fieldset className="flex items-center rounded-xl border border-paper-3 bg-white p-0.5">
              <legend className="sr-only">Who you are viewing as</legend>
              {(["buyer", "seller"] as const).map((r) => (
                <label
                  key={r}
                  className={cx(
                    "flex cursor-pointer items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-sm font-semibold has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-pay",
                    role === r ? (r === "buyer" ? "bg-barley-soft text-spring-deep" : "bg-biscuit-soft text-[#7a3d12]") : "text-ink-soft",
                  )}
                >
                  <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} className="sr-only" data-testid={`role-${r}`} />
                  <span aria-hidden="true">{r === "buyer" ? <BarleyAvatar size={20} /> : <BiscuitAvatar size={20} />}</span>
                  {r === "buyer" ? "Maya" : "Theo"}
                  <span className="hidden font-normal sm:inline">{r === "buyer" ? "(buyer)" : "(seller)"}</span>
                </label>
              ))}
            </fieldset>

            <fieldset className="flex items-center rounded-xl border border-paper-3 bg-white p-0.5">
              <legend className="sr-only">Data mode</legend>
              {(["live", "replay"] as const).map((m) => (
                <label
                  key={m}
                  title={m === "live" ? "Live: real PayPal sandbox calls and real model calls" : "Replay: the same flow from recorded sandbox and AI responses"}
                  className={cx(
                    "cursor-pointer rounded-[10px] px-2.5 py-1.5 text-sm font-semibold has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-pay",
                    mode === m ? (m === "live" ? "bg-money-soft text-money" : "bg-yuzu-soft text-[#6b4a00]") : "text-ink-soft",
                  )}
                >
                  <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="sr-only" data-testid={`mode-${m}`} />
                  {m === "live" ? "Live" : "Replay"}
                </label>
              ))}
            </fieldset>
          </div>

          <div className="order-2 sm:ml-0 ml-auto flex items-center gap-1.5 sm:order-none sm:gap-2">
            <button
              type="button"
              onClick={() => setSound(!sound)}
              aria-pressed={sound}
              title="Barley and Biscuit speak a few short lines (pre-recorded audio)"
              data-testid="sound-toggle"
              className={cx("inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-2.5 text-sm font-semibold", sound ? "border-spring-deep bg-spring-mist text-spring-deep" : "border-paper-3 bg-white text-ink-soft")}
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
                <path d="M3 8v4h3l4 3V5L6 8H3Z" fill="currentColor" />
                {sound ? <path d="M13 7.5a3.5 3.5 0 0 1 0 5M15 5.5a6.5 6.5 0 0 1 0 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /> : <path d="m13 8 4 4m0-4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
              </svg>
              <span className="hidden sm:inline">Voices {sound ? "on" : "off"}</span>
              <span className="sr-only sm:hidden">Voices {sound ? "on" : "off"}</span>
            </button>

            <button
              type="button"
              onClick={() => setHoodOpen(true)}
              data-testid="open-hood"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-ink bg-ink px-3 text-sm font-semibold text-white hover:bg-[#3b2d22]"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
                <path d="M3 5h14M3 10h14M3 15h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
              </svg>
              <span className="hidden sm:inline">Under the hood</span>
              <span className="sm:hidden">Hood</span>
              {hoodDeal ? <span className="rounded-full bg-white/20 px-1.5 text-xs">{hoodDeal.calls.length}</span> : null}
            </button>
          </div>
        </div>
        {mode === "replay" ? (
          <div className="border-t border-[#f0d08a] bg-yuzu-soft px-4 py-1.5 text-center text-sm font-medium text-[#5a3e00]" role="status">
            Replay mode: new haggles run from a recorded real sandbox run. Nothing calls PayPal or a model. Switch to Live for the real thing.
          </div>
        ) : null}
      </header>
      <main id="main" className="mx-auto w-full max-w-[1360px] flex-1 px-4 pb-16 pt-5">
        {children}
      </main>
      <footer className="border-t border-paper-3 px-4 py-5 text-center text-xs text-ink-soft">
        Capy vs Capy is a hackathon demo on the PayPal sandbox. No real money moves. Maya, Theo and their listings are fictional.
      </footer>
      <UnderTheHood />
    </div>
  );
}
