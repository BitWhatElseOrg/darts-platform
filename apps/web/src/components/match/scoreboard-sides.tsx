"use client";

import type { Dart, MatchStateResponse } from "@darts-platform/schemas";
import { cn, Score } from "@darts-platform/ui";
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
    <div className="grid grid-cols-2 divide-x divide-sisal-300">
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
              // Auf einem 640 px hohen Boardgeraet nahmen die beiden Panels
              // 215 px (34 %) und liessen dem Keypad zu wenig; die knappe
              // Hoehe drueckt deshalb Innenabstand und Zeilenabstand
              // zusammen, ohne eine Angabe zu entfernen (No-Collapse Rule).
              "flex flex-col gap-2 p-4 sm:p-6 [@media(max-height:44rem)]:gap-1 [@media(max-height:44rem)]:p-3",
              isActive ? "bg-ring-green/15 text-chalk" : "bg-sisal-100 text-spider-dim",
            )}
            key={participant.playerId}
          >
            <p className="text-caption">Average {average.toFixed(1)}</p>
            <div className="flex items-baseline gap-3">
              <Score
                aria-label={`${sideNames(participant)}, Restscore`}
                size={isActive ? "display" : "lead"}
                tone={isActive ? "chalk" : "dim"}
              >
                {participant.remaining}
              </Score>
              {/* Ohne Bezeichnung stand hier eine nackte Zahl neben dem
                  Reststand -- sie ist die letzte gewertete Aufnahme dieser
                  Seite und damit genau das, was eine Ruecknahme treffen
                  wuerde. */}
              {lastPoints !== null ? (
                <p aria-label={`Letzte Aufnahme: ${lastPoints} Punkte`} className="font-numerals text-title-sm tabular" title="Letzte Aufnahme">
                  {lastPoints}
                </p>
              ) : null}
            </div>
            <p className="truncate text-body font-semibold" title={sideNames(participant)}>
              {participant.players.map((person, index) => (
                <span key={person.playerId}>
                  {index > 0 ? <span aria-hidden="true"> · </span> : null}
                  <span className={person.isThrowing ? "rounded-full bg-ring-green px-2 text-chalk" : ""}>
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
                        "flex h-11 flex-1 items-center justify-center rounded-lg text-title-sm font-semibold tabular [@media(max-height:44rem)]:h-9",
                        dart === undefined ? "bg-wedge-900 text-spider-dim" : "bg-wedge-800 text-chalk",
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
