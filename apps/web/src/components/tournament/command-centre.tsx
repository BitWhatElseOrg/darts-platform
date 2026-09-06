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
import {
  listOfflineCommands,
  markOfflineCommandConflict,
  markOfflineCommandRejected,
  removeOfflineCommand,
  saveOfflineCommand,
  type OfflineCommand,
} from "@/lib/offline-command-queue";
import {
  localCleanupFailureMessage,
  nextReplayable,
  queuedCommandNotice,
  replayFailure,
  replayWithCurrentVersion,
  type ReplayOutcome,
} from "@/lib/offline-replay";
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
   * Version bei Erfassung -- nur ein Anzeigehinweis fuer die gespeicherte
   * Nutzlast. Gesendet wird sie nicht: `sendAssignment` bekommt die
   * tatsaechliche `expectedVersion` separat uebergeben (siehe
   * `tournament-assignment-queue.ts`, PR-Agent-Befund F2 "Stale Versions").
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
  const [queued, setQueued] = useState<readonly OfflineCommand[]>([]);
  const [landedBoardId, setLandedBoardId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [commandBusy, setCommandBusy] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const scope = tournamentQueueScope(organizationId, tournamentId);
  const assignmentPath = `/organizations/${organizationId}/tournaments/${tournamentId}/assignments`;
  const refreshQueue = useCallback(async () => setQueued(await listOfflineCommands(scope)), [scope]);
  // Die Warteschlange liegt in IndexedDB und wird beim Betreten der Zentrale
  // gelesen: eine offline erfasste Zuweisung ueberlebt damit ein Neuladen.
  useEffect(() => {
    let active = true;
    void listOfflineCommands(scope).then((commands) => { if (active) setQueued(commands); });
    return () => { active = false; };
  }, [scope]);

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
   * Gibt bei Erfolg die vom Server bestaetigte neue Turnierversion zurueck,
   * sonst `null` -- so kann die Aufruferin (siehe `flushPending`) diese
   * Version an das naechste Kommando der Kette weiterreichen.
   */
  const sendAssignment = useCallback(
    async (command: PendingCommand, expectedVersion: number, queuedCommand: OfflineCommand | null = null): Promise<number | null> => {
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
        switch (failure.kind) {
          case "RETRY":
            setConnection("offline");
            await saveOfflineCommand(queuedCommand ?? queuedCommandOf(command, scope, assignmentPath));
            setAnnouncement("Verbindung unterbrochen. Der Befehl bleibt in der Warteschlange.");
            break;
          case "CONFLICT":
            if (queuedCommand !== null) await markOfflineCommandConflict(queuedCommand, failure.code, failure.message);
            break;
          case "REJECTED":
            if (queuedCommand !== null) await markOfflineCommandRejected(queuedCommand, failure.code, failure.message);
            break;
        }
        setCommandError(userFacingErrorMessage(error, "Zuweisung fehlgeschlagen."));
        await refreshQueue();
        return null;
      }

      // Der Server hat die Zuweisung angenommen -- ab hier zaehlt kein
      // Serverfehler mehr, nur noch lokale Nacharbeit.
      queryClient.setQueryData(queryKey, next);
      setLandedBoardId(command.boardId);
      setCommandError(null);
      setAnnouncement(`${command.label} läuft.`);
      try {
        if (queuedCommand !== null) await removeOfflineCommand(queuedCommand.commandId);
        await refreshQueue();
      } catch (localError) {
        setCommandError(localCleanupFailureMessage(localError));
      }
      return next.tournament.version;
    },
    [assignmentPath, queryClient, queryKey, refreshQueue, scope],
  );

  const assign = useCallback(
    async (options: { readonly boardId?: string; readonly matchId?: string }) => {
      if (dashboard === undefined || commandBusy) return;
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
      // `expectedVersion` ist hier nur der Anzeigehinweis fuer die
      // Warteschlange (siehe `PendingCommand`); gesendet wird beim Online-Pfad
      // unten der aktuelle `dashboard.tournament.version` direkt, nicht ein um
      // die Anzahl wartender Kommandos hochgerechneter Wert. Diese
      // Hochrechnung war der Befund: ein zwischendurch verworfenes Kommando
      // zaehlte weiter mit, und die Nachfolger sendeten eine Version, die der
      // Server nie erreichen konnte (PR-Agent-Befund F2, "Stale Versions").
      const command: PendingCommand = {
        commandId: generateId(),
        expectedVersion: dashboard.tournament.version,
        matchId: entry.matchId,
        boardId: board.boardId,
        label: `${entry.participants[0].displayName} – ${entry.participants[1].displayName} auf ${board.boardName}`,
      };
      if (connection === "offline") {
        await saveOfflineCommand(queuedCommandOf(command, scope, assignmentPath));
        await refreshQueue();
        setAnnouncement(`Zuweisung auf ${board.boardName} wartet auf die Verbindung.`);
        return;
      }
      setCommandBusy(true);
      try {
        await sendAssignment(command, dashboard.tournament.version);
      } finally {
        setCommandBusy(false);
      }
    },
    [assignmentPath, commandBusy, connection, dashboard, openBoards, pendingBoardIds, readyQueue, refreshQueue, scope, sendAssignment],
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
   * Fehlschlag wird abgebrochen: die Reihenfolge ist verbindlich. Die
   * erwartete Turnierversion jeder Zuweisung baut nicht mehr auf der beim
   * Einreihen eingefrorenen `expectedVersion` auf, sondern auf einem frisch
   * geladenen Serverstand und danach auf der jeweils vorherigen erfolgreichen
   * Antwort (`replayWithCurrentVersion`) -- der zwischengespeicherte
   * `dashboard` koennte waehrend der Offline-Phase veraltet sein, und ein
   * zwischendurch verworfenes Kommando zaehlt so nicht mehr in der
   * Versionsrechnung der folgenden mit (PR-Agent-Befund F2, "Stale
   * Versions").
   */
  const flushPending = useCallback(async () => {
    if (commandBusy || connection === "offline") return;
    setCommandBusy(true);
    try {
      const refreshed = await dashboardQuery.refetch();
      const startVersion = refreshed.data?.tournament.version ?? dashboard?.tournament.version;
      if (startVersion === undefined) return;
      const { sentCount } = await replayWithCurrentVersion<AssignmentQueueEntry>(
        replayable,
        startVersion,
        async (entry, expectedVersion): Promise<ReplayOutcome> => {
          const version = await sendAssignment(pendingCommandOf(entry), expectedVersion, entry.command);
          return version === null ? { successful: false } : { successful: true, version };
        },
      );
      setAnnouncement(`${sentCount} Befehl${sentCount === 1 ? "" : "e"} übertragen.`);
    } finally {
      setCommandBusy(false);
    }
  }, [commandBusy, connection, dashboard?.tournament.version, dashboardQuery, replayable, sendAssignment]);

  /** Verwirft eine Zuweisung, die nur noch im Weg steht. */
  const discardQueued = useCallback(async (commandId: string) => {
    await removeOfflineCommand(commandId);
    await refreshQueue();
    setAnnouncement("Befehl verworfen.");
  }, [refreshQueue]);

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

        {queueEntries.length > 0 ? (
          <Wedge className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 p-4" tone="plate">
            <div className="min-w-0 flex-1">
              <SheetLabel as="h2">{queueEntries.length} Befehl{queueEntries.length === 1 ? "" : "e"} in der Warteschlange</SheetLabel>
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {queueEntries.map((entry) => {
                  const notice = queuedCommandNotice(entry.command, connection === "live", "wartet auf Übertragung");
                  return (
                    <li className="flex flex-wrap items-center justify-between gap-3 font-plate text-body text-wedge-900" key={entry.command.commandId}>
                      <span>{notice.text}</span>
                      {notice.action === "DISCARD" ? (
                        <Control onClick={() => void discardQueued(entry.command.commandId)} variant="plate">Verwerfen</Control>
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
            <QueuePanel onAssign={(matchId) => void assign({ matchId })} openBoardName={openBoards[0]?.boardName ?? null} queue={dashboard.queue} />
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
