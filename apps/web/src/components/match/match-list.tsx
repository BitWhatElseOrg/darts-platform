"use client";

import Link from "next/link";

import type { MatchStateResponse } from "@darts-platform/schemas";
import { cn } from "@darts-platform/ui";

/** Eine Seite kann zwei Personen tragen; ihr Name ist beider Name. */
function sideNames(participant: MatchStateResponse["participants"][number]): string {
  return participant.players.map((person) => person.displayName).join(" und ");
}

function byLiveFirst(left: MatchStateResponse, right: MatchStateResponse): number {
  return Number(right.status === "IN_PROGRESS") - Number(left.status === "IN_PROGRESS");
}

export function MatchList({
  matches,
  organizationId,
  variant,
  limit,
}: {
  readonly matches: readonly MatchStateResponse[];
  readonly organizationId: string;
  readonly variant: "compact" | "full";
  readonly limit?: number;
}) {
  const ordered = [...matches].sort(byLiveFirst);
  const pool = variant === "compact" ? ordered.filter((match) => match.status === "IN_PROGRESS") : ordered;
  const visible = limit === undefined ? pool : pool.slice(0, limit);
  const hidden = pool.length - visible.length;

  if (pool.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-400">
        {variant === "compact"
          ? "Gerade läuft kein Match."
          : "Noch kein Match gespielt. Starte oben das erste."}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <ul className={cn("grid gap-2", variant === "full" && "sm:grid-cols-2 xl:grid-cols-3")}>
        {visible.map((match) => {
          const isLive = match.status === "IN_PROGRESS";
          const score = `${match.participants[0].legsWon}:${match.participants[1].legsWon}`;
          return (
            <li className="min-w-0" key={match.id}>
              <Link
                className={cn(
                  "flex min-h-12 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm transition",
                  isLive
                    ? "border-emerald-400/60 bg-emerald-400/5 text-white hover:border-emerald-400"
                    : "border-slate-800 text-slate-400 hover:border-slate-600",
                )}
                href={`/matches/${match.id}?organisation=${organizationId}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {sideNames(match.participants[0])} <span className="text-slate-500">–</span>{" "}
                    {sideNames(match.participants[1])}
                  </span>
                  <span className="block truncate text-xs text-slate-500">
                    {match.boardName ?? "Kein Board"}
                    {score === "0:0" ? "" : <span className="tabular"> · {score}</span>}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 text-xs font-semibold tracking-wider uppercase",
                    isLive ? "text-emerald-300" : "text-slate-500",
                  )}
                >
                  {isLive ? "läuft" : "beendet"}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {hidden > 0 ? (
        <p className="text-xs text-slate-500">und {hidden} weitere</p>
      ) : null}
    </div>
  );
}
