"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { DealView } from "@/lib/views";
import type { Mode, Role } from "@/lib/types";

interface AppState {
  role: Role;
  setRole: (r: Role) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  /** The deal on screen, if any. Feeds the "Under the hood" drawer. */
  hoodDeal: DealView | null;
  setHoodDeal: (d: DealView | null) => void;
  hoodOpen: boolean;
  setHoodOpen: (open: boolean) => void;
  /** Mascot voice lines (pre-rendered audio). Off until the visitor turns it on. */
  sound: boolean;
  setSound: (on: boolean) => void;
  ready: boolean;
}

const Ctx = createContext<AppState | null>(null);

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const param = key === "cvc-role" ? "as" : key === "cvc-mode" ? "mode" : "sound";
  const fromUrl = new URLSearchParams(window.location.search).get(param);
  if (fromUrl && (allowed as readonly string[]).includes(fromUrl)) return fromUrl as T;
  try {
    const v = window.localStorage.getItem(key);
    if (v && (allowed as readonly string[]).includes(v)) return v as T;
  } catch {
    // Storage can be unavailable (private mode). The defaults are fine.
  }
  return fallback;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = useState<Role>("buyer");
  const [mode, setModeState] = useState<Mode>("live");
  const [hoodDeal, setHoodDeal] = useState<DealView | null>(null);
  const [hoodOpen, setHoodOpen] = useState(false);
  const [sound, setSoundState] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Read the stored choices after hydration so server and client markup match.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRoleState(readStored("cvc-role", ["buyer", "seller"] as const, "buyer"));
    setModeState(readStored("cvc-mode", ["live", "replay"] as const, "live"));
    setSoundState(readStored("cvc-sound", ["on", "off"] as const, "off") === "on");
    setReady(true);
  }, []);

  const setRole = useCallback((r: Role) => {
    setRoleState(r);
    try {
      window.localStorage.setItem("cvc-role", r);
    } catch {
      // ignore
    }
  }, []);
  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    try {
      window.localStorage.setItem("cvc-mode", m);
    } catch {
      // ignore
    }
  }, []);

  const setSound = useCallback((on: boolean) => {
    setSoundState(on);
    try {
      window.localStorage.setItem("cvc-sound", on ? "on" : "off");
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo(
    () => ({ role, setRole, mode, setMode, hoodDeal, setHoodDeal, hoodOpen, setHoodOpen, sound, setSound, ready }),
    [role, setRole, mode, setMode, hoodDeal, hoodOpen, sound, setSound, ready],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside AppProvider");
  return v;
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { code: string; message: string; debugId?: string } };
  if (!res.ok || data.error) {
    const e = data.error ?? { code: "HTTP_" + res.status, message: "Something went wrong." };
    throw new ApiError(e.code, e.message, res.status, e.debugId);
  }
  return data;
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public debugId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
