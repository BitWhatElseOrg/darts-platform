"use client";

import { useQuery } from "@tanstack/react-query";
import { competitionStandingsSchema } from "@darts-platform/schemas";
import { Rule, SheetLabel } from "@darts-platform/ui";

import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";

/**
 * Die Ligatabelle. Gerechnet wird sie im Server (League-Engine); hier steht
 * nur, wie sie aussieht. Die Reihenfolge der Spalten ist die Reihenfolge der
 * Rangkriterien: Punkte, Spieldifferenz, Satzdifferenz.
 */
export function StandingsTable({
  competitionId,
  organizationId,
}: {
  readonly competitionId: string;
  readonly organizationId: string;
}) {
  const standingsQuery = useQuery({
    queryKey: ["standings", organizationId, competitionId],
    queryFn: ({ signal }) =>
      apiRequest({
        path: `/organizations/${organizationId}/competitions/${competitionId}/standings`,
        schema: competitionStandingsSchema,
        signal,
      }),
  });

  const rows = standingsQuery.data?.rows ?? [];

  return (
    <section aria-labelledby="standings-heading" className="mt-9">
      <div className="flex items-baseline justify-between gap-3">
        <SheetLabel as="h2" id="standings-heading">
          Tabelle
        </SheetLabel>
        <span className="shrink-0 font-numerals text-counter font-bold tabular text-sisal-500">
          {rows.length}
        </span>
      </div>
      <Rule className="mt-2" />

      {standingsQuery.isPending ? (
        <p className="mt-4 font-plate text-body text-sisal-500">Tabelle wird geladen …</p>
      ) : standingsQuery.error ? (
        <p className="mt-4 font-plate text-body text-ring-red-deep" role="alert">
          {userFacingErrorMessage(standingsQuery.error)}
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-4 font-plate text-body text-sisal-500">
          Sobald die erste Begegnung angesetzt ist, stehen die Mannschaften hier.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse">
            <caption className="sr-only">
              Tabelle des Wettbewerbs, geordnet nach Punkten, Spiel- und Satzdifferenz.
            </caption>
            <thead>
              <tr className="border-b border-sisal-400 text-left font-plate text-caption font-semibold tracking-[0.12em] text-sisal-500 uppercase">
                <th className="py-2 pr-3" scope="col">#</th>
                <th className="py-2 pr-3" scope="col">Mannschaft</th>
                <th className="py-2 pr-3 text-right" scope="col">Sp</th>
                <th className="py-2 pr-3 text-right" scope="col">S</th>
                <th className="py-2 pr-3 text-right" scope="col">U</th>
                <th className="py-2 pr-3 text-right" scope="col">N</th>
                <th className="py-2 pr-3 text-right" scope="col">Spiele</th>
                <th className="py-2 pr-3 text-right" scope="col">Diff</th>
                <th className="py-2 text-right" scope="col">Punkte</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr className="border-b border-sisal-300" key={row.teamId}>
                  <td className="py-3 pr-3 font-numerals tabular text-sisal-500">{row.rank}</td>
                  <th
                    className="py-3 pr-3 text-left font-plate text-field font-semibold text-wedge-900"
                    scope="row"
                  >
                    {row.teamName}
                    {row.teamShortName === null ? null : (
                      <span className="ml-2 font-plate text-caption text-sisal-500">
                        {row.teamShortName}
                      </span>
                    )}
                  </th>
                  <td className="py-3 pr-3 text-right font-numerals tabular text-wedge-900">
                    {row.played}
                  </td>
                  <td className="py-3 pr-3 text-right font-numerals tabular text-wedge-900">
                    {row.won}
                  </td>
                  <td className="py-3 pr-3 text-right font-numerals tabular text-wedge-900">
                    {row.drawn}
                  </td>
                  <td className="py-3 pr-3 text-right font-numerals tabular text-wedge-900">
                    {row.lost}
                  </td>
                  <td className="py-3 pr-3 text-right font-numerals tabular text-wedge-900">
                    {row.gamesFor}:{row.gamesAgainst}
                  </td>
                  <td className="py-3 pr-3 text-right font-numerals tabular text-wedge-900">
                    {row.gameDifference > 0 ? `+${row.gameDifference}` : row.gameDifference}
                  </td>
                  <td className="py-3 text-right font-numerals font-bold tabular text-wedge-900">
                    {row.points}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
