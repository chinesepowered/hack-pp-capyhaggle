"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { AiTag as AiTagData } from "@/lib/types";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "money";
  size?: "sm" | "md" | "lg";
  busy?: boolean;
};

const VARIANT: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-spring-deep text-white hover:bg-[#0f4342] border-spring-deep",
  secondary: "bg-white text-ink hover:bg-paper-2 border-paper-3",
  ghost: "bg-transparent text-ink hover:bg-paper-2 border-transparent",
  danger: "bg-white text-danger hover:bg-danger-soft border-danger",
  money: "bg-money text-white hover:bg-[#0a4630] border-money",
};
const SIZE: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "min-h-9 px-3 text-sm",
  md: "min-h-11 px-4 text-[15px]",
  lg: "min-h-12 px-5 text-base",
};

export function Button({ variant = "primary", size = "md", busy, disabled, className, children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl border font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
    >
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("h-4 w-4 animate-spin", className)} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Card({
  children,
  className,
  as: Tag = "div",
  ...rest
}: { children: ReactNode; className?: string; as?: "div" | "section" | "article" | "li"; "data-testid"?: string; "aria-busy"?: boolean }) {
  return (
    <Tag {...rest} className={cx("rounded-2xl border border-paper-3 bg-white shadow-[0_1px_0_rgba(42,31,23,0.04)]", className)}>
      {children}
    </Tag>
  );
}

export function Pill({ children, tone = "neutral", className, title }: { children: ReactNode; tone?: "neutral" | "spring" | "money" | "warn" | "danger" | "pay" | "yuzu"; className?: string; title?: string }) {
  const tones = {
    neutral: "bg-paper-2 text-ink-soft border-paper-3",
    spring: "bg-spring-mist text-spring-deep border-spring-light",
    money: "bg-money-soft text-money border-[#b9dfc9]",
    warn: "bg-warn-soft text-warn border-[#efd591]",
    danger: "bg-danger-soft text-danger border-[#efbdb7]",
    pay: "bg-pay-soft text-pay border-[#bcd2f5]",
    yuzu: "bg-yuzu-soft text-[#6b4a00] border-[#f0d08a]",
  } as const;
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold", tones[tone], className)}>
      {children}
    </span>
  );
}

function shortModel(model: string): string {
  return model.includes("/") ? model.split("/").pop()! : model;
}

/** The small "AI" tag that sits on every AI-produced output and names the model. */
export function AiTag({ tag, className }: { tag?: AiTagData; className?: string }) {
  if (!tag) return null;
  if (tag.scripted && tag.model === "scripted") {
    return (
      <Pill tone="neutral" className={className} title={`${tag.purpose}. No model answered, so this was written by code.`}>
        Scripted, no AI
      </Pill>
    );
  }
  const notes = [tag.purpose, tag.fallback ? "The primary model failed, so the fallback model answered." : "", tag.scripted ? "The model's moves were refused, so code played a rule-abiding move." : "", tag.replayed ? "Recorded from a real run." : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <span
      title={notes}
      data-testid="ai-tag"
      className={cx("inline-flex items-center gap-1 rounded-md border border-[#cfc3ee] bg-[#f3effc] px-1.5 py-0.5 text-[11px] font-semibold leading-none text-[#4a3192]", className)}
    >
      <span className="rounded-sm bg-[#4a3192] px-1 py-px text-[10px] font-bold tracking-wide text-white">AI</span>
      <span>{shortModel(tag.model)}</span>
      {tag.fallback ? <span className="font-normal">fallback</span> : null}
      {tag.scripted ? <span className="font-normal">scripted move</span> : null}
      {tag.replayed ? <span className="font-normal">recorded</span> : null}
    </span>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-semibold text-ink">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-ink-soft">{hint}</p> : null}
    </div>
  );
}

export const inputClass =
  "min-h-11 w-full rounded-xl border border-[#b9a98e] bg-white px-3 text-[15px] text-ink placeholder:text-[#8a7a68] focus:border-pay";

export function ErrorNote({ error, className }: { error?: { message: string; debugId?: string } | null; className?: string }) {
  if (!error) return null;
  return (
    <div role="alert" className={cx("rounded-xl border border-[#efbdb7] bg-danger-soft px-3 py-2 text-sm text-danger", className)}>
      {error.message}
      {error.debugId ? <span className="ml-1 font-mono text-xs">(PayPal-Debug-Id {error.debugId})</span> : null}
    </div>
  );
}

export function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={cx("h-4 w-4", className)} aria-hidden="true">
      <rect x="4" y="9" width="12" height="8" rx="2" fill="currentColor" />
      <path d="M7 9V6.5a3 3 0 0 1 6 0V9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function statusLabel(status: string): { label: string; tone: "neutral" | "spring" | "money" | "warn" | "danger" | "pay" } {
  switch (status) {
    case "negotiating":
      return { label: "Haggling", tone: "spring" };
    case "agreed":
      return { label: "Deal reached", tone: "warn" };
    case "awaiting_payment":
      return { label: "Waiting for PayPal approval", tone: "pay" };
    case "held":
      return { label: "Held by PayPal", tone: "pay" };
    case "completed":
      return { label: "Paid out", tone: "money" };
    case "voided":
      return { label: "Hold released", tone: "neutral" };
    case "refunded":
      return { label: "Refunded", tone: "neutral" };
    case "walked":
      return { label: "No deal", tone: "neutral" };
    case "expired":
      return { label: "No deal (round limit)", tone: "neutral" };
    default:
      return { label: status, tone: "neutral" };
  }
}
