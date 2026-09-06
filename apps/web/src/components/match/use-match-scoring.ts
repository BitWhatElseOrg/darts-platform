"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  abortMatchResponseSchema, matchStateSchema, type Dart, type MatchStateResponse,
} from "@darts-platform/schemas";
import { apiRequest } from "@/lib/api-client";
import { ApiClientError } from "@/lib/api-error";
import { generateId } from "@/lib/id";
import {
  listOfflineCommands,
  markOfflineCommandConflict,
  markOfflineCommandRejected,
  removeOfflineCommand,
  removeOfflineCommandsForScope,
  saveOfflineCommand,
  type OfflineCommand,
} from "@/lib/offline-command-queue";
import { nextReplayable, queueBlocksControl, replayFailure } from "@/lib/offline-replay";
import { useBoardControllerLock } from "@/lib/use-board-controller-lock";

/**
 * Scoringzustand einer Match-Fläche: Board-Steuerung, Offline-Queue und die
 * drei Server-Mutationen (Visit, Undo, Abbruch). Reiner Eingabezustand der
 * Fläche — Punkte-Eingabefeld, offene Dialoge — bleibt bewusst in der
 * Komponente, die diesen Hook aufruft.
 *
 * `submitError`, `abortError`, `resetAbort`, `submitSucceededAt` und
 * `abortSucceededAt` gehen über den Plan hinaus: Die Komponente zeigt den
 * Checkout- und den Abbruch-Dialog jeweils mit dem Fehler der EIGENEN
 * Mutation, nicht mit dem gemeinsamen `error` (sonst könnte ein alter
 * Undo-Fehler im Checkout-Dialog auftauchen), und muss ihren Eingabezustand
 * genau dann zurücksetzen, wenn submit bzw. abort tatsächlich erfolgreich
 * war — mit der reinen Rückgabeschnittstelle sonst nicht unterscheidbar von
 * „noch nicht versucht".
 */
export interface MatchScoring {
  readonly lock: ReturnType<typeof useBoardControllerLock>;
  readonly queued: readonly OfflineCommand[];
  readonly online: boolean;
  readonly replaying: boolean;
  readonly mayControl: boolean;
  readonly error: unknown;
  readonly submitError: unknown;
  readonly abortError: unknown;
  readonly submitPending: boolean;
  readonly undoPending: boolean;
  readonly abortPending: boolean;
  readonly submitSucceededAt: number;
  readonly abortSucceededAt: number;
  readonly submitVisit: (visit: {
    readonly points: number;
    readonly dartsThrown: 1 | 2 | 3;
    readonly checkoutDouble?: number;
    readonly checkoutSegment?: Dart;
    readonly checkoutMissed?: boolean;
    readonly checkoutAttempted?: boolean;
    readonly darts?: readonly Dart[];
  }) => void;
  readonly undoVisit: () => void;
  readonly abortMatch: (reason: string) => void;
  readonly resetSubmit: () => void;
  readonly resetAbort: () => void;
  readonly replay: () => void;
  readonly discardQueued: (commandId: string) => void;
}

