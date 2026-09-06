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
import {
  nextReplayable,
  queueBlocksControl,
  queueReadFailureMessage,
  queueUpdateFailureMessage,
  replayFailure,
  replayWithCurrentVersion,
  withCurrentExpectedVersion,
  type ReplayOutcome,
} from "@/lib/offline-replay";
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
  /** Meldung, wenn die lokale Warteschlange selbst nicht gelesen oder geaendert werden konnte. */
  readonly queueError: string | null;
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
  /**
   * Fehler der lokalen Warteschlange selbst (lesen, aendern) -- getrennt von
   * `error`, das aus den Mutationen kommt. Vorher hatte diese Klasse Fehler
   * hier gar keinen Kanal und brach still ab.
   */
  const [queueError, setQueueError] = useState<string | null>(null);
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
  /**
   * Liest die Warteschlange neu und macht ein Scheitern des Lesens sichtbar,
   * statt es an die Aufruferin weiterzuwerfen (dieselbe Form wie in
   * `command-centre.tsx`). Wirft nie.
   */
  const refreshQueue = useCallback(async (): Promise<void> => {
    try {
      setQueued(await listOfflineCommands(scope));
      setQueueError(null);
    } catch (error) {
      setQueueError(queueReadFailureMessage(error));
    }
  }, [scope]);
  // Der Rejection-Zweig ist Pflicht: ohne ihn entstand bei nicht verfuegbarer
  // oder blockierter IndexedDB eine unbehandelte Rejection, und die Flaeche
  // zeigte eine leere Warteschlange. Das ist hier schwerer als in der
  // Kommandozentrale: `queueBlocksControl` gaebe die Bedienung frei, obwohl
  // aeltere Aufnahmen noch ungesendet in IndexedDB liegen -- die neue Aufnahme
  // liefe an ihnen vorbei (AGENTS.md §18, PR-Agent-Runde 5, Durchsicht).
  useEffect(() => {
    let active = true;
    void listOfflineCommands(scope).then(
      (commands) => { if (active) setQueued(commands); },
      (error: unknown) => { if (active) setQueueError(queueReadFailureMessage(error)); },
    );
    return () => { active = false; };
  }, [scope]);

  const replay = useCallback(async () => {
    if (!navigator.onLine || replayingRef.current) return;
    replayingRef.current = true;
    setReplaying(true);
    // Zaehlt, wie viele Kommandos in diesem Durchgang tatsaechlich uebertragen
    // wurden -- der Effekt unten feuert `replay()` bei jeder Versionsaenderung
    // erneut (auch nach einer online abgesetzten Aufnahme, deren Mutation
    // `refresh()` schon selbst ausgeloest hat). Ohne diese Zaehlung invalidiert
    // das `finally` unten die fuenf Query-Gruppen ein zweites Mal, obwohl die
    // Warteschlange in diesem Durchgang leer war -- doppelte Refetch-Last auf
    // der gepollten Scoringflaeche fuer nichts (Re-Review-Befund F2, "doppelter
    // Refresh").
    let sentCount = 0;
    try {
      // Auch das Lesen kann scheitern. Vorher trug dieser Wurf durch das
      // `finally` hindurch nach draussen -- an `void replay()` im Effekt und
      // am Knopf "Jetzt uebertragen" wurde daraus eine unbehandelte Rejection
      // ohne jede Meldung (PR-Agent-Runde 5, Durchsicht).
      let commands: readonly OfflineCommand[];
      try {
        commands = await listOfflineCommands(scope);
      } catch (error) {
        setQueueError(queueReadFailureMessage(error));
        return;
      }
      setQueueError(null);
      // `nextReplayable` statt eines Filters: ein abgelehnter oder
      // konfliktbehafteter Kopf haelt die ganze Warteschlange an, bis jemand
      // entschieden hat. Ein Filter uebersprang ihn beim naechsten Auslauf und
      // setzte seinen Nachfolger in falscher Reihenfolge ab.
      //
      // `replayWithCurrentVersion` haelt die `expectedVersion` jeder Aufnahme
      // aktuell: die erste bekommt `match.version`, jede folgende die Version
      // aus der Antwort auf die vorherige. Vorher trug jede Aufnahme dieselbe,
      // beim Erfassen eingefrorene `match.version` in ihrer gespeicherten
      // Nutzlast -- nur die erste kam durch, alle folgenden konfligierten
      // sofort (PR-Agent-Befund F2 / Gesamtaudit C11, "Stale Versions").
      ({ sentCount } = await replayWithCurrentVersion(nextReplayable(commands), match.version, async (command, expectedVersion): Promise<ReplayOutcome> => {
        let result: MatchStateResponse;
        try {
          result = await apiRequest({
            path: command.path,
            method: "POST",
            body: withCurrentExpectedVersion(command.body, expectedVersion),
            schema: matchStateSchema,
          });
        } catch (error) {
          // Ein fachlich abgelehntes Kommando (4xx mit Fehlercode) wird als
          // solches markiert statt endlos wiederholt -- sonst bliebe es
          // dauerhaft `PENDING` und sperrte ueber `queueBlocksControl` die
          // ganze Flaeche (Befund F2). Die Wiedergabe bricht in jedem Fehlerfall
          // ab: die Reihenfolge der Aufnahmen ist verbindlich.
          const failure = replayFailure(error);
          // Das Markieren schreibt selbst nach IndexedDB und kann scheitern.
          // Ohne diesen `catch` verliess der Fehler die Wiedergabe als
          // unbehandelte Rejection, und die Person sah weder den Serverfehler
          // noch den Schreibfehler (PR-Agent-Runde 5, Durchsicht).
          try {
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
          } catch (markError) {
            setQueueError(queueUpdateFailureMessage(markError));
          }
          return { successful: false };
        }
        // Der Server hat das Kommando angenommen -- ab hier ist ein Fehler
        // rein lokal (IndexedDB) und kein Uebertragungsfehler mehr. Er darf
        // NICHT ueber `replayFailure` klassifiziert werden, sonst zeigte ein
        // laengst durchgegangenes Kommando ploetzlich CONFLICT oder REJECTED
        // (gleiches Muster wie `sendAssignment` in command-centre.tsx,
        // PR-Agent-Befund F2). Der Eintrag bleibt dann sichtbar PENDING; die
        // naechste Wiedergabe wiederholt ihn -- dank `commandId` idempotent.
        try {
          await removeOfflineCommand(command.commandId);
        } catch {
          return { successful: false };
        }
        return { successful: true, version: result.version };
      }));
    } finally {
      await refreshQueue();
      // Kein Refresh bei leerem Durchgang: sonst verdoppelt der Versions-
      // Effekt unten (Abhaengigkeit `match.version`) nach jeder online
      // gesendeten Aufnahme den Refetch-Sturm -- die Mutation hat den
      // Serverstand schon selbst invalidiert (`onSuccess` in `submit`/`undo`/
      // `abort`), und diese Wiedergabe findet danach eine leere Warteschlange
      // vor. Bei tatsaechlich gesendeten Kommandos bleibt der Refresh wie
      // gehabt bestehen.
      if (sentCount > 0) await refresh();
      setReplaying(false);
      replayingRef.current = false;
    }
  }, [scope, match.version, refresh, refreshQueue]);

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
    void (async () => {
      // Scheitert das Entfernen, bleibt der Eintrag stehen. Vorher endete die
      // Kette hier als unbehandelte Rejection, und die Person klickte auf einen
      // Knopf, der nichts tat und nichts sagte (PR-Agent-Runde 5, Durchsicht).
      try {
        await removeOfflineCommand(commandId);
      } catch (error) {
        setQueueError(queueUpdateFailureMessage(error));
        return;
      }
      await refreshQueue();
      await refresh();
      await replay();
    })();
  }, [refreshQueue, refresh, replay]);

  return {
    lock,
    queued,
    queueError,
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
