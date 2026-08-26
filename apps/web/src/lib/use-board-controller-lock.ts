"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const HEARTBEAT_MS = 2_000;
const EXPIRES_MS = 7_000;

interface LockRecord { readonly controllerId: string; readonly expiresAt: number }
export type BoardLockState = "EIGEN" | "FREMD" | "WIRD_ÜBERNOMMEN";

export function useBoardControllerLock(matchId: string): { readonly state: BoardLockState; readonly takeOver: () => void } {
  const controllerId = useRef(crypto.randomUUID());
  const storageKey = `dart-ost:board-lock:${matchId}`;
  const [state, setState] = useState<BoardLockState>("WIRD_ÜBERNOMMEN");

  const read = useCallback((): LockRecord | null => {
    const value = localStorage.getItem(storageKey);
    if (value === null) return null;
    try {
      const candidate = JSON.parse(value) as Partial<LockRecord>;
      return typeof candidate.controllerId === "string" && typeof candidate.expiresAt === "number"
        ? { controllerId: candidate.controllerId, expiresAt: candidate.expiresAt }
        : null;
    } catch { return null; }
  }, [storageKey]);

  const claim = useCallback((force = false) => {
    const current = read();
    if (!force && current !== null && current.controllerId !== controllerId.current && current.expiresAt > Date.now()) {
      setState("FREMD");
      return;
    }
    localStorage.setItem(storageKey, JSON.stringify({ controllerId: controllerId.current, expiresAt: Date.now() + EXPIRES_MS } satisfies LockRecord));
    setState("EIGEN");
  }, [read, storageKey]);

  useEffect(() => {
    const ownedControllerId = controllerId.current;
    claim();
    const heartbeat = window.setInterval(() => claim(), HEARTBEAT_MS);
    const onStorage = (event: StorageEvent) => { if (event.key === storageKey) claim(); };
    window.addEventListener("storage", onStorage);
    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener("storage", onStorage);
      const current = read();
      if (current?.controllerId === ownedControllerId) localStorage.removeItem(storageKey);
    };
  }, [claim, read, storageKey]);

  return { state, takeOver: () => claim(true) };
}
