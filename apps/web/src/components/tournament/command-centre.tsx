"use client";

import { Control, MarkCross, Rule, SheetLabel, Wedge } from "@darts-platform/ui";
import type { BoardSlot, QueueEntry, TournamentDashboard } from "@darts-platform/schemas";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { BoardWedge } from "./board-wedge";
import { DashboardHeader } from "./dashboard-header";
import { DisruptionsPanel } from "./disruptions-panel";
import { QueuePanel } from "./queue-panel";
import { StandingsSheet } from "./standings-sheet";
import { DASHBOARD_SCENARIOS, type DashboardScenarioId } from "@/lib/tournament-demo";

interface PendingCommand {
  readonly commandId: string;
  readonly matchId: string;
  readonly boardId: string;
  readonly label: string;
}

interface CommandCentreProps {
  readonly initialDashboard: TournamentDashboard;
  readonly scenario: DashboardScenarioId;
}

/**
 * The live command centre.
 *
 * Every mutation here is a DEMO application of a command that the API will own:
 * `POST /organizations/:id/tournaments/:id/assignments` with a `commandId` for
 * idempotency and an `expectedVersion` for optimistic concurrency. The local
 * state exists so the designed states can be reviewed before that endpoint
 * exists; no tournament rule is decided in this file.
 */
