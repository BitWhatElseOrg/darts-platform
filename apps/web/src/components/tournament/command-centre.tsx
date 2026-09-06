"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  tournamentDashboardSchema,
  type BoardSlot,
  type TournamentDashboard,
} from "@darts-platform/schemas";
import { Control, MarkCross, Rule, SheetLabel, Wedge } from "@darts-platform/ui";
import { useCallback, useEffect, useMemo, useState } from "react";

import { NavLink, PageNav } from "@/components/page-nav";
import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";
import { ApiClientError } from "@/lib/api-error";
import { generateId } from "@/lib/id";
import { type OfflineCommand } from "@/lib/offline-command-queue";
import {
  nextReplayable,
  queueHidesEntries,
  queuedCommandNotice,
  replayAnnouncement,
  replayChained,
  replayFailure,
  type ReplayOutcome,
} from "@/lib/offline-replay";
import { useOfflineQueue } from "@/lib/use-offline-queue";
import { useOnlineFlush } from "@/lib/use-online-flush";
import {
  assignmentQueueEntries,
  assignmentRequestBody,
  tournamentQueueScope,
  unsentAssignments,
  type AssignmentQueueEntry,
} from "@/lib/tournament-assignment-queue";
import { connectTournamentRealtime, type RealtimeConnection } from "@/lib/realtime";
import { BoardWedge } from "./board-wedge";
import { DashboardHeader } from "./dashboard-header";
import { DisruptionsPanel } from "./disruptions-panel";
import { QueuePanel } from "./queue-panel";
import { ParticipantDisruptionPanel } from "./participant-disruption-panel";
import { ResultsPanel } from "./results-panel";
import { StandingsSheet } from "./standings-sheet";

/**
 * Eine noch nicht bestaetigte Board-Zuweisung. Sie lebt in derselben
 * IndexedDB-Warteschlange wie die Aufnahmen der Scoringflaeche und ueberlebt
 * damit ein Neuladen: vorher stand sie nur in `useState` und war nach einem
 * Reload ohne Verbindung still verschwunden (Befund K4).
 */
interface PendingCommand {
  readonly commandId: string;
  /**
   * Der Serverstand, den die Zentrale beim Erfassen zuletzt gesehen hat --
   * nie ein um wartende Kommandos hochgerechneter Wert (PR-Agent-Befund F2,
   * "Stale Versions"). `sendAssignment` bekommt die zu sendende
   * `expectedVersion` weiterhin separat uebergeben; die Wiedergabe reicht
   * dafuer beim KOPF der Kette genau diese gespeicherte Version durch und
   * kettet erst die Nachfolger aus den Serverantworten (Runde 8, Befund A,
   * siehe `replayChained`).
   */
  readonly expectedVersion: number;
  readonly matchId: string;
  readonly boardId: string;
  readonly label: string;
}

function queuedCommandOf(command: PendingCommand, scope: string, path: string): OfflineCommand {
  return {
    commandId: command.commandId,
    scope,
    path,
    body: assignmentRequestBody(command, command.expectedVersion),
    label: command.label,
    createdAt: new Date().toISOString(),
    status: "PENDING",
    error: null,
  };
}

function pendingCommandOf(entry: AssignmentQueueEntry): PendingCommand {
  return {
    commandId: entry.command.commandId,
    expectedVersion: entry.expectedVersion,
    matchId: entry.matchId,
    boardId: entry.boardId,
    label: entry.command.label,
  };
}

interface VersionConflict {
  readonly expected: number;
  readonly server: number;
  readonly currentState: TournamentDashboard;
}

interface CommandCentreProps {
  readonly organizationId: string;
  readonly tournamentId: string;
  readonly canCorrect: boolean;
  readonly canWithdraw: boolean;
}

function conflictState(error: unknown, expected: number): VersionConflict | null {
  if (!(error instanceof ApiClientError) || error.code !== "TOURNAMENT_VERSION_CONFLICT") {
    return null;
  }
  const details = error.details as { readonly currentState?: unknown } | undefined;
  const parsed = tournamentDashboardSchema.safeParse(details?.currentState);
  return parsed.success
    ? { expected, server: parsed.data.tournament.version, currentState: parsed.data }
    : null;
}

