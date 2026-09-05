/**
 * Die Ligatabelle. Reine Domänenlogik: sie bekommt die abgeschlossenen
 * Begegnungen und gibt die geordnete Tabelle zurück — keine Datenbank, keine
 * Sortierung nach Namen, damit dieselbe Rechnung im Server, im Worker und im
 * Test identisch läuft.
 */

export type StandingsEncounterStatus =
  | "DRAFT"
  | "LINEUPS_OPEN"
  | "READY"
  | "RUNNING"
  | "COMPLETED"
  | "CANCELLED";

export interface StandingsEncounter {
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly status: StandingsEncounterStatus;
  readonly result: "HOME_WIN" | "AWAY_WIN" | "DRAW" | null;
  readonly homePoints: number;
  readonly awayPoints: number;
  readonly homeGames: number;
  readonly awayGames: number;
  readonly homeLegs: number;
  readonly awayLegs: number;
}

export interface StandingsRow {
  readonly teamId: string;
  readonly played: number;
  readonly won: number;
  readonly drawn: number;
  readonly lost: number;
  readonly points: number;
  readonly gamesFor: number;
  readonly gamesAgainst: number;
  readonly gameDifference: number;
  readonly legsFor: number;
  readonly legsAgainst: number;
  readonly legDifference: number;
  readonly rank: number;
}

export interface StandingsInput {
  readonly teamIds: readonly string[];
  readonly encounters: readonly StandingsEncounter[];
}

interface Tally {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  points: number;
  gamesFor: number;
  gamesAgainst: number;
  legsFor: number;
  legsAgainst: number;
}

function emptyTally(): Tally {
  return {
    played: 0, won: 0, drawn: 0, lost: 0, points: 0,
    gamesFor: 0, gamesAgainst: 0, legsFor: 0, legsAgainst: 0,
  };
}

/** Die Reihenfolge der Sortierschlüssel ist zugleich die Reihenfolge der Rangkriterien. */
function sortKeys(row: StandingsRow): readonly number[] {
  return [row.points, row.gameDifference, row.gamesFor, row.legDifference, row.legsFor];
}

function compareKeys(first: StandingsRow, second: StandingsRow): number {
  const left = sortKeys(first);
  const right = sortKeys(second);
  for (const [index, value] of left.entries()) {
    const other = right[index] ?? 0;
    if (value !== other) return other - value;
  }
  return 0;
}

export function calculateStandings(input: StandingsInput): readonly StandingsRow[] {
  const tallies = new Map<string, Tally>(input.teamIds.map((teamId) => [teamId, emptyTally()]));

  for (const encounter of input.encounters) {
    if (encounter.status !== "COMPLETED" || encounter.result === null) continue;
    const sides = [
      {
        tally: tallies.get(encounter.homeTeamId),
        points: encounter.homePoints,
        gamesFor: encounter.homeGames,
        gamesAgainst: encounter.awayGames,
        legsFor: encounter.homeLegs,
        legsAgainst: encounter.awayLegs,
        outcome: encounter.result === "HOME_WIN" ? "WIN" : encounter.result === "DRAW" ? "DRAW" : "LOSS",
      },
      {
        tally: tallies.get(encounter.awayTeamId),
        points: encounter.awayPoints,
        gamesFor: encounter.awayGames,
        gamesAgainst: encounter.homeGames,
        legsFor: encounter.awayLegs,
        legsAgainst: encounter.homeLegs,
        outcome: encounter.result === "AWAY_WIN" ? "WIN" : encounter.result === "DRAW" ? "DRAW" : "LOSS",
      },
    ] as const;

    for (const side of sides) {
      // Begegnungen fremder Mannschaften zählen für diese Tabelle nicht.
      if (side.tally === undefined) continue;
      side.tally.played += 1;
      side.tally.points += side.points;
      side.tally.gamesFor += side.gamesFor;
      side.tally.gamesAgainst += side.gamesAgainst;
      side.tally.legsFor += side.legsFor;
      side.tally.legsAgainst += side.legsAgainst;
      if (side.outcome === "WIN") side.tally.won += 1;
      else if (side.outcome === "DRAW") side.tally.drawn += 1;
      else side.tally.lost += 1;
    }
  }

  const rows = input.teamIds.map((teamId) => {
    const tally = tallies.get(teamId) ?? emptyTally();
    return {
      teamId,
      played: tally.played,
      won: tally.won,
      drawn: tally.drawn,
      lost: tally.lost,
      points: tally.points,
      gamesFor: tally.gamesFor,
      gamesAgainst: tally.gamesAgainst,
      gameDifference: tally.gamesFor - tally.gamesAgainst,
      legsFor: tally.legsFor,
      legsAgainst: tally.legsAgainst,
      legDifference: tally.legsFor - tally.legsAgainst,
      rank: 0,
    } satisfies StandingsRow;
  });

  const ordered = [...rows].sort(compareKeys);

  // Gleiche Bilanz, gleicher Rang; der nächste Rang überspringt die Gleichstände.
  const ranked: StandingsRow[] = [];
  for (const [index, row] of ordered.entries()) {
    const previous = ordered[index - 1];
    const previousRank = ranked[index - 1]?.rank ?? 0;
    const shared = previous !== undefined && compareKeys(previous, row) === 0;
    ranked.push({ ...row, rank: shared ? previousRank : index + 1 });
  }
  return ranked;
}
