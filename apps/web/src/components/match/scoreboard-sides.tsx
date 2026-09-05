"use client";

import type { Dart, MatchStateResponse } from "@darts-platform/schemas";
import { cn } from "@darts-platform/ui";
import { dartLabel, threeDartAverage } from "@/lib/scoreboard-view";

type Participant = MatchStateResponse["participants"][number];

/** Eine Seite kann zwei Personen tragen; ihr Name ist beider Name. */
function sideNames(participant: Participant): string {
  return participant.players.map((person) => person.displayName).join(" und ");
}

/** Die letzte gewertete Aufnahme dieser Seite im laufenden Leg, falls vorhanden. */
function lastVisitPoints(match: MatchStateResponse, participant: Participant): number | null {
  const visit = match.visits.find(
    (candidate) =>
      candidate.legNumber === match.currentLegNumber
      && !candidate.reverted
      && participant.players.some((person) => person.playerId === candidate.playerId),
  );
  return visit === undefined ? null : visit.appliedPoints;
}

/**
 * Die zwei Spielerpanels. Die aktive Seite steht in Emerald, die inaktive in
 * Slate; im Doppel stehen beide Namen, die werfende Person als gefülltes
 * Plättchen hervorgehoben. Das Dart-Band (drei Plätze je Seite) erscheint
 * nur im Dart-Modus; ausserhalb der aktiven Seite bleiben seine Plätze
 * immer leere Silhouetten.
 */
export function ScoreboardSides({ match, pendingDarts, showDartBand }: {
  readonly match: MatchStateResponse;
  readonly pendingDarts: readonly Dart[];
  readonly showDartBand: boolean;
}) {
  return (
    <div className="grid grid-cols-2 divide-x divide-slate-800">
      {match.participants.map((participant) => {
        const isActive = participant.isActive && match.status === "IN_PROGRESS";
        const average = threeDartAverage({
          visits: match.visits,
          playerIds: participant.players.map((person) => person.playerId),
          legNumber: match.currentLegNumber,
        });
        const lastPoints = lastVisitPoints(match, participant);
        return (
          <div
            className={cn(
              "flex flex-col gap-2 p-4 sm:p-6",
              isActive ? "bg-emerald-500/15 text-white" : "bg-slate-900 text-slate-400",
            )}
            key={participant.playerId}
          >
            <p className="text-caption">Average {average.toFixed(1)}</p>
            <div className="flex items-baseline gap-3">
              <p
                aria-label={`${sideNames(participant)}, Restscore`}
                className="font-numerals font-bold text-display tabular"
              >
                {participant.remaining}
              </p>
              {lastPoints !== null ? <p className="text-title-sm font-numerals tabular">{lastPoints}</p> : null}
            </div>
            <p className="truncate text-body font-semibold" title={sideNames(participant)}>
              {participant.players.map((person, index) => (
                <span key={person.playerId}>
                  {index > 0 ? <span aria-hidden="true"> · </span> : null}
                  <span className={person.isThrowing ? "rounded-full bg-emerald-500 px-2 text-slate-950" : ""}>
                    {person.displayName}
                    {person.isThrowing ? <span className="sr-only"> (am Wurf)</span> : null}
                  </span>
                </span>
              ))}
            </p>
            {/* Nach dem Matchende steht der Legzähler auf dem nächsten, nie
                begonnenen Satz; dann zählen nur noch die Sätze. */}
            <p className="text-body">
              {match.status === "COMPLETED"
                ? `${participant.setsWon} / ${match.setsToWin} Sets`
                : `${participant.legsWonInSet} / ${match.legsToWin} Legs · ${participant.setsWon} / ${match.setsToWin} Sets`}
            </p>
            {showDartBand ? (
              <div className="mt-auto flex gap-2">
                {[0, 1, 2].map((index) => {
                  const dart = isActive ? pendingDarts[index] : undefined;
                  return (
                    <div
                      className={cn(
                        "flex h-11 flex-1 items-center justify-center rounded-lg text-title-sm font-semibold tabular",
                        dart === undefined ? "bg-slate-800 text-slate-600" : "bg-slate-700 text-white",
                      )}
                      key={index}
                    >
                      {dart === undefined ? null : dartLabel(dart)}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