export function CommandCentre({ canCorrect, canWithdraw, organizationId, tournamentId }: CommandCentreProps) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ["tournament-dashboard", organizationId, tournamentId] as const,
    [organizationId, tournamentId],
  );
  const dashboardQuery = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      apiRequest({
        path: `/organizations/${organizationId}/tournaments/${tournamentId}/dashboard`,
        schema: tournamentDashboardSchema,
        signal,
      }),
    refetchInterval: 5_000,
  });
  const dashboard = dashboardQuery.data;
  const [connection, setConnection] = useState<"live" | "offline">("live");
  const [realtimeConnection, setRealtimeConnection] = useState<RealtimeConnection>("verbindet");
  const [landedBoardId, setLandedBoardId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [commandBusy, setCommandBusy] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const scope = tournamentQueueScope(organizationId, tournamentId);
  const assignmentPath = `/organizations/${organizationId}/tournaments/${tournamentId}/assignments`;
  /**
   * Die lokale Warteschlange samt ihren beiden Fehlerkanaelen. Lesefehler und
   * Schreibfehler sind getrennt, weil auf fast jedes Schreiben ein
   * `refreshQueue()` folgt: mit einem gemeinsamen Zustand loeschte das
   * erfolgreiche Lesen die Meldung des gescheiterten Schreibens im selben Tick
   * wieder (Re-Review, "Wipe-Bug"). Beide sind ausserdem getrennt von
   * `commandError`, das einen einzelnen Befehl betrifft; alle drei koennen
   * gleichzeitig zutreffen und keiner darf einen anderen ueberschreiben.
   */
  const {
    queued,
    readError: queueReadError,
    writeError: queueWriteError,
    acceptedButStuck,
    refreshQueue,
    persist: persistQueuedAssignment,
    markOutcome: markQueuedOutcome,
    remove: removeQueued,
    removeAccepted: removeAcceptedQueued,
  } = useOfflineQueue(scope);

  useEffect(() => {
    const update = () => setConnection(navigator.onLine ? "live" : "offline");
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(
    () => connectTournamentRealtime({
      tournamentId,
      onChange: () => void queryClient.invalidateQueries({ queryKey }),
      onConnection: setRealtimeConnection,
    }),
    [queryClient, queryKey, tournamentId],
  );

  const queueEntries = useMemo(() => assignmentQueueEntries(queued), [queued]);
  // Uebertragbar ist nur der fuehrende Block wartender Zuweisungen: ein
  // abgelehnter oder konfliktbehafteter Kopf haelt die Reihenfolge an, ueber
  // den einzelnen Durchgang hinaus (siehe offline-replay.ts).
  const replayable = useMemo(() => assignmentQueueEntries(nextReplayable(queued)), [queued]);
  // Nur unuebertragene Zuweisungen belegen Board und Match; eine abgelehnte
  // ist nie geschehen und gibt beides wieder frei.
  const pending = useMemo(() => unsentAssignments(queueEntries), [queueEntries]);
  const pendingMatchIds = useMemo(
    () => new Set(pending.map((entry) => entry.matchId)),
    [pending],
  );
  const pendingBoardIds = useMemo(
    () => new Set(pending.map((entry) => entry.boardId)),
    [pending],
  );
  /**
   * Ob den Zuweisungs-Controls (BoardWedge-Zuweisung, QueuePanel) getraut
   * werden darf. Scheitert das Lesen der lokalen Warteschlange, koennen
   * `queued` und damit `pendingBoardIds`/`pendingMatchIds` einen wartenden
   * Eintrag VERBERGEN -- ein Board oder Match saehe faelschlich frei aus, und
   * die Bedienung koennte dasselbe Board oder Match ein zweites Mal
   * reservieren, waehrend das versteckte Kommando noch darauf wartet,
   * uebertragen zu werden (PR-Agent-Rueckmeldung Runde 9, "Unsafe
   * Assignment"). Dafuer genuegt `queueHidesEntries`: bedingungslose Sperre
   * bei einem Lesefehler, sonst frei.
   *
   * Bewusst NICHT `queueBlocksControl` (wie `mayControl` in
   * `use-match-scoring.ts`): die Scoringflaeche traegt genau eine Aufnahme auf
   * einmal und muss deshalb JEDES wartende oder konfliktbehaftete Kommando
   * anhalten lassen. Die Zentrale verwaltet dagegen viele unabhaengige
   * Boards/Matches nebeneinander -- `pendingBoardIds`/`pendingMatchIds`
   * verhindern bereits eine zweite Zuweisung auf DASSELBE Board oder Match,
   * und `nextReplayable`/`replayChained` tragen die Reihenfolge der
   * Wiedergabe. Mit `queueBlocksControl` sperrte eine einzige Offline-
   * Zuweisung jedes WEITERE freie Board und Match, obwohl beides laengst
   * durch die Dublettenpruefung geschuetzt ist (PR-Agent-Rueckmeldung Runde
   * 10, Regression seit Runde 9).
   *
   * Gilt bewusst NICHT fuer die Freigabe (`release`): sie wird nie in die
   * Warteschlange gelegt (immer nur online versucht) und betrifft immer ein
   * BLOCKIERTES Board -- ein Zustand, den eine Zuweisung (die stets ein
   * FREIES Board voraussetzt) gar nicht erst erreichen kann. Ein verstecktes
   * wartendes Kommando kann eine Freigabe deshalb nicht falsch machen.
   */
  const assignBlocked = queueHidesEntries(queueReadError);
  const readyQueue = useMemo(
    () =>
      (dashboard?.queue ?? []).filter(
        (entry) => entry.readiness === "READY" && !pendingMatchIds.has(entry.matchId),
      ),
    [dashboard?.queue, pendingMatchIds],
  );
  const openBoards = useMemo(
    () =>
      (dashboard?.boards ?? []).filter(
        (slot) => slot.state === "FREE" && !pendingBoardIds.has(slot.boardId),
      ),
    [dashboard?.boards, pendingBoardIds],
  );

  /**
   * Sendet eine Zuweisung mit einer explizit uebergebenen `expectedVersion`
   * -- nie mit der beim Einreihen gespeicherten (`command.expectedVersion`
   * ist nur ein Anzeigehinweis, siehe `PendingCommand`). `queuedCommand` ist
   * gesetzt, wenn sie bereits in der Warteschlange steht -- dann wird sie
   * dort entfernt (Erfolg) oder mit ihrem Ausgang markiert. Eine fachliche
   * Ablehnung wird nicht wiederholt: sonst bliebe sie fuer immer stehen und
   * sperrte Board und Match.
   *
   * Der `try/catch` um den API-Aufruf endet mit der Serverantwort. Die
   * lokale Nacharbeit danach (Warteschlangeneintrag entfernen, Ansicht
   * aktualisieren) hat eine eigene, sichtbare Fehlerbehandlung: ein Fehler
   * dort ist "lokal nicht aufgeraeumt", nicht "Uebertragung gescheitert", und
   * darf ein bereits angenommenes Kommando nicht ueber `replayFailure`
   * erneut als CONFLICT/REJECTED einreihen (PR-Agent-Befund F2).
   *
   * Gibt den Ausgang als `ReplayOutcome` zurueck: bei Erfolg mit der vom
   * Server bestaetigten neuen Turnierversion, damit `flushPending` sie an das
   * naechste Kommando der Kette weiterreichen kann. Im Fehlerfall sagt
   * `accepted`, ob der Server angenommen hat und nur die lokale Nacharbeit
   * scheiterte -- die Ansicht ist dann trotzdem schon aktualisiert (siehe
   * `setQueryData` unten).
   */
  const sendAssignment = useCallback(
    async (command: PendingCommand, expectedVersion: number, queuedCommand: OfflineCommand | null = null): Promise<ReplayOutcome> => {
      let next: TournamentDashboard;
      try {
        next = await apiRequest({
          path: assignmentPath,
          method: "POST",
          body: assignmentRequestBody(command, expectedVersion),
          schema: tournamentDashboardSchema,
        });
      } catch (error) {
        const versionConflict = conflictState(error, expectedVersion);
        if (versionConflict !== null) setConflict(versionConflict);
        const failure = replayFailure(error);
        // `queuedLocally` bleibt fuer CONFLICT/REJECTED auf `true` -- dort
        // wird nichts (neu) in die Warteschlange gelegt, die abschliessende
        // Fehlermeldung unten gilt unveraendert wie vorher. Nur im Fall
        // `RETRY` kann das Ablegen selbst scheitern; dann steht die passende
        // Meldung bereits in `queue.writeError`, und die generische unten
        // darf sie nicht verdraengen.
        let queuedLocally = true;
        switch (failure.kind) {
          case "RETRY":
            setConnection("offline");
            queuedLocally = await persistQueuedAssignment(queuedCommand ?? queuedCommandOf(command, scope, assignmentPath));
            if (queuedLocally) setAnnouncement("Verbindung unterbrochen. Der Befehl bleibt in der Warteschlange.");
            break;
          // Beide Ausgaenge schreiben denselben Eintrag, nur mit anderem
          // Status -- `markOutcome` faengt dabei einen Schreibfehler ab, damit
          // er nicht am `setCommandError` unten vorbei nach aussen entkommt
          // (PR-Agent-Runde 5, Durchsicht).
          case "CONFLICT":
          case "REJECTED":
            if (queuedCommand !== null) await markQueuedOutcome(queuedCommand, failure);
            break;
        }
        if (queuedLocally) setCommandError(userFacingErrorMessage(error, "Zuweisung fehlgeschlagen."));
        await refreshQueue();
        return { successful: false, accepted: false };
      }

      // Der Server hat die Zuweisung angenommen -- ab hier zaehlt kein
      // Serverfehler mehr, nur noch lokale Nacharbeit.
      queryClient.setQueryData(queryKey, next);
      setLandedBoardId(command.boardId);
      setCommandError(null);
      setAnnouncement(`${command.label} läuft.`);
      // `removeAccepted` traegt die eigene Meldung fuer genau diesen Fall
      // (`localCleanupFailureMessage`): der Server hat angenommen, nur das
      // lokale Aufraeumen scheiterte. Sie steht in `queue.writeError` und
      // ueberlebt das `refreshQueue()` darunter.
      //
      // Scheitert es, bricht die Kette hier ab statt weiterzulaufen. Vorher
      // wurde der Rueckgabewert verworfen und die Zuweisung als erfolgreich
      // gemeldet: scheiterte das naechste Kommando mit `RETRY`, loeschte
      // dessen erfolgreiches `persistQueuedAssignment` den `writeError` --
      // die Meldung zum angenommenen, lokal nicht entfernten Eintrag war weg,
      // waehrend er weiter als "wartet" in der Liste stand (Runde 7). Die
      // Scoringflaeche bricht an der analogen Stelle schon laenger ab
      // (`use-match-scoring.ts`).
      //
      // Die Ansicht haengt hier -- anders als in der Scoringflaeche -- nicht
      // am Aufraeumen: `setQueryData` oben lief schon mit der Serverantwort
      // (Runde 8, Befund B). `accepted: true` sagt es der Kette trotzdem.
      if (queuedCommand !== null && !(await removeAcceptedQueued(queuedCommand.commandId))) {
        await refreshQueue();
        return { successful: false, accepted: true };
      }
      await refreshQueue();
      return { successful: true, version: next.tournament.version };
    },
    [assignmentPath, markQueuedOutcome, persistQueuedAssignment, queryClient, queryKey, refreshQueue, removeAcceptedQueued, scope],
  );

  const assign = useCallback(
    async (options: { readonly boardId?: string; readonly matchId?: string }) => {
      // `assignBlocked` gehoert hierher und nicht nur in die `disabled`-Props
      // der Controls: die Zifferntaste (`onKeyDown` unten) ruft `assign`
      // direkt auf und geht dabei an jedem `disabled`-Attribut vorbei -- ein
      // rein visuelles Sperren haette die Tastatur nicht erfasst.
      if (dashboard === undefined || commandBusy || assignBlocked) return;
      const board = options.boardId
        ? (dashboard.boards.find(
            (slot) =>
              slot.boardId === options.boardId &&
              slot.state === "FREE" &&
              !pendingBoardIds.has(slot.boardId),
          ) ?? null)
        : (openBoards[0] ?? null);
      const entry = options.matchId
        ? (readyQueue.find((item) => item.matchId === options.matchId) ?? null)
        : (readyQueue[0] ?? null);
      if (board === null || entry === null) return;
      // `expectedVersion` ist der aktuelle `dashboard.tournament.version` --
      // der zuletzt gesehene Serverstand, nicht ein um die Anzahl wartender
      // Kommandos hochgerechneter Wert. Diese Hochrechnung war der Befund: ein
      // zwischendurch verworfenes Kommando zaehlte weiter mit, und die
      // Nachfolger sendeten eine Version, die der Server nie erreichen konnte
      // (PR-Agent-Befund F2, "Stale Versions"). Der Online-Pfad unten sendet
      // sie direkt; steht die Zuweisung offline in der Warteschlange, sendet
      // die Wiedergabe genau diesen Wert, wenn sie Kopf der Kette ist
      // (Runde 8, Befund A).
      const command: PendingCommand = {
        commandId: generateId(),
        expectedVersion: dashboard.tournament.version,
        matchId: entry.matchId,
        boardId: board.boardId,
        label: `${entry.participants[0].displayName} – ${entry.participants[1].displayName} auf ${board.boardName}`,
      };
      if (connection === "offline") {
        // Gesperrt wird VOR dem Ablegen, nicht erst beim Senden: waehrend des
        // `await` auf IndexedDB ist `pendingBoardIds` noch nicht aktualisiert
        // und die Zuweisung noch nirgends sichtbar. Ohne Sperre reihte ein
        // schneller zweiter Tipp eine zweite Zuweisung fuer dasselbe Board
        // oder Match ein (PR-Agent-Runde 5, Befund c). Der Online-Zweig unten
        // sperrt aus demselben Grund; `finally` gibt in jedem Ausgang frei.
        setCommandBusy(true);
        try {
          // Weder gesendet noch gespeichert, wenn `persistQueuedAssignment`
          // scheitert -- ohne diese Meldung verschwaende die Zuweisung
          // kommentarlos (PR-Agent-Runde 3, Befund A). Der Helfer setzt die
          // Meldung in diesem Fall bereits selbst; hier nur noch abbrechen.
          if (!(await persistQueuedAssignment(queuedCommandOf(command, scope, assignmentPath)))) return;
          await refreshQueue();
          setCommandError(null);
          setAnnouncement(`Zuweisung auf ${board.boardName} wartet auf die Verbindung.`);
        } finally {
          setCommandBusy(false);
        }
        return;
      }
      setCommandBusy(true);
      try {
        await sendAssignment(command, dashboard.tournament.version);
      } finally {
        setCommandBusy(false);
      }
    },
    [assignBlocked, assignmentPath, commandBusy, connection, dashboard, openBoards, pendingBoardIds, persistQueuedAssignment, readyQueue, refreshQueue, scope, sendAssignment],
  );

  const release = useCallback(
    async (boardId: string) => {
      if (dashboard === undefined || commandBusy) return;
      if (connection === "offline") {
        setAnnouncement("Das Board kann erst mit aktiver Verbindung freigegeben werden.");
        return;
      }
      const expectedVersion = dashboard.tournament.version;
      setCommandBusy(true);
      try {
        const next = await apiRequest({
          path: `/organizations/${organizationId}/tournaments/${tournamentId}/board-releases`,
          method: "POST",
          body: { commandId: generateId(), expectedVersion, boardId },
          schema: tournamentDashboardSchema,
        });
        queryClient.setQueryData(queryKey, next);
        setCommandError(null);
        setAnnouncement("Board freigegeben.");
      } catch (error) {
        const versionConflict = conflictState(error, expectedVersion);
        if (versionConflict !== null) setConflict(versionConflict);
        setCommandError(userFacingErrorMessage(error, "Freigabe fehlgeschlagen."));
      } finally {
        setCommandBusy(false);
      }
    },
    [commandBusy, connection, dashboard, organizationId, queryClient, queryKey, tournamentId],
  );

  /**
   * Uebertraegt die wartenden Zuweisungen in ihrer Reihenfolge. Beim ersten
   * Fehlschlag wird abgebrochen: die Reihenfolge ist verbindlich.
   *
   * Die erste Zuweisung sendet die beim Einreihen gespeicherte
   * `expectedVersion` -- den Turnierstand, den die Zentrale zuletzt gesehen
   * hat --, jede folgende die Version aus der Antwort auf ihre Vorgaengerin
   * (`replayChained`). Ein zwischendurch verworfenes Kommando zaehlt damit
   * nicht mehr in der Versionsrechnung der folgenden mit (PR-Agent-Befund F2,
   * "Stale Versions"), und ein Turnier, das sich waehrend der Offline-Phase
   * unabhaengig bewegt hat, laesst die Kette am Kopf konfligieren statt sie
   * stillschweigend auf den neuen Stand zu heben (Runde 8, Befund A).
   *
   * Der Refetch bleibt: er haelt die ANZEIGE frisch, bevor die Zuweisungen
   * abgehen. Eine Startversion liefert er nicht mehr. Scheitert er, wird
   * nichts uebertragen -- die Verbindung ist dann offenkundig gestoert, und
   * die Zentrale wuerde einen veralteten Stand zeigen, waehrend sie schreibt.
   */
  const flushPending = useCallback(async () => {
    // Der Verbindungszustand wird ebenfalls aus dem `online`-Ereignis gesetzt.
    // Zum Zeitpunkt des Ereignisses traegt `connection` deshalb noch "offline",
    // und eine Pruefung auf den Zustand haette die automatische Uebertragung
    // im selben Tick abgewiesen. `navigator.onLine` ist an dieser Stelle die
    // frische Auskunft; der Knopf bleibt weiterhin ueber `connection`
    // deaktiviert.
    if (commandBusy || (typeof navigator !== "undefined" && !navigator.onLine)) return;
    setCommandBusy(true);
    try {
      const refreshed = await dashboardQuery.refetch();
      // Ein gescheiterter Refetch liefert weiterhin den zwischengespeicherten
      // Stand -- die Zentrale schriebe dann blind gegen eine Anzeige, die sie
      // nicht bestaetigen konnte. Lieber nichts uebertragen und es sagen
      // (PR-Agent-Runde 5, Durchsicht).
      if (refreshed.isError) {
        setCommandError(userFacingErrorMessage(refreshed.error, "Serverstand konnte nicht geladen werden; es wurde nichts übertragen."));
        return;
      }
      const result = await replayChained<AssignmentQueueEntry>(
        replayable,
        // Kopf (`chainedVersion === null`): die gespeicherte Version der
        // Zuweisung. Nachfolger: die Version aus der Antwort auf die
        // Vorgaengerin.
        async (entry, chainedVersion): Promise<ReplayOutcome> =>
          await sendAssignment(pendingCommandOf(entry), chainedVersion ?? entry.expectedVersion, entry.command),
      );
      setAnnouncement(replayAnnouncement(result));
    } finally {
      setCommandBusy(false);
    }
  }, [commandBusy, dashboardQuery, replayable, sendAssignment]);

  // Wartendes geht auch ohne Knopfdruck raus, sobald das Geraet wieder im Netz
  // ist -- wie die Scoringflaeche. Vorher blieben Zuweisungen liegen, bis
  // jemand "Jetzt übertragen" traf.
  useOnlineFlush(flushPending);

  /**
   * Verwirft eine Zuweisung, die nur noch im Weg steht -- und holt danach den
   * Serverstand nach.
   *
   * Ein konfliktbehafteter Eintrag entsteht in aller Regel, weil der Server
   * inzwischen auf einer neueren Version steht. Wird er verworfen, ohne das
   * Dashboard neu zu laden, rechnet die Zentrale mit derselben veralteten
   * `dashboard.tournament.version` weiter: die naechste DIREKTE Zuweisung
   * (Online-Pfad in `assign`) sendet genau diese Version und konfligiert
   * sofort wieder. Bleibt ein Realtime-Update aus, kaeme die Zentrale ohne
   * diesen Abgleich nicht mehr aus der Schleife (PR-Agent-Runde 5, Befund a).
   */
  const discardQueued = useCallback(async (commandId: string) => {
    // Wie jede andere Bedienung der Zentrale gesperrt: das Entfernen laeuft
    // ueber IndexedDB und danach ueber das Netz, und ein zweiter Klick
    // waehrenddessen setzte einen zweiten Durchgang auf denselben Eintrag an.
    // Scheitert das Entfernen, bleibt der Eintrag stehen -- das muss sichtbar
    // sein, sonst klickt die Person ins Leere (PR-Agent-Runde 5, Durchsicht).
    if (commandBusy) return;
    setCommandBusy(true);
    try {
      // Scheitert das Entfernen, steht die Meldung in `queue.writeError` und
      // der Eintrag unveraendert weiter in der Liste -- dann wird weder der
      // Serverstand nachgeladen noch "verworfen" gemeldet.
      if (!(await removeQueued(commandId))) return;
      await refreshQueue();
      await queryClient.invalidateQueries({ queryKey });
      setAnnouncement("Befehl verworfen; der Serverstand wird nachgeladen.");
    } finally {
      setCommandBusy(false);
    }
  }, [commandBusy, queryClient, queryKey, refreshQueue, removeQueued]);

  const correctResult = useCallback(async (matchId: string, reason: string) => {
    if (dashboard === undefined || commandBusy || connection === "offline") return;
    const expectedVersion = dashboard.tournament.version;
    setCommandBusy(true);
    try {
      const next = await apiRequest({
        path: `/organizations/${organizationId}/tournaments/${tournamentId}/result-corrections`,
        method: "POST",
        body: { commandId: generateId(), expectedVersion, matchId, reason },
        schema: tournamentDashboardSchema,
      });
      queryClient.setQueryData(queryKey, next);
      setCommandError(null);
      setAnnouncement("Ergebnis zurückgenommen; das Match ist wieder geöffnet.");
    } catch (error) {
      const versionConflict = conflictState(error, expectedVersion);
      if (versionConflict !== null) setConflict(versionConflict);
      setCommandError(userFacingErrorMessage(error, "Ergebnis konnte nicht korrigiert werden."));
    } finally {
      setCommandBusy(false);
    }
  }, [commandBusy, connection, dashboard, organizationId, queryClient, queryKey, tournamentId]);

  const withdrawParticipant = useCallback(async (playerId: string, reason: string) => {
    if (dashboard === undefined || commandBusy || connection === "offline") return;
    const expectedVersion = dashboard.tournament.version;
    setCommandBusy(true);
    try {
      const next = await apiRequest({
        path: `/organizations/${organizationId}/tournaments/${tournamentId}/withdrawals`,
        method: "POST",
        body: { commandId: generateId(), expectedVersion, playerId, reason },
        schema: tournamentDashboardSchema,
      });
      queryClient.setQueryData(queryKey, next);
      setCommandError(null);
      setAnnouncement("Spielerausfall verarbeitet; offene Matches wurden aktualisiert.");
    } catch (error) {
      const versionConflict = conflictState(error, expectedVersion);
      if (versionConflict !== null) setConflict(versionConflict);
      setCommandError(userFacingErrorMessage(error, "Spielerausfall konnte nicht verarbeitet werden."));
    } finally {
      setCommandBusy(false);
    }
  }, [commandBusy, connection, dashboard, organizationId, queryClient, queryKey, tournamentId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      const slot = dashboard?.boards.find(
        (candidate) =>
          String(candidate.ringNumber) === event.key &&
          candidate.state === "FREE" &&
          !pendingBoardIds.has(candidate.boardId),
      );
      if (slot !== undefined) {
        event.preventDefault();
        void assign({ boardId: slot.boardId });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [assign, dashboard?.boards, pendingBoardIds]);

  if (dashboardQuery.isPending) return <RouteNotice message="Turnier wird geladen …" />;
  if (dashboard === undefined) {
    return <RouteNotice message={dashboardQuery.error?.message ?? "Turnier konnte nicht geladen werden."} />;
  }

  return (
    <div className="sektorenring min-h-screen">
      <div className="mx-auto max-w-[1600px] px-5 py-6 xl:px-9">
        <PageNav>
          <NavLink href={`/turniere?organisation=${organizationId}`}>Alle Turniere</NavLink>
          <NavLink href={`/live/${tournamentId}`}>Öffentliche Live-Ansicht</NavLink>
        </PageNav>

        <DashboardHeader
          connection={dashboardQuery.error === null ? connection : "offline"}
          dashboard={dashboard}
          pendingCount={pending.length}
        />

        {conflict ? (
          <Wedge className="mt-5 flex flex-wrap items-start gap-4 p-4" tone="alarm">
            <MarkCross className="mt-0.5 shrink-0 text-ring-red" size={16} />
            <div className="min-w-0 flex-1">
              <SheetLabel as="h2" tone="alarm">Versionskonflikt · HTTP 409</SheetLabel>
              <p className="mt-1.5 font-plate text-body text-wedge-900">
                Deine Zuweisung ging von Version {conflict.expected} aus, der Server steht auf {conflict.server}. Übernimm den aktuellen Serverzustand und prüfe die Disposition erneut.
              </p>
            </div>
            <Control onClick={() => {
              queryClient.setQueryData(queryKey, conflict.currentState);
              setConflict(null);
              setCommandError(null);
              setAnnouncement("Serverzustand übernommen.");
            }} variant="plate">Serverzustand übernehmen</Control>
          </Wedge>
        ) : null}

        {commandError !== null && conflict === null ? (
          <Wedge className="mt-5 p-4" tone="alarm">
            <SheetLabel as="h2" tone="alarm">Befehl nicht ausgeführt</SheetLabel>
            <p className="mt-1.5 font-plate text-body text-wedge-900">{commandError}</p>
          </Wedge>
        ) : null}

        {/*
          * Die Warteschlange muss auch dann sichtbar sein, wenn genau ihr
          * Lesen oder Aendern scheitert -- sonst zeigt die Zentrale eine leere
          * Liste und die Person haelt sie fuer leer (AGENTS.md §18). Eigene
          * Flaechen neben `commandError`: der Fehler betrifft die
          * Warteschlange als Ganzes, nicht einen einzelnen Befehl. Lesen und
          * Schreiben stehen getrennt, weil sie Unterschiedliches bedeuten und
          * gleichzeitig zutreffen koennen.
          */}
        {queueReadError !== null ? (
          <Wedge className="mt-5 p-4" tone="alarm">
            <SheetLabel as="h2" tone="alarm">Warteschlange nicht gelesen</SheetLabel>
            <p className="mt-1.5 font-plate text-body text-wedge-900">{queueReadError}</p>
          </Wedge>
        ) : null}

        {queueWriteError !== null ? (
          <Wedge className="mt-5 p-4" tone="alarm">
            <SheetLabel as="h2" tone="alarm">Warteschlange nicht geändert</SheetLabel>
            <p className="mt-1.5 font-plate text-body text-wedge-900">{queueWriteError}</p>
          </Wedge>
        ) : null}

        {queueEntries.length > 0 ? (
          <Wedge className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 p-4" tone="plate">
            <div className="min-w-0 flex-1">
              <SheetLabel as="h2">{queueEntries.length} Befehl{queueEntries.length === 1 ? "" : "e"} in der Warteschlange</SheetLabel>
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {queueEntries.map((entry) => {
                  // `acceptedButStuck` ist eintragsbezogen: nur eine
                  // Zuweisung, die der Server angenommen hat und die bloss
                  // lokal nicht entfernt werden konnte, darf als wartender
                  // Eintrag verworfen werden (siehe `offline-replay.ts`).
                  const notice = queuedCommandNotice(entry.command, {
                    online: connection === "live",
                    pendingOnline: "wartet auf Übertragung",
                    acceptedButStuck: acceptedButStuck.has(entry.command.commandId),
                  });
                  return (
                    <li className="flex flex-wrap items-center justify-between gap-3 font-plate text-body text-wedge-900" key={entry.command.commandId}>
                      <span>{notice.text}</span>
                      {notice.action === "DISCARD" ? (
                        <Control disabled={commandBusy} onClick={() => void discardQueued(entry.command.commandId)} variant="plate">Verwerfen</Control>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
            <Control disabled={commandBusy || connection === "offline" || replayable.length === 0} onClick={() => void flushPending()} variant="plate">Jetzt übertragen</Control>
          </Wedge>
        ) : null}

        <div className="mt-6 grid items-start gap-x-8 gap-y-7 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <section aria-labelledby="boards-heading">
            <div className="flex items-baseline justify-between gap-3 pb-2">
              <SheetLabel as="h2" id="boards-heading">Boards · Zifferntaste weist zu</SheetLabel>
              <span className="shrink-0 font-numerals text-counter font-bold tabular text-sisal-500">{dashboard.boards.length}</span>
            </div>
            <Rule />
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {dashboard.boards.map((slot: BoardSlot) => (
                <BoardWedge
                  // Waehrend ein Befehl laeuft sind Zuweisen und Freigeben
                  // wirklich gesperrt, nicht nur durch die Wache in `assign`
                  // /`release` aus der Render-Closure. Ohne das echte
                  // `disabled` sehen die Knoepfe bedienbar aus, und die Sperre
                  // haengt allein daran, dass React diskrete Ereignisse sofort
                  // flusht (Re-Review, Befund 3).
                  //
                  // `assignBlocked` gilt nur fuer ein FREIES Board -- dort
                  // rendert `BoardWedge` den Zuweisen-Knopf. Fuer ein
                  // BLOCKIERTES Board (Freigeben-Knopf) bleibt es aussen vor,
                  // siehe Kommentar bei `assignBlocked` oben.
                  disabled={commandBusy || (slot.state === "FREE" && assignBlocked)}
                  justLanded={landedBoardId === slot.boardId}
                  key={slot.boardId}
                  nextUp={slot.state === "FREE" ? (readyQueue[0] ?? null) : null}
                  now={dashboard.generatedAt}
                  onAssign={() => void assign({ boardId: slot.boardId })}
                  onRelease={() => void release(slot.boardId)}
                  pending={pendingBoardIds.has(slot.boardId) || commandBusy}
                  shortcut={String(slot.ringNumber)}
                  slot={slot}
                />
              ))}
            </div>
          </section>

          <div className="flex flex-col gap-7">
            <QueuePanel disabled={commandBusy || assignBlocked} onAssign={(matchId) => void assign({ matchId })} openBoardName={openBoards[0]?.boardName ?? null} queue={dashboard.queue} />
            <ParticipantDisruptionPanel canWithdraw={canWithdraw} disabled={commandBusy || connection === "offline"} onWithdraw={(playerId, reason) => void withdrawParticipant(playerId, reason)} participants={dashboard.participants} />
            <ResultsPanel busy={commandBusy} canCorrect={canCorrect} onCorrect={(matchId, reason) => void correctResult(matchId, reason)} results={dashboard.recentResults} />
            <DisruptionsPanel conflicts={dashboard.conflicts} />
          </div>
        </div>

        <div className="mt-9"><StandingsSheet groups={dashboard.groups} /></div>
        <Rule className="mt-10" />
        <p className="pt-4 font-plate text-caption text-sisal-500">Serverstand · Echtzeit {realtimeConnection}</p>
      </div>
      <p aria-live="polite" className="sr-only" role="status">{announcement}</p>
    </div>
  );
}

function RouteNotice({ message }: { readonly message: string }) {
  return (
    <main className="sektorenring min-h-screen px-5 py-12">
      <div className="mx-auto max-w-2xl border border-sisal-400 bg-sisal-100 p-6 font-plate text-wedge-900">{message}</div>
    </main>
  );
}
