"use client";

import { boardControllerLeaseSchema } from "@darts-platform/schemas";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "./api-client";
import { generateId } from "./id";

const HEARTBEAT_MS = 3_000;
export type BoardLockState = "EIGEN" | "FREMD" | "WIRD_ÜBERNOMMEN";

export function useBoardControllerLock(organizationId: string, matchId: string, enabled: boolean): { readonly controllerId: string; readonly state: BoardLockState; readonly takeOver: () => void } {
  const [controllerId] = useState(() => generateId());
  const stateRef = useRef<BoardLockState>("WIRD_ÜBERNOMMEN");
  const [state, setState] = useState<BoardLockState>("WIRD_ÜBERNOMMEN");
  const updateState = useCallback((next: BoardLockState) => { stateRef.current = next; setState(next); }, []);

  const claim = useCallback(async (force = false) => {
    try {
      const lease = await apiRequest({
        path: `/organizations/${organizationId}/matches/${matchId}/controller-lease`,
        method: "POST",
        body: { controllerId, force },
        schema: boardControllerLeaseSchema,
      });
      updateState(lease.owned ? "EIGEN" : "FREMD");
    } catch {
      if (stateRef.current !== "EIGEN") updateState("WIRD_ÜBERNOMMEN");
    }
  }, [controllerId, matchId, organizationId, updateState]);

  useEffect(() => {
    if (!enabled) return undefined;
    const initialClaim = window.setTimeout(() => void claim(), 0);
    const heartbeat = window.setInterval(() => void claim(), HEARTBEAT_MS);
    return () => { window.clearTimeout(initialClaim); window.clearInterval(heartbeat); };
  }, [claim, enabled]);

  return { controllerId, state, takeOver: () => void claim(true) };
}