export function CommandCentre({ initialDashboard, scenario }: CommandCentreProps) {
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [connection, setConnection] = useState<"live" | "offline">("live");
  const [pending, setPending] = useState<readonly PendingCommand[]>([]);
  const [landedBoardId, setLandedBoardId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ expected: number; server: number } | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    setDashboard(initialDashboard);
    setPending([]);
    setConflict(null);
    setLandedBoardId(null);
  }, [initialDashboard]);

  const readyQueue = useMemo(
    () => dashboard.queue.filter((entry) => entry.readiness === "READY"),
    [dashboard.queue],
  );
  const openBoards = useMemo(
    () => dashboard.boards.filter((slot) => slot.state === "FREE"),
    [dashboard.boards],
  );

  const applyAssignment = useCallback(
    (entry: QueueEntry, board: BoardSlot) => {
      const [left, right] = entry.participants;
      if (left.playerId === null || right.playerId === null) {
        return;
      }
      setDashboard((current) => ({
        ...current,
        tournament: { ...current.tournament, version: current.tournament.version + 1 },
        queue: current.queue
          .filter((item) => item.matchId !== entry.matchId)
          .map((item, index) => ({ ...item, position: index + 1 })),
        boards: current.boards.map((slot) =>
          slot.boardId === board.boardId
            ? {
                ...slot,
                state: "PLAYING",
                blockedReason: null,
                match: {
                  matchId: entry.matchId,
                  version: 0,
                  stageLabel: entry.stageLabel,
                  legNumber: 1,
                  bestOfLegs: 3,
                  startedAt: current.generatedAt,
                  overrunning: false,
                  participants: [
                    {
                      playerId: left.playerId,
                      displayName: left.displayName,
                      remaining: current.tournament.startingScore,
                      legsWon: 0,
                      isActive: true,
                      onFinish: false,
                      checkoutRoute: null,
                    },
                    {
                      playerId: right.playerId,
                      displayName: right.displayName,
                      remaining: current.tournament.startingScore,
                      legsWon: 0,
                      isActive: false,
                      onFinish: false,
                      checkoutRoute: null,
                    },
                  ],
                },
              }
            : slot,
        ),
      }));
      setLandedBoardId(board.boardId);
      setAnnouncement(
        `${entry.participants[0].displayName} gegen ${entry.participants[1].displayName} läuft auf ${board.boardName}.`,
      );
    },
    [],
  );

  const assign = useCallback(
    (options: { readonly boardId?: string; readonly matchId?: string }) => {
      const board = options.boardId
        ? (dashboard.boards.find(
            (slot) => slot.boardId === options.boardId && slot.state === "FREE",
          ) ?? null)
        : (openBoards[0] ?? null);
      const entry = options.matchId
        ? (readyQueue.find((item) => item.matchId === options.matchId) ?? null)
        : (readyQueue[0] ?? null);
      if (!board || !entry) {
        return;
      }
      if (connection === "offline") {
        setPending((current) => [
          ...current,
          {
            commandId: `${entry.matchId}:${board.boardId}`,
            matchId: entry.matchId,
            boardId: board.boardId,
            label: `${entry.participants[0].displayName} – ${entry.participants[1].displayName} auf ${board.boardName}`,
          },
        ]);
        setAnnouncement(
          `Zuweisung auf ${board.boardName} wartet auf die Verbindung. Nichts ist verloren.`,
        );
        return;
      }
      applyAssignment(entry, board);
    },
    [applyAssignment, connection, dashboard.boards, openBoards, readyQueue],
  );

  const release = useCallback((boardId: string) => {
    setDashboard((current) => ({
      ...current,
      tournament: { ...current.tournament, version: current.tournament.version + 1 },
      boards: current.boards.map((slot) =>
        slot.boardId === boardId
          ? { ...slot, state: "FREE", blockedReason: null, match: null }
          : slot,
      ),
      /*
       * Conflicts are server-derived: releasing a board does not let the client
       * decide that the conflict is gone. The next dashboard response settles it.
       */
    }));
    setAnnouncement("Board freigegeben.");
  }, []);

  const flushPending = useCallback(() => {
    setConnection("live");
    pending.forEach((command) => {
      const entry = dashboard.queue.find((item) => item.matchId === command.matchId);
      const board = dashboard.boards.find((slot) => slot.boardId === command.boardId);
      if (entry && board) {
        applyAssignment(entry, board);
      }
    });
    setPending([]);
    setAnnouncement(`${pending.length} Befehle übertragen.`);
  }, [applyAssignment, dashboard.boards, dashboard.queue, pending]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) {
        return;
      }
      if (event.key === "Escape" && conflict) {
        setConflict(null);
        return;
      }
      const slot = dashboard.boards.find(
        (candidate) => String(candidate.ringNumber) === event.key && candidate.state === "FREE",
      );
      if (slot) {
        event.preventDefault();
        assign({ boardId: slot.boardId });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [assign, conflict, dashboard.boards]);

  const pendingBoardIds = new Set(pending.map((command) => command.boardId));

  return (
    <div className="sektorenring min-h-screen">
      <div className="mx-auto max-w-[1600px] px-5 py-6 xl:px-9">
        <nav className="mb-5">
          <Link
            className="font-plate text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-sisal-500 underline decoration-sisal-400 decoration-1 underline-offset-4 hover:text-wedge-900"
            href="/turniere"
          >
            Alle Turniere
          </Link>
        </nav>

        <DashboardHeader
          connection={connection}
          dashboard={dashboard}
          pendingCount={pending.length}
        />

        {conflict ? (
          <Wedge className="mt-5 flex flex-wrap items-start gap-4 p-4" tone="alarm">
            <MarkCross className="mt-0.5 shrink-0 text-ring-red" size={16} />
            <div className="min-w-0 flex-1">
              <SheetLabel as="h2" tone="alarm">
                Versionskonflikt · HTTP 409
              </SheetLabel>
              <p className="mt-1.5 font-plate text-[0.875rem] leading-snug text-wedge-900">
                Deine Zuweisung ging von Version {conflict.expected} aus, der Server steht auf{" "}
                {conflict.server}. Jemand anders hat in der Zwischenzeit disponiert. Der
                Serverzustand ist die Wahrheit — übernimm ihn und weise erneut zu.
              </p>
            </div>
            <div className="flex gap-2">
              <Control
                onClick={() => {
                  setDashboard((current) => ({
                    ...current,
                    tournament: { ...current.tournament, version: conflict.server },
                  }));
                  setConflict(null);
                  setAnnouncement("Serverzustand übernommen.");
                }}
                variant="plate"
              >
                Serverzustand übernehmen
              </Control>
            </div>
          </Wedge>
        ) : null}

        {pending.length > 0 ? (
          <Wedge className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 p-4" tone="plate">
            <div className="min-w-0 flex-1">
              <SheetLabel as="h2">
                {pending.length} Befehl{pending.length === 1 ? "" : "e"} in der Warteschlange
              </SheetLabel>
              <ul className="mt-1.5 flex flex-col gap-0.5">
                {pending.map((command) => (
                  <li className="font-plate text-[0.8125rem] text-wedge-900" key={command.commandId}>
                    {command.label}
                  </li>
                ))}
              </ul>
            </div>
            <Control onClick={flushPending} variant="plate">
              Jetzt übertragen
            </Control>
          </Wedge>
        ) : null}

        <div className="mt-6 grid items-start gap-x-8 gap-y-7 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <section aria-labelledby="boards-heading">
            <div className="flex items-baseline justify-between gap-3 pb-2">
              <SheetLabel as="h2" id="boards-heading">
                Boards · Zifferntaste weist zu
              </SheetLabel>
              <span className="font-numerals text-[0.8125rem] font-bold tabular text-sisal-500">
                {dashboard.boards.length}
              </span>
            </div>
            <Rule />
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {dashboard.boards.map((slot) => (
                <BoardWedge
                  justLanded={landedBoardId === slot.boardId}
                  key={slot.boardId}
                  nextUp={slot.state === "FREE" ? (readyQueue[0] ?? null) : null}
                  now={dashboard.generatedAt}
                  onAssign={() => assign({ boardId: slot.boardId })}
                  onRelease={() => release(slot.boardId)}
                  pending={pendingBoardIds.has(slot.boardId)}
                  shortcut={String(slot.ringNumber)}
                  slot={slot}
                />
              ))}
            </div>
          </section>

          <div className="flex flex-col gap-7">
            <QueuePanel
              onAssign={(matchId) => assign({ matchId })}
              openBoardName={openBoards[0]?.boardName ?? null}
              queue={dashboard.queue}
            />
            <DisruptionsPanel conflicts={dashboard.conflicts} />
          </div>
        </div>

        <div className="mt-9">
          <StandingsSheet groups={dashboard.groups} />
        </div>

        <Rule className="mt-10" />
        <section aria-labelledby="demo-heading" className="pt-4 pb-2">
          <SheetLabel as="h2" id="demo-heading">
            Demo-Steuerung · synthetische Daten, kein API-Anschluss
          </SheetLabel>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {DASHBOARD_SCENARIOS.map((entry) => (
              <Link
                aria-current={entry.id === scenario ? "page" : undefined}
                className={
                  entry.id === scenario
                    ? "min-h-9 border border-wedge-900 bg-wedge-900 px-3 py-2 font-plate text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-chalk"
                    : "min-h-9 border border-sisal-400 px-3 py-2 font-plate text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-wedge-900 hover:bg-sisal-100"
                }
                href={`/turniere/${dashboard.tournament.id}?zustand=${entry.id}`}
                key={entry.id}
                title={entry.note}
              >
                {entry.label}
              </Link>
            ))}
            <Control
              density="tight"
              onClick={() => setConnection(connection === "live" ? "offline" : "live")}
              variant="wire"
            >
              {connection === "live" ? "Verbindung trennen" : "Verbindung herstellen"}
            </Control>
            <Control
              density="tight"
              onClick={() =>
                setConflict({
                  expected: dashboard.tournament.version,
                  server: dashboard.tournament.version + 3,
                })
              }
              variant="wire"
            >
              Versionskonflikt zeigen
            </Control>
          </div>
        </section>
      </div>

      <p aria-live="polite" className="sr-only" role="status">
        {announcement}
      </p>
    </div>
  );
}
