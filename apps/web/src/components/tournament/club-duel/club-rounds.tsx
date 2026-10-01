import type { ClubDuelDashboard } from "@darts-platform/schemas";
import { Rule, SheetLabel, StateTag } from "@darts-platform/ui";

import { legsLabel, roundMatchStateLabel } from "@/lib/club-duel-view";

type Round = ClubDuelDashboard["rounds"][number];

/** Quali-Runden: die aktuelle offen, frühere zum Aufklappen (neueste zuerst). */
export function ClubRounds({ clubDuel, names }: {
  readonly clubDuel: ClubDuelDashboard;
  readonly names: ReadonlyMap<string, string>;
}) {
  const current = clubDuel.rounds.find((round) => round.round === clubDuel.currentRound) ?? null;
  const earlier = clubDuel.rounds
    .filter((round) => round.round !== clubDuel.currentRound)
    .sort((left, right) => right.round - left.round);
  const name = (playerId: string | null) => (playerId === null ? "offen" : (names.get(playerId) ?? "Unbekannt"));

  const matchList = (round: Round) => (
    <>
      <ul className="mt-2 flex flex-col">
        {round.matches.map((match) => {
          const state = roundMatchStateLabel(match.status);
          return (
            <li
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-sisal-300 py-2 font-plate text-body text-wedge-900"
              key={match.matchId}
            >
              <span className="min-w-0 flex-1 truncate">{name(match.playerAId)} – {name(match.playerBId)}</span>
              <span className="font-numerals tabular">{legsLabel(match.legs)}</span>
              <StateTag label={state.label} tone={state.tone} />
            </li>
          );
        })}
      </ul>
      {round.pausedPlayerIds.length > 0 ? (
        <p className="mt-2 font-plate text-caption text-sisal-500">
          Pausieren: {round.pausedPlayerIds.map((playerId) => name(playerId)).join(", ")}
        </p>
      ) : null}
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      {current !== null ? (
        <div>
          <h3 className="font-numerals text-title-sm font-bold text-wedge-900">Runde {current.round}</h3>
          {matchList(current)}
        </div>
      ) : (
        <p className="font-plate text-body text-sisal-500">Noch keine Runde gepaart.</p>
      )}
      {earlier.length > 0 ? (
        <div>
          <SheetLabel as="h3">Frühere Runden</SheetLabel>
          <Rule className="mt-2" tone="faint" />
          {earlier.map((round) => (
            <details className="mt-2" key={round.round}>
              <summary className="min-h-11 cursor-pointer rounded-lg py-2.5 font-plate text-body font-semibold text-wedge-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green">
                Runde {round.round}
              </summary>
              {matchList(round)}
            </details>
          ))}
        </div>
      ) : null}
    </div>
  );
}
