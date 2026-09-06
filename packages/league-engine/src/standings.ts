/**
 * Die Ligatabelle. Reine Domänenlogik: sie bekommt die abgeschlossenen
 * Begegnungen und gibt die geordnete Tabelle zurück — keine Datenbank, keine
 * Sortierung nach Namen, damit dieselbe Rechnung im Server, im Worker und im
 * Test identisch läuft. Rangkriterien nach `Reglement A1.5`, Punktevergabe
 * nach `Reglement A1.4`.
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
  /**
   * Reglement A1.4/A1.5, zweites Rangierungskriterium. Die Minuspunkte einer
   * Begegnung sind die Pluspunkte des Gegners: 3:3 bei klarem Ausgang, 1:1 beim
   * Unentschieden, dazu 1 Zusatzpunkt und 1 Minuspunkt aus dem sudden death.
   * Abgeleitet statt aus der Punkteregel gerechnet, damit die Tabelle auch bei
   * abweichender Punktevergabe stimmt.
   */
  readonly minusPoints: number;
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
  minusPoints: number;
  gamesFor: number;
  gamesAgainst: number;
  legsFor: number;
  legsAgainst: number;
}

function emptyTally(): Tally {
  return {
    played: 0, won: 0, drawn: 0, lost: 0, points: 0, minusPoints: 0,
    gamesFor: 0, gamesAgainst: 0, legsFor: 0, legsAgainst: 0,
  };
}

/**
 * Reglement A1.5: Rangierungskriterien in abnehmender Gewichtung — 1. Pluspunkte,
 * 2. Minuspunkte, 3. gewonnene Spiele, 4. verlorene Spiele, 5. gewonnene Sätze,
 * 6. verlorene Sätze. Kriterien, bei denen weniger besser ist, stehen negiert im
 * Schlüssel, damit `compareKeys` durchgehend absteigend vergleicht.
 *
 * Eine Differenz kennt A1.5 an keiner Stelle; `gameDifference` und
 * `legDifference` bleiben Anzeigewerte auf der Zeile und bestimmen keinen Rang.
 *
 * „Sätze" des Reglements sind die Legs dieser Engine: A1.2 spielt jedes Spiel
 * auf zwei Gewinnsätze, A1.3 kommt darum bei 18 Spielen auf höchstens 36 —
 * genau die Zahl, die `legsFor`/`legsAgainst` je Begegnung tragen.
 */
function sortKeys(row: StandingsRow): readonly number[] {
  return [
    row.points,
    -row.minusPoints,
    row.gamesFor,
    -row.gamesAgainst,
    row.legsFor,
    -row.legsAgainst,
  ];
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
        pointsAgainst: encounter.awayPoints,
        gamesFor: encounter.homeGames,
        gamesAgainst: encounter.awayGames,
        legsFor: encounter.homeLegs,
        legsAgainst: encounter.awayLegs,
        outcome: encounter.result === "HOME_WIN" ? "WIN" : encounter.result === "DRAW" ? "DRAW" : "LOSS",
      },
      {
        tally: tallies.get(encounter.awayTeamId),
        points: encounter.awayPoints,
        pointsAgainst: encounter.homePoints,
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
      side.tally.minusPoints += side.pointsAgainst;
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
      minusPoints: tally.minusPoints,
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
