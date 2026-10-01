import type { ClubDuelDashboard } from "@darts-platform/schemas";
import { Rule, SheetLabel, StateTag, Table, Td, Th } from "@darts-platform/ui";

import { roundMatchStateLabel, sideLabel, type ClubSide } from "@/lib/club-duel-view";

import { matchOutcomeText, walkoverState } from "./club-match-outcome";

type FinalMatch = NonNullable<ClubDuelDashboard["finals"]["final"]>;

const nameHeader = "normal-case tracking-normal text-body text-wedge-900";

/**
 * Finalrunde als Kreuztabelle (A-Spieler in Zeilen nach `rankA`, B-Spieler in
 * Spalten nach `rankB`), Rangliste je Verein und die Finalspiele.
 * Noch nicht bestimmte Plätze heissen «{Kürzel} Platz n», damit Kopfzeilen nicht alle
 * gleich «offen» lauten.
 */
export function ClubFinalRound({ clubDuel, names }: {
  readonly clubDuel: ClubDuelDashboard;
  readonly names: ReadonlyMap<string, string>;
}) {
  const { matches } = clubDuel.finalRound;
  const ranks = Array.from({ length: clubDuel.finalRoundSize }, (_, index) => index + 1);
  const sideA = sideLabel(clubDuel, "A");
  const sideB = sideLabel(clubDuel, "B");
  const name = (playerId: string | null) => (playerId === null ? "offen" : (names.get(playerId) ?? "Unbekannt"));

  const headerName = (side: ClubSide, rank: number) => {
    const playerId = matches
      .filter((entry) => (side === "A" ? entry.rankA : entry.rankB) === rank)
      .map((entry) => (side === "A" ? entry.playerAId : entry.playerBId))
      .find((id) => id !== null) ?? null;
    if (playerId !== null) return name(playerId);
    const club = side === "A" ? sideA : sideB;
    return (
      <>
        <abbr aria-hidden="true" className="no-underline" title={club.name}>{club.short}</abbr>
        <span className="sr-only">{club.name}</span> Platz {rank}
      </>
    );
  };

  const cell = (rankA: number, rankB: number) => {
    const match = matches.find((entry) => entry.rankA === rankA && entry.rankB === rankB);
    if (match === undefined) return <Td className="text-center" key={rankB}>–</Td>;
    // Kreuzspiele tragen kein resultType: kampflos heisst beendet, Sieger, keine Legs.
    const walkover = match.status === "COMPLETED" && match.legs === null && match.winnerPlayerId !== null;
    const state = roundMatchStateLabel(match.status);
    return (
      <Td className="text-center" key={rankB}>
        {match.legs !== null || walkover
          ? <span className="font-numerals tabular">{matchOutcomeText(match, walkover, name)}</span>
          : <StateTag label={state.label} tone={state.tone} />}
      </Td>
    );
  };

  const finalLine = (label: string, match: FinalMatch) => {
    const walkover = match.resultType === "WALKOVER";
    const state = walkover ? walkoverState : roundMatchStateLabel(match.status);
    return (
      <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-sisal-300 py-2 font-plate text-body text-wedge-900" key={label}>
        <span className="font-semibold">{label}</span>
        <span className="min-w-0 flex-1 truncate">{name(match.playerAId)} – {name(match.playerBId)}</span>
        <span className="font-numerals tabular">{matchOutcomeText(match, walkover, name)}</span>
        <StateTag label={state.label} tone={state.tone} />
      </li>
    );
  };

  const ranking = (side: ClubSide) => {
    const rows = side === "A" ? clubDuel.finalRound.sideA : clubDuel.finalRound.sideB;
    return (
      <div>
        <SheetLabel as="h3">{sideLabel(clubDuel, side).name}</SheetLabel>
        <Rule className="mt-2" tone="faint" />
        <ol className="mt-2 flex flex-col">
          {rows.map((row) => (
            <li className="flex justify-between gap-3 border-b border-sisal-300 py-1.5 font-plate text-body text-wedge-900" key={row.playerId}>
              <span><span className="font-numerals font-bold">{row.position}.</span> {row.displayName}</span>
              <span className="font-numerals tabular">
                {row.won} {row.won === 1 ? "Sieg" : "Siege"} · Legs {row.legDifference > 0 ? "+" : ""}{row.legDifference}
              </span>
            </li>
          ))}
          {rows.length === 0 ? <li className="py-1.5 font-plate text-caption text-sisal-500">Noch offen.</li> : null}
        </ol>
      </div>
    );
  };

  const { final, thirdPlace } = clubDuel.finals;

  return (
    <div className="flex flex-col gap-6">
      {/* Fokussierbar, damit sich eine breite Tabelle per Tastatur scrollen lässt. */}
      <div aria-label="Kreuztabelle (scrollbar)" className="overflow-x-auto rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green" role="region" tabIndex={0}>
        <Table aria-label="Kreuztabelle">
          {/* Der Name bleibt «Kreuztabelle»; die Legende nennt die Achsen. */}
          <caption className="sr-only">Zeilen: {sideA.name}, Spalten: {sideB.name}</caption>
          <thead>
            <tr>
              {/* Ecke ohne Kopf-Rolle: jeder Zeilen- und Spaltenkopf nennt seinen Verein selbst. */}
              <td aria-hidden="true" className="border-b border-sisal-400 pb-1.5 font-plate text-label font-semibold text-sisal-500">
                <abbr className="no-underline" title={`Zeilen: ${sideA.name}`}>{sideA.short}</abbr>
                {" \\ "}
                <abbr className="no-underline" title={`Spalten: ${sideB.name}`}>{sideB.short}</abbr>
              </td>
              {ranks.map((rank) => <Th className={`text-center ${nameHeader}`} key={rank}>{headerName("B", rank)}</Th>)}
            </tr>
          </thead>
          <tbody>
            {ranks.map((rankA) => (
              <tr key={rankA}>
                <Th className={`border-sisal-300 py-1.5 pr-3 font-semibold ${nameHeader}`} scope="row">{headerName("A", rankA)}</Th>
                {ranks.map((rankB) => cell(rankA, rankB))}
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        {ranking("A")}
        {ranking("B")}
      </div>
      <div>
        <SheetLabel as="h3">Finalspiele</SheetLabel>
        <Rule className="mt-2" tone="faint" />
        {final === null && thirdPlace === null ? (
          <p className="mt-2 font-plate text-caption text-sisal-500">Noch nicht angesetzt.</p>
        ) : (
          <ul className="mt-2 flex flex-col">
            {final !== null ? finalLine("Final", final) : null}
            {thirdPlace !== null ? finalLine("Spiel um Platz 3", thirdPlace) : null}
          </ul>
        )}
      </div>
    </div>
  );
}
