import type { EncounterDetail } from "@darts-platform/schemas";
import { Rule, Score, SheetLabel, StateTag, Wedge } from "@darts-platform/ui";
import Link from "next/link";

import { encounterTally } from "@/lib/encounter-view";
import { encounterOutcomeLabel, encounterStatusLabel, encounterTone } from "@/lib/league-format";
import { calendarDate, clockTime } from "@/lib/tournament-format";

/**
 * Die Frage „wie steht es?" in einem Blick, in der Sprache des Reglements:
 * Punkte, Spiele, Sätze — nicht Slots und Legs.
 */
export function EncounterScoreline({
  encounter,
  organizationId,
}: {
  readonly encounter: EncounterDetail;
  readonly organizationId: string;
}) {
  const tally = encounterTally(encounter);
  const share = tally.total === 0 ? 0 : Math.round((tally.decided / tally.total) * 100);

  return (
    <Wedge as="header" className="p-5" tone="plate">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <p className="font-plate text-caption font-semibold tracking-[0.14em] text-sisal-500 uppercase">
            <Link
              className="underline decoration-sisal-400 decoration-1 underline-offset-4 hover:text-wedge-900"
              href={`/liga/${encounter.competitionId}?organisation=${organizationId}`}
            >
              {encounter.competitionName}
            </Link>{" "}
            · Spieltag {encounter.matchday}
          </p>
          <h1 className="mt-1 font-numerals text-data font-bold text-wedge-900">
            {encounter.homeTeamName} gegen {encounter.awayTeamName}
          </h1>
          <p className="mt-1.5 font-plate text-body text-sisal-500">
            {calendarDate(encounter.scheduledAt)} · {clockTime(encounter.scheduledAt)} Uhr
            {encounter.venue === null ? "" : ` · ${encounter.venue}`}
          </p>
        </div>
        <StateTag
          label={encounterStatusLabel(encounter.status)}
          tone={encounterTone(encounter.status)}
        />
      </div>

      <Rule className="mt-4" />

      <dl className="mt-4 grid gap-5 sm:grid-cols-3">
        <div>
          <SheetLabel as="dt">Punkte</SheetLabel>
          <dd className="mt-1">
            <Score size="lead">
              {encounter.homePoints}:{encounter.awayPoints}
            </Score>
          </dd>
        </div>
        <div>
          <SheetLabel as="dt">Spiele</SheetLabel>
          <dd className="mt-1">
            <Score size="quiet">
              {encounter.homeGames}:{encounter.awayGames}
            </Score>
          </dd>
        </div>
        <div>
          <SheetLabel as="dt">Sätze</SheetLabel>
          <dd className="mt-1">
            <Score size="quiet">
              {encounter.homeLegs}:{encounter.awayLegs}
            </Score>
          </dd>
        </div>
      </dl>

      <div className="mt-5">
        <p className="font-plate text-body text-wedge-900">
          {tally.decided} von {tally.total} Spielen entschieden
          {tally.running > 0
            ? `, ${tally.running} ${tally.running === 1 ? "läuft" : "laufen"}`
            : ""}
          .
        </p>
        <div aria-hidden="true" className="mt-1.5 h-1 w-full border border-sisal-400 bg-sisal-50">
          <div className="h-full bg-ring-green" style={{ width: `${share}%` }} />
        </div>
      </div>

      {encounter.result === null ? null : (
        <p className="mt-5 border-t border-sisal-400 pt-4 font-numerals text-title font-bold text-wedge-900">
          {encounterOutcomeLabel({
            result: encounter.result,
            resultType: encounter.resultType,
          })}
        </p>
      )}
    </Wedge>
  );
}
