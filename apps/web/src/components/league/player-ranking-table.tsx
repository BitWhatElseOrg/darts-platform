"use client";

import { useQuery } from "@tanstack/react-query";
import { competitionPlayerRankingSchema } from "@darts-platform/schemas";
import { Rule, SheetLabel } from "@darts-platform/ui";

import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";

/**
 * Die Einzelrangliste. Gerechnet wird sie im Server (League-Engine);
 * Rangkriterien nach `Reglement A1.9`: Ranglistenpunkte, Quotient der
 * Spiele, Quotient der Sätze. Nur Einzel zählen, keine Doppel.
 */
export function PlayerRankingTable({
  competitionId,
  organizationId,
}: {
  readonly competitionId: string;
  readonly organizationId: string;
}) {
  const rankingQuery = useQuery({
    queryKey: ["player-ranking", organizationId, competitionId],
    queryFn: ({ signal }) =>
      apiRequest({
        path: `/organizations/${organizationId}/competitions/${competitionId}/player-ranking`,
        schema: competitionPlayerRankingSchema,
        signal,
      }),
  });

  const rows = rankingQuery.data?.rows ?? [];

  return (
    <section aria-labelledby="player-ranking-heading" className="mt-9">
      <div className="flex items-baseline justify-between gap-3">
        <SheetLabel as="h2" id="player-ranking-heading">
          Einzelrangliste
        </SheetLabel>
        <span className="shrink-0 font-numerals text-counter font-bold tabular text-sisal-500">
          {rows.length}
        </span>
      </div>
      <Rule className="mt-2" />

      {rankingQuery.isPending ? (
        <p className="mt-4 font-plate text-body text-sisal-500">Rangliste wird geladen …</p>
      ) : rankingQuery.error ? (
        <p className="mt-4 font-plate text-body text-ring-red-deep" role="alert">
          {userFacingErrorMessage(rankingQuery.error)}
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-4 font-plate text-body text-sisal-500">
          Sobald das erste Einzel abgeschlossen ist, stehen die Spielerinnen und Spieler hier.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[42rem] border-collapse">
            <caption className="sr-only">
              Einzelrangliste des Wettbewerbs, geordnet nach Ranglistenpunkten, Spiel- und Satzquotient.
            </caption>
            <thead>
              <tr className="border-b border-sisal-400 text-left font-plate text-caption font-semibold tracking-[0.12em] text-sisal-500 uppercase">
                <th className="py-2 pr-3" scope="col">#</th>
                <th className="py-2 pr-3" scope="col">Person</th>
                <th className="py-2 pr-3" scope="col">Mannschaft</th>
                <th className="py-2 pr-3 text-right" scope="col">Sp</th>
                <th className="py-2 pr-3 text-right" scope="col">S</th>
                <th className="py-2 pr-3 text-right" scope="col">N</th>
                <th className="py-2 pr-3 text-right" scope="col">Quote</th>
                <th className="py-2 text-right" scope="col">Rangl.-Pkt.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr className="border-b border-sisal-300" key={row.playerId}>
                  <td className="py-3 pr-3 font-numerals tabular text-sisal-500">{row.rank}</td>
                  <th className="py-3 pr-3 text-left font-plate text-field font-semibold text-wedge-900" scope="row">
                    {row.playerName}
                  </th>
                  <td className="py-3 pr-3 text-left font-plate text-body text-wedge-900">
                    {row.teamShortName ?? row.teamName}
                    {row.otherTeamsCount > 0 ? (
                      <span className="ml-2 font-plate text-caption text-sisal-500">
                        <span aria-hidden="true">+{row.otherTeamsCount}</span>
                        <span className="sr-only">
                          {" "}
                          und {row.otherTeamsCount}{" "}
                          {row.otherTeamsCount === 1 ? "weitere Mannschaft" : "weitere Mannschaften"}
                        </span>
                      </span>
                    ) : null}
                  </td>
                  <td className="py-3 pr-3 text-right font-numerals tabular text-wedge-900">{row.played}</td>
                  <td className="py-3 pr-3 text-right font-numerals tabular text-wedge-900">{row.won}</td>
                  <td className="py-3 pr-3 text-right font-numerals tabular text-wedge-900">{row.lost}</td>
                  <td className="py-3 pr-3 text-right font-numerals tabular text-wedge-900">
                    {(row.hitRate * 100).toFixed(1)}%
                  </td>
                  <td className="py-3 text-right font-numerals font-bold tabular text-wedge-900">
                    {row.rankingPoints.toFixed(2)}
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
