"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  abortMatchResponseSchema, matchStateSchema, type Dart, type MatchStateResponse,
} from "@darts-platform/schemas";
import { apiRequest } from "@/lib/api-client";
import { ApiClientError, UserFacingError } from "@/lib/api-error";
import { generateId } from "@/lib/id";
import { saveOfflineCommand, type OfflineCommand } from "@/lib/offline-command-queue";
import {
  nextReplayable,
  queueBlocksControl,
  queueSaveFailureMessage,
  replayChained,
  replayFailure,
  withCurrentExpectedVersion,
  type ReplayOutcome,
} from "@/lib/offline-replay";
import { useBoardControllerLock } from "@/lib/use-board-controller-lock";
import { useOfflineQueue } from "@/lib/use-offline-queue";

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
  /** Meldung, wenn die lokale Warteschlange selbst nicht GELESEN werden konnte. */
  readonly queueReadError: string | null;
  /**
   * Meldung, wenn eine Aenderung an der lokalen Warteschlange nicht
   * geschrieben werden konnte. Getrennt vom Lesefehler: ein erfolgreiches
   * Lesen beweist nicht, dass die Aenderung angekommen ist, und darf die
   * Meldung deshalb nicht loeschen (siehe `use-offline-queue.ts`).
   */
  readonly queueWriteError: string | null;
  /**
   * Die `commandId`s der Aufnahmen, die der Server angenommen hat und die nur
   * lokal nicht aus der Warteschlange entfernt werden konnten. Eintragsbezogen
   * -- anders als `queueWriteError`, das fuer die ganze Flaeche gilt (siehe
   * `use-offline-queue.ts`).
   */
  readonly queueAcceptedButStuck: ReadonlySet<string>;
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
  /**
   * Die neueste Aufnahme aus der Serverantwort des letzten Absendens — nur
   * bei tatsaechlicher Serverbestaetigung gesetzt (`null` bleibt es fuer ein
   * offline in die Warteschlange gelegtes Kommando, dessen Ausgang noch
   * aussteht). Der Runden-Modus erkennt einen Bust bewusst nicht lokal
   * (round-entry.ts) und braucht diese Angabe, um ihn trotzdem anzuzeigen.
   */
  readonly lastSubmittedVisit: MatchStateResponse["visits"][number] | null;
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
  /**
   * Reglement 2.2.9: die ausgebullte Anwurfseite fuer das laufende Leg.
   * Reglement Anhang 2: die Seite, die das Leg an der Rundengrenze gewinnt.
   * Beide gehen wie `undoVisit` direkt an den Server, ohne Offline-Warte-
   * schlange: sie sind Entscheide am Board, die dem naechsten Wurf
   * vorausgehen — eine zwischengespeicherte Entscheidung waere beim
   * Uebertragen langst ueberholt.
   */
  readonly decideLegStart: (startingSeat: 1 | 2) => void;
  readonly decideLegByBull: (winnerSeat: 1 | 2) => void;
  readonly legDecisionError: unknown;
  readonly legDecisionPending: boolean;
  readonly resetLegDecision: () => void;
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
  const scope = `match:${organizationId}:${match.id}`;
  /**
   * Die lokale Warteschlange -- derselbe Hook wie in der Kommandozentrale.
   * Ihre beiden Fehlerkanaele sind getrennt von `error` aus den Mutationen:
   * ein Fehler der Warteschlange selbst ist kein Uebertragungsfehler.
   */
  const {
    queued,
    readError: queueReadError,
    writeError: queueWriteError,
    acceptedButStuck: queueAcceptedButStuck,
    readQueue,
    refreshQueue,
    markOutcome: markQueuedOutcome,
    remove: removeQueued,
    removeAccepted: removeAcceptedQueued,
    clearScope: clearQueuedScope,
  } = useOfflineQueue(scope);
  const [replaying, setReplaying] = useState(false);
  const replayingRef = useRef(false);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [submitSucceededAt, setSubmitSucceededAt] = useState(0);
  const [lastSubmittedVisit, setLastSubmittedVisit] = useState<MatchStateResponse["visits"][number] | null>(null);
  const [abortSucceededAt, setAbortSucceededAt] = useState(0);
  const refresh = useCallback(async () => { await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["matches", organizationId] }),
    queryClient.invalidateQueries({ queryKey: ["match", organizationId, match.id] }),
    queryClient.invalidateQueries({ queryKey: ["boards", organizationId] }),
    queryClient.invalidateQueries({ queryKey: ["tournament-dashboard", organizationId] }),
    queryClient.invalidateQueries({ queryKey: ["tournaments", organizationId] }),
  ]); }, [organizationId, queryClient, match.id]);

  const replay = useCallback(async () => {
    if (!navigator.onLine || replayingRef.current) return;
    replayingRef.current = true;
    setReplaying(true);
    // Zaehlt, wie viele Aufnahmen der Server in diesem Durchgang ANGENOMMEN
    // hat -- nicht, wie viele danach auch lokal aufgeraeumt werden konnten.
    // Beides zu koppeln war der Fehler: nahm der Server an und scheiterte das
    // lokale Entfernen, blieb der Zaehler auf 0, `refresh()` unten entfiel,
    // und weil `queueBlocksControl` einen angenommenen Eintrag nicht mehr
    // sperrt, lief die naechste Aufnahme gegen einen veralteten Match-Cache
    // und eine veraltete Version (Runde 8, Befund B).
    //
    // Bei einem leeren Durchgang bleibt er 0, und das `finally` invalidiert
    // die fuenf Query-Gruppen gar nicht erst -- ohne diese Zaehlung gab es
    // eine doppelte Refetch-Last auf der gepollten Scoringflaeche fuer nichts
    // (Re-Review-Befund F2, "doppelter Refresh").
    let acceptedCount = 0;
    // Ob das Lesen dieses Durchgangs geklappt hat. Scheitert es, darf das
    // `finally` unten nicht sofort erneut lesen: gelingt der zweite Versuch,
    // loescht er den gerade gesetzten `readError` im selben Tick -- "Jetzt
    // uebertragen" gedrueckt, nichts uebertragen, keine Meldung (Runde 7).
    let queueWasRead = false;
    try {
      // Auch das Lesen kann scheitern. Vorher trug dieser Wurf durch das
      // `finally` hindurch nach draussen -- an `void replay()` im Effekt und
      // am Knopf "Jetzt uebertragen" wurde daraus eine unbehandelte Rejection
      // ohne jede Meldung (PR-Agent-Runde 5, Durchsicht). `readQueue` faengt
      // ihn und meldet ihn als Lesefehler; `null` heisst: nicht gelesen.
      const commands = await readQueue();
      if (commands === null) return;
      queueWasRead = true;
      // `nextReplayable` statt eines Filters: ein abgelehnter oder
      // konfliktbehafteter Kopf haelt die ganze Warteschlange an, bis jemand
      // entschieden hat. Ein Filter uebersprang ihn beim naechsten Auslauf und
      // setzte seinen Nachfolger in falscher Reihenfolge ab.
      //
      // `replayChained` verkettet die `expectedVersion`: die erste Aufnahme
      // sendet die beim Erfassen gespeicherte Version -- den Serverstand, auf
      // dem sie fachlich beruht --, jede folgende die Version aus der Antwort
      // auf die vorherige. Vorher trug jede Aufnahme dieselbe eingefrorene
      // Version, und nur die erste kam durch (PR-Agent-Befund F2 /
      // Gesamtaudit C11, "Stale Versions"); danach bekam umgekehrt die erste
      // die aktuelle `match.version` untergeschoben und ging auch dann durch,
      // wenn inzwischen ein anderes Geraet gescort hatte -- die
      // Divergenzerkennung war fuer den Kopf ausgehebelt (Runde 8, Befund A).
      ({ acceptedCount } = await replayChained(nextReplayable(commands), async (command, chainedVersion): Promise<ReplayOutcome> => {
        let result: MatchStateResponse;
        try {
          result = await apiRequest({
            path: command.path,
            method: "POST",
            // Kopf (`chainedVersion === null`): gespeicherte Version
            // unveraendert. Nachfolger: die Version aus der Antwort auf den
            // Vorgaenger.
            body: chainedVersion === null ? command.body : withCurrentExpectedVersion(command.body, chainedVersion),
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
          // `markOutcome` faengt das und meldet es als Schreibfehler; ohne
          // diese Behandlung verliess der Fehler die Wiedergabe als
          // unbehandelte Rejection, und die Person sah weder den Serverfehler
          // noch den Schreibfehler (PR-Agent-Runde 5, Durchsicht).
          if (failure.kind !== "RETRY") await markQueuedOutcome(command, failure);
          return { successful: false, accepted: false };
        }
        // Der Server hat das Kommando angenommen -- ab hier ist ein Fehler
        // rein lokal (IndexedDB) und kein Uebertragungsfehler mehr. Er darf
        // NICHT ueber `replayFailure` klassifiziert werden, sonst zeigte ein
        // laengst durchgegangenes Kommando ploetzlich CONFLICT oder REJECTED
        // (gleiches Muster wie `sendAssignment` in command-centre.tsx,
        // PR-Agent-Befund F2). Der Eintrag bleibt dann sichtbar PENDING; die
        // naechste Wiedergabe wiederholt ihn -- dank `commandId` idempotent.
        //
        // Bis Runde 6 endete dieser Fall in einem leeren `catch`: keine
        // Meldung, der Eintrag blieb `PENDING`, `queueBlocksControl` sperrte
        // `mayControl` und die Scoringflaeche war dauerhaft unbedienbar, ohne
        // jede Erklaerung. `removeAccepted` traegt die passende Meldung
        // (`localCleanupFailureMessage`: der Server hat angenommen, nur das
        // Aufraeumen scheiterte) und stellt das Warteschlangen-Band den Weg
        // zum Verwerfen bereit (match-scoreboard.tsx).
        //
        // `accepted: true`: der Serverstand HAT sich bewegt. Nur so loest das
        // `finally` unten trotz des Abbruchs den `refresh()` aus (Runde 8,
        // Befund B).
        if (!(await removeAcceptedQueued(command.commandId))) return { successful: false, accepted: true };
        return { successful: true, version: result.version };
      }));
    } finally {
      if (queueWasRead) await refreshQueue();
      // Kein Refresh bei leerem Durchgang: die Mutationen invalidieren den
      // Serverstand schon selbst (`onSuccess` in `submit`/`undo`/`abort`), und
      // eine Wiedergabe ohne Warteschlange haette nichts nachzuladen.
      // Massgeblich ist die Annahme durch den Server, nicht das lokale
      // Aufraeumen -- sonst bleibt die Flaeche nach einem Aufraeumfehler auf
      // einem veralteten Stand stehen (Runde 8, Befund B).
      if (acceptedCount > 0) await refresh();
      setReplaying(false);
      replayingRef.current = false;
    }
    // `match.version` steht bewusst nicht mehr in den Abhaengigkeiten: die
    // Wiedergabe liest die Version nicht mehr, und der Effekt unten soll nicht
    // bei jeder Versionsaenderung erneut feuern.
  }, [markQueuedOutcome, readQueue, refresh, refreshQueue, removeAcceptedQueued]);

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
      // Bewusst `saveOfflineCommand` direkt statt `persist` aus dem Hook: hier
      // ist das Ablegen der EINZIGE Weg, auf dem die Aufnahme ueberlebt.
      // Scheitert es, muss die Mutation scheitern -- sonst meldete
      // `onSuccess` einen Erfolg, die Flaeche leerte das Ziffernfeld und die
      // Aufnahme waere weg. `persist` wuerde ihn nur nach `queueWriteError`
      // melden und die Mutation trotzdem gelingen lassen.
      //
      // Der Wurf traegt seine eigene Meldung: ein IndexedDB-Fehler ist ein
      // lokales Problem, und `userFacingErrorMessage` zeigte dafuer bis
      // Runde 7 "Die Anfrage ist fehlgeschlagen." -- eine Aussage ueber eine
      // Uebertragung, die nie stattgefunden hat. `UserFacingError` reicht den
      // formulierten Text durch, die Mutation scheitert unveraendert.
      const enqueue = async (): Promise<null> => {
        try {
          await saveOfflineCommand({ commandId, scope, path, body, label: `${visit.points} Punkte`, createdAt: new Date().toISOString(), status: "PENDING", error: null });
        } catch (saveError) {
          throw new UserFacingError(queueSaveFailureMessage(saveError, "Aufnahme"), { cause: saveError });
        }
        await refreshQueue();
        return null;
      };
      if (!navigator.onLine) return await enqueue();
      try {
        return await apiRequest({ path, method: "POST", body, schema: matchStateSchema });
      } catch (error) {
        if (!(error instanceof ApiClientError)) return await enqueue();
        throw error;
      }
    },
    onSuccess: async (serverState) => {
      setSubmitSucceededAt((value) => value + 1);
      // Immer neu setzen, auch auf `null`: ein offline in die Warteschlange
      // gelegtes Kommando hebt `submitSucceededAt` genauso an (PR-Agent-Befund
      // "Stale Bust") -- ohne dieses `else` bliebe die Bust-Anzeige einer
      // fruehen Aufnahme stehen und wuerde faelschlich fuer die naechste,
      // noch unbestaetigte Aufnahme erneut ausgeloest.
      setLastSubmittedVisit(serverState === null ? null : (serverState.visits[0] ?? null));
      if (serverState !== null) await refresh();
    },
    onError: async (error) => { if (error instanceof ApiClientError && error.code === "MATCH_VERSION_CONFLICT") await refresh(); },
  });
  const undo = useMutation({
    mutationFn: () => apiRequest({ path: `/organizations/${organizationId}/matches/${match.id}/undo`, method: "POST", body: { commandId: generateId(), expectedVersion: match.version, controllerId: lock.controllerId }, schema: matchStateSchema }),
    onSuccess: refresh,
    onError: async (error) => { if (error instanceof ApiClientError && error.code === "MATCH_VERSION_CONFLICT") await refresh(); },
  });
  const legDecision = useMutation({
    mutationFn: (decision:
      | { readonly kind: "LEG_START"; readonly startingSeat: 1 | 2 }
      | { readonly kind: "LEG_BY_BULL"; readonly winnerSeat: 1 | 2 }) =>
      apiRequest({
        path: `/organizations/${organizationId}/matches/${match.id}/${decision.kind === "LEG_START" ? "leg-start" : "leg-by-bull"}`,
        method: "POST",
        body: {
          commandId: generateId(),
          expectedVersion: match.version,
          controllerId: lock.controllerId,
          ...(decision.kind === "LEG_START"
            ? { legNumber: match.currentLegNumber, startingSeat: decision.startingSeat }
            : { winnerSeat: decision.winnerSeat }),
        },
        schema: matchStateSchema,
      }),
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
      // Der Abbruch ist serverseitig durch. Scheitert das Leeren der lokalen
      // Warteschlange, ist das ein Schreibfehler der Warteschlange und kein
      // gescheiterter Abbruch -- er darf den Abbruch-Dialog nicht in den
      // Fehlerzustand ziehen, sondern gehoert in `queueWriteError`.
      await clearQueuedScope();
      setAbortSucceededAt((value) => value + 1);
      await refresh();
    },
    onError: async (abortError) => {
      if (abortError instanceof ApiClientError && abortError.code === "MATCH_VERSION_CONFLICT") await refresh();
    },
  });
  const error = submit.error ?? undo.error ?? legDecision.error ?? abort.error;
  // Nur unuebertragene Kommandos sperren die Bedienung; ein abgelehntes bleibt
  // sichtbar, macht das Board aber nicht unbedienbar (offline-replay.ts).
  // Ebenso wenig sperrt eine Aufnahme, die der Server angenommen hat und die
  // nur lokal haengt: sie steht nicht mehr vor dem Serverstand. Ein
  // Lesefehler dagegen sperrt bedingungslos: er kann Eintraege verbergen, und
  // eine neue Aufnahme koennte an einer versteckten Offline-Aufnahme
  // vorbeilaufen (PR-Agent-Rueckmeldung Runde 9, "Unsafe Control").
  const mayControl = canScore && match.status === "IN_PROGRESS" && lock.state === "EIGEN" && !queueBlocksControl(queued, queueAcceptedButStuck, queueReadError);

  // Nach dem Verwerfen laeuft die Wiedergabe weiter: hinter einem abgelehnten
  // Kommando koennen weitere warten, die jetzt an der Reihe sind.
  const discardQueued = useCallback((commandId: string) => {
    void (async () => {
      // Scheitert das Entfernen, bleibt der Eintrag stehen und die Meldung
      // steht in `queueWriteError`. Vorher endete die Kette hier als
      // unbehandelte Rejection, und die Person klickte auf einen Knopf, der
      // nichts tat und nichts sagte (PR-Agent-Runde 5, Durchsicht).
      if (!(await removeQueued(commandId))) return;
      await refreshQueue();
      await refresh();
      await replay();
    })();
  }, [refreshQueue, refresh, removeQueued, replay]);

  return {
    lock,
    queued,
    queueReadError,
    queueWriteError,
    queueAcceptedButStuck,
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
    lastSubmittedVisit,
    submitVisit: (visit) => submit.mutate(visit),
    undoVisit: () => undo.mutate(),
    decideLegStart: (startingSeat) => legDecision.mutate({ kind: "LEG_START", startingSeat }),
    decideLegByBull: (winnerSeat) => legDecision.mutate({ kind: "LEG_BY_BULL", winnerSeat }),
    legDecisionError: legDecision.error,
    legDecisionPending: legDecision.isPending,
    resetLegDecision: () => legDecision.reset(),
    abortMatch: (reason) => abort.mutate(reason),
    resetSubmit: () => submit.reset(),
    resetAbort: () => abort.reset(),
    replay,
    discardQueued,
  };
}