export function useMatchScoring({ organizationId, match, canScore }: {
  readonly organizationId: string;
  readonly match: MatchStateResponse;
  readonly canScore: boolean;
}): MatchScoring {
  const queryClient = useQueryClient();
  const lock = useBoardControllerLock(organizationId, match.id, canScore && match.status === "IN_PROGRESS");
  const [queued, setQueued] = useState<readonly OfflineCommand[]>([]);
  const [replaying, setReplaying] = useState(false);
  const replayingRef = useRef(false);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [submitSucceededAt, setSubmitSucceededAt] = useState(0);
  const [abortSucceededAt, setAbortSucceededAt] = useState(0);
  const scope = `match:${organizationId}:${match.id}`;
  const refresh = useCallback(async () => { await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["matches", organizationId] }),
    queryClient.invalidateQueries({ queryKey: ["match", organizationId, match.id] }),
    queryClient.invalidateQueries({ queryKey: ["boards", organizationId] }),
    queryClient.invalidateQueries({ queryKey: ["tournament-dashboard", organizationId] }),
    queryClient.invalidateQueries({ queryKey: ["tournaments", organizationId] }),
  ]); }, [organizationId, queryClient, match.id]);
  const refreshQueue = useCallback(async () => setQueued(await listOfflineCommands(scope)), [scope]);
  useEffect(() => {
    let active = true;
    void listOfflineCommands(scope).then((commands) => { if (active) setQueued(commands); });
    return () => { active = false; };
  }, [scope]);

  const replay = useCallback(async () => {
    if (!navigator.onLine || replayingRef.current) return;
    replayingRef.current = true;
    setReplaying(true);
    const commands = await listOfflineCommands(scope);
    // `nextReplayable` statt eines Filters: ein abgelehnter oder
    // konfliktbehafteter Kopf haelt die ganze Warteschlange an, bis jemand
    // entschieden hat. Ein Filter uebersprang ihn beim naechsten Auslauf und
    // setzte seinen Nachfolger in falscher Reihenfolge ab.
    for (const command of nextReplayable(commands)) {
      try {
        await apiRequest({ path: command.path, method: "POST", body: command.body, schema: matchStateSchema });
        await removeOfflineCommand(command.commandId);
      } catch (error) {
        // Ein fachlich abgelehntes Kommando (4xx mit Fehlercode) wird als
        // solches markiert statt endlos wiederholt -- sonst bliebe es
        // dauerhaft `PENDING` und sperrte ueber `queueBlocksControl` die
        // ganze Flaeche (Befund F2). Die Wiedergabe bricht in jedem Fehlerfall
        // ab: die Reihenfolge der Aufnahmen ist verbindlich.
        const failure = replayFailure(error);
        switch (failure.kind) {
          case "CONFLICT":
            await markOfflineCommandConflict(command, failure.code, failure.message);
            break;
          case "REJECTED":
            await markOfflineCommandRejected(command, failure.code, failure.message);
            break;
          case "RETRY":
            break;
        }
        break;
      }
    }
    await refreshQueue();
    await refresh();
    setReplaying(false);
    replayingRef.current = false;
  }, [scope, refresh, refreshQueue]);

  useEffect(() => {
    const becameOnline = () => { setOnline(true); void replay(); };
    const becameOffline = () => setOnline(false);
    window.addEventListener("online", becameOnline);
    window.addEventListener("offline", becameOffline);
    if (navigator.onLine) void replay();
    return () => { window.removeEventListener("online", becameOnline); window.removeEventListener("offline", becameOffline); };
  }, [replay]);

  const submit = useMutation({
    networkMode: "always",
    mutationFn: async (visit: { readonly points: number; readonly dartsThrown: 1 | 2 | 3; readonly checkoutDouble?: number; readonly checkoutSegment?: Dart; readonly checkoutMissed?: boolean; readonly checkoutAttempted?: boolean; readonly darts?: readonly Dart[] }) => {
      const commandId = generateId();
      const path = `/organizations/${organizationId}/matches/${match.id}/visits`;
      const body = {
        commandId,
        expectedVersion: match.version,
        playerId: match.currentPlayerId,
        points: visit.points,
        dartsThrown: visit.dartsThrown,
        checkoutDouble: visit.checkoutDouble ?? null,
        // Der Bust-Knopf meldet ausdruecklich einen verpassten Checkout-Versuch
        // (`checkoutMissed`) -- das zaehlt fuer die Checkout-Quote genauso als
        // Versuch wie ein getroffenes Doppel. Ein Master-Out-Finish traegt sein
        // Feld als `checkoutSegment` (round-entry.ts, `checkoutCommandFields`)
        // und ebenfalls `checkoutAttempted` -- ohne das Feld wuerde die
        // Checkout-Quote den Versuch unterschlagen.
        checkoutAttempts:
          visit.checkoutAttempted === true || visit.checkoutDouble !== undefined || visit.checkoutSegment !== undefined || visit.checkoutMissed === true
            ? 1
            : 0,
        controllerId: lock.controllerId,
        ...(visit.darts === undefined ? {} : { darts: visit.darts }),
        ...(visit.checkoutSegment === undefined ? {} : { checkoutSegment: visit.checkoutSegment }),
        ...(visit.checkoutMissed === true ? { checkoutMissed: true } : {}),
      };
      if (!navigator.onLine) {
        await saveOfflineCommand({ commandId, scope, path, body, label: `${visit.points} Punkte`, createdAt: new Date().toISOString(), status: "PENDING", error: null });
        await refreshQueue();
        return null;
      }
      try {
        return await apiRequest({ path, method: "POST", body, schema: matchStateSchema });
      } catch (error) {
        if (!(error instanceof ApiClientError)) {
          await saveOfflineCommand({ commandId, scope, path, body, label: `${visit.points} Punkte`, createdAt: new Date().toISOString(), status: "PENDING", error: null });
          await refreshQueue();
          return null;
        }
        throw error;
      }
    },
    onSuccess: async (serverState) => {
      setSubmitSucceededAt((value) => value + 1);
      if (serverState !== null) await refresh();
    },
    onError: async (error) => { if (error instanceof ApiClientError && error.code === "MATCH_VERSION_CONFLICT") await refresh(); },
  });
  const undo = useMutation({
    mutationFn: () => apiRequest({ path: `/organizations/${organizationId}/matches/${match.id}/undo`, method: "POST", body: { commandId: generateId(), expectedVersion: match.version, controllerId: lock.controllerId }, schema: matchStateSchema }),
    onSuccess: refresh,
    onError: async (error) => { if (error instanceof ApiClientError && error.code === "MATCH_VERSION_CONFLICT") await refresh(); },
  });
  const abort = useMutation({
    mutationFn: (reason: string) => apiRequest({
      path: `/organizations/${organizationId}/matches/${match.id}/abort`,
      method: "POST",
      body: { commandId: generateId(), expectedVersion: match.version, controllerId: lock.controllerId, reason },
      schema: abortMatchResponseSchema,
    }),
    onSuccess: async () => {
      await removeOfflineCommandsForScope(scope);
      setQueued([]);
      setAbortSucceededAt((value) => value + 1);
      await refresh();
    },
    onError: async (abortError) => {
      if (abortError instanceof ApiClientError && abortError.code === "MATCH_VERSION_CONFLICT") await refresh();
    },
  });
  const error = submit.error ?? undo.error ?? abort.error;
  // Nur unuebertragene Kommandos sperren die Bedienung; ein abgelehntes bleibt
  // sichtbar, macht das Board aber nicht unbedienbar (offline-replay.ts).
  const mayControl = canScore && match.status === "IN_PROGRESS" && lock.state === "EIGEN" && !queueBlocksControl(queued);

  // Nach dem Verwerfen laeuft die Wiedergabe weiter: hinter einem abgelehnten
  // Kommando koennen weitere warten, die jetzt an der Reihe sind.
  const discardQueued = useCallback((commandId: string) => {
    void removeOfflineCommand(commandId).then(refreshQueue).then(refresh).then(replay);
  }, [refreshQueue, refresh, replay]);

  return {
    lock,
    queued,
    online,
    replaying,
    mayControl,
    error,
    submitError: submit.error,
    abortError: abort.error,
    submitPending: submit.isPending,
    undoPending: undo.isPending,
    abortPending: abort.isPending,
    submitSucceededAt,
    abortSucceededAt,
    submitVisit: (visit) => submit.mutate(visit),
    undoVisit: () => undo.mutate(),
    abortMatch: (reason) => abort.mutate(reason),
    resetSubmit: () => submit.reset(),
    resetAbort: () => abort.reset(),
    replay,
    discardQueued,
  };
}
