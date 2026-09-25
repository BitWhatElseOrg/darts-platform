"use client";

import { Rule, SheetLabel, StateTag } from "@darts-platform/ui";
import type { TournamentDashboard } from "@darts-platform/schemas";

import { calendarDate, clockTime, statusLabel } from "@/lib/tournament-format";
import { tournamentWinner } from "@/lib/tournament-winner";

function inRuleLabel(rule: "STRAIGHT" | "DOUBLE"): string {
  return rule === "DOUBLE" ? "Double In" : "Straight In";
}

function outRuleLabel(rule: "SINGLE" | "DOUBLE" | "MASTER"): string {
  switch (rule) {
    case "SINGLE":
      return "Single Out";
    case "DOUBLE":
      return "Double Out";
    case "MASTER":
      return "Master Out";
  }
}

interface DashboardHeaderProps {
  readonly dashboard: TournamentDashboard;
  readonly connection: "live" | "offline";
  readonly pendingCount: number;
}

export function DashboardHeader({ connection, dashboard, pendingCount }: DashboardHeaderProps) {
  const { boards, tournament } = dashboard;
  const winner = tournamentWinner(dashboard);
  const free = boards.filter((slot) => slot.state === "FREE").length;
  const blocked = boards.filter((slot) => slot.state === "BLOCKED").length;
  const share =
    tournament.totalMatches === 0
      ? 0
      : Math.round((tournament.playedMatches / tournament.totalMatches) * 100);

  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-numerals text-headline font-bold text-wedge-900">
              {tournament.name}
            </h1>
          </div>
          <p className="mt-1.5 font-plate text-body text-sisal-500">
            {tournament.stageLabel} · {calendarDate(tournament.startsAt)} ·{" "}
            {tournament.startingScore} {inRuleLabel(tournament.inRule)} ·{" "}
            {outRuleLabel(tournament.outRule)}
            {winner !== null ? (
              <>
                {" · "}
                <span className="font-semibold text-wedge-900">Turniersieg: {winner}</span>
              </>
            ) : null}
          </p>
        </div>

        <dl className="flex flex-wrap items-start gap-x-7 gap-y-2">
          <div>
            <SheetLabel as="dt">Zustand</SheetLabel>
            <dd className="mt-1 font-plate text-body font-semibold text-wedge-900">
              {statusLabel(tournament.status)}
            </dd>
          </div>
          <div>
            <SheetLabel as="dt">Version</SheetLabel>
            <dd className="mt-1 font-numerals text-title-sm font-bold tabular text-wedge-900">
              {tournament.version}
            </dd>
          </div>
          <div>
            <SheetLabel as="dt">Stand</SheetLabel>
            <dd className="mt-1 font-numerals text-title-sm font-bold tabular text-wedge-900">
              {clockTime(dashboard.generatedAt)}
            </dd>
          </div>
          <div>
            <SheetLabel as="dt">Verbindung</SheetLabel>
            <dd className="mt-1.5">
              {connection === "live" ? (
                <StateTag label="steht" tone="free" />
              ) : (
                <StateTag
                  label={
                    pendingCount === 0
                      ? "offline"
                      : `offline · ${pendingCount} Befehl${pendingCount === 1 ? "" : "e"} wartet`
                  }
                  tone="conflict"
                />
              )}
            </dd>
          </div>
        </dl>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div
          aria-hidden="true"
          className="h-1.5 w-full max-w-md border border-sisal-400 bg-sisal-50 sm:w-64"
        >
          <div className="h-full bg-ring-green" style={{ width: `${share}%` }} />
        </div>
        <p className="font-plate text-body text-sisal-500">
          <span className="font-numerals text-counter font-bold tabular text-wedge-900">
            {tournament.playedMatches}
          </span>{" "}
          von{" "}
          <span className="font-numerals text-counter font-bold tabular text-wedge-900">
            {tournament.totalMatches}
          </span>{" "}
          Matches gespielt
        </p>
        <p className="flex items-center gap-4">
          <StateTag label={`${free} frei`} tone="free" />
          <StateTag label={`${boards.length - free - blocked} im Spiel`} tone="live" />
          {blocked > 0 ? <StateTag label={`${blocked} gesperrt`} tone="blocked" /> : null}
        </p>
      </div>
      <Rule />
    </header>
  );
}
