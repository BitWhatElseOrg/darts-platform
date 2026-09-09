/**
 * Die Einzelrangliste. Reine Domänenlogik: sie bekommt die gewerteten
 * Einzelslots und gibt die geordnete Rangliste zurück — keine Datenbank,
 * keine Namen. Wertung nach `Reglement A1.6–A1.9`; nur Einzel zählen, Doppel
 * nie (Spec-Entscheid vom 2026-09-02).
 */

export interface PlayerRankingSlot {
  readonly encounterId: string;
  readonly encounterStatus:
    | "DRAFT"
    | "LINEUPS_OPEN"
    | "READY"
    | "RUNNING"
    | "COMPLETED"
    | "CANCELLED";
  readonly matchday: number;
  readonly discipline: "SINGLES" | "DOUBLES";
  readonly status: "WAITING" | "READY" | "IN_PROGRESS" | "COMPLETED" | "WALKOVER" | "CANCELLED";
  /** Reglement A1.7: mögliche Punkte je Einzel sind `2 × legsToWinSet`. */
  readonly legsToWinSet: number;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  /** Über `resolveSlotOccupancy` aufgelöst: genau eine Person bei einem gewerteten Einzel, sonst leer. */
  readonly homePlayerIds: readonly string[];
  readonly awayPlayerIds: readonly string[];
  readonly homeLegs: number;
  readonly awayLegs: number;
}

export interface PlayerRankingInput {
  readonly slots: readonly PlayerRankingSlot[];
}

export interface PlayerRankingRow {
  readonly playerId: string;
  readonly teamId: string;
  readonly otherTeamsCount: number;
  readonly played: number;
  readonly won: number;
  readonly lost: number;
  readonly achievedPoints: number;
  readonly possiblePoints: number;
  readonly hitRate: number;
  readonly rankingPoints: number;
  readonly rank: number;
}

interface Tally {
  played: number;
  won: number;
  lost: number;
  achievedPoints: number;
  possiblePoints: number;
  legsFor: number;
  legsPlayed: number;
  teamCounts: Map<string, { count: number; lastMatchday: number }>;
}

function emptyTally(): Tally {
  return {
    played: 0,
    won: 0,
    lost: 0,
    achievedPoints: 0,
    possiblePoints: 0,
    legsFor: 0,
    legsPlayed: 0,
    teamCounts: new Map(),
  };
}

function bookSide(
  tallies: Map<string, Tally>,
  playerId: string,
  teamId: string,
  matchday: number,
  ownLegs: number,
  opponentLegs: number,
  legsToWinSet: number,
): void {
  const tally = tallies.get(playerId) ?? emptyTally();
  tallies.set(playerId, tally);

  const possible = 2 * legsToWinSet;
  const won = ownLegs > opponentLegs;
  // Reglement A1.7: Sieger erhält mögliche Punkte abzüglich der gegnerischen
  // Sätze, Verlierer die eigenen Sätze — deckungsgleich mit der Tabelle
  // (2:0 -> 4, 2:1 -> 3, 1:2 -> 1, 0:2 -> 0) bei legsToWinSet = 2.
  const achieved = won ? possible - opponentLegs : ownLegs;

  tally.played += 1;
  if (won) tally.won += 1;
  else tally.lost += 1;
  tally.achievedPoints += achieved;
  tally.possiblePoints += possible;
  tally.legsFor += ownLegs;
  tally.legsPlayed += ownLegs + opponentLegs;

  const teamCount = tally.teamCounts.get(teamId) ?? { count: 0, lastMatchday: 0 };
  teamCount.count += 1;
  teamCount.lastMatchday = Math.max(teamCount.lastMatchday, matchday);
  tally.teamCounts.set(teamId, teamCount);
}

function primaryTeam(tally: Tally): { readonly teamId: string; readonly otherTeamsCount: number } {
  const entries = [...tally.teamCounts.entries()];
  entries.sort(([teamA, a], [teamB, b]) => {
    if (a.count !== b.count) return b.count - a.count;
    if (a.lastMatchday !== b.lastMatchday) return b.lastMatchday - a.lastMatchday;
    return teamA < teamB ? -1 : teamA > teamB ? 1 : 0;
  });
  const [first] = entries;
  if (first === undefined) throw new Error("Player tally without a team.");
  return { teamId: first[0], otherTeamsCount: entries.length - 1 };
}

/**
 * Vergleicht zwei Brüche `a/b` und `c/d` (b, d > 0) ohne Fliesskommarundung.
 * Positiv, wenn `a/b` grösser ist als `c/d`.
 */
function compareFractions(a: number, b: number, c: number, d: number): number {
  return a * d - c * b;
}

interface RankedCandidate {
  readonly playerId: string;
  readonly achievedPoints: number;
  readonly possiblePoints: number;
  readonly won: number;
  readonly played: number;
  readonly legsFor: number;
  readonly legsPlayed: number;
}

/**
 * Prüft, ob zwei Kandidaten in allen fachlichen Rankingkriterien gleich sind,
 * ohne den technischen Tiebreak zu berücksichtigen.
 */
function arePlayersTied(first: RankedCandidate, second: RankedCandidate): boolean {
  const byRankingPoints = compareFractions(
    first.achievedPoints * first.achievedPoints,
    first.possiblePoints,
    second.achievedPoints * second.achievedPoints,
    second.possiblePoints,
  );
  if (byRankingPoints !== 0) return false;

  const byGameQuotient = compareFractions(first.won, first.played, second.won, second.played);
  if (byGameQuotient !== 0) return false;

  const bySetQuotient = compareFractions(
    first.legsFor,
    first.legsPlayed,
    second.legsFor,
    second.legsPlayed,
  );
  return bySetQuotient === 0;
}

/**
 * Reglement A1.9: Ranglistenpunkte, dann Q-Sp., dann Q-Satz. Positiv, wenn
 * `first` vor `second` stehen soll (fachlich besser ist). Rein antisymmetrisch:
 * `compareRows(b, a) === -compareRows(a, b)` für jedes Paar, das macht den
 * finalen `playerId`-Tiebreak unten sicher.
 */
function compareRows(first: RankedCandidate, second: RankedCandidate): number {
  // Ranglistenpunkte = Trefferquote × erzielte Punkte = erzielte² / mögliche.
  const byRankingPoints = compareFractions(
    first.achievedPoints * first.achievedPoints,
    first.possiblePoints,
    second.achievedPoints * second.achievedPoints,
    second.possiblePoints,
  );
  if (byRankingPoints !== 0) return byRankingPoints;

  const byGameQuotient = compareFractions(first.won, first.played, second.won, second.played);
  if (byGameQuotient !== 0) return byGameQuotient;

  const bySetQuotient = compareFractions(
    first.legsFor,
    first.legsPlayed,
    second.legsFor,
    second.legsPlayed,
  );
  if (bySetQuotient !== 0) return bySetQuotient;

  // Rein technischer, stabiler Tiebreak ohne fachliche Bedeutung.
  if (first.playerId === second.playerId) return 0;
  return first.playerId < second.playerId ? 1 : -1;
}

export function calculatePlayerRanking(input: PlayerRankingInput): readonly PlayerRankingRow[] {
  const tallies = new Map<string, Tally>();

  for (const slot of input.slots) {
    if (slot.encounterStatus !== "COMPLETED") continue;
    if (slot.discipline !== "SINGLES") continue;
    if (slot.status !== "COMPLETED" && slot.status !== "WALKOVER") continue;

    const [homePlayerId] = slot.homePlayerIds;
    const [awayPlayerId] = slot.awayPlayerIds;
    if (homePlayerId === undefined || awayPlayerId === undefined) continue;

    bookSide(tallies, homePlayerId, slot.homeTeamId, slot.matchday, slot.homeLegs, slot.awayLegs, slot.legsToWinSet);
    bookSide(tallies, awayPlayerId, slot.awayTeamId, slot.matchday, slot.awayLegs, slot.homeLegs, slot.legsToWinSet);
  }

  const rows = [...tallies.entries()].map(([playerId, tally]) => {
    const { teamId, otherTeamsCount } = primaryTeam(tally);
    return {
      playerId,
      teamId,
      otherTeamsCount,
      played: tally.played,
      won: tally.won,
      lost: tally.lost,
      achievedPoints: tally.achievedPoints,
      possiblePoints: tally.possiblePoints,
      hitRate: tally.possiblePoints === 0 ? 0 : Math.round((tally.achievedPoints / tally.possiblePoints) * 10_000) / 10_000,
      rankingPoints:
        tally.possiblePoints === 0
          ? 0
          : Math.round(((tally.achievedPoints * tally.achievedPoints) / tally.possiblePoints) * 10_000) / 10_000,
      legsFor: tally.legsFor,
      legsPlayed: tally.legsPlayed,
      rank: 0,
    };
  });

  // `compareRows(a, b) > 0` heisst „a ist besser als b"; für eine nach dem
  // besten Rang beginnende Liste muss der Comparator bei besserem `a`
  // negativ werden — daher die vertauschten Argumente.
  const ordered = [...rows].sort((a, b) => compareRows(b, a));

  const ranked: PlayerRankingRow[] = [];
  for (const [index, row] of ordered.entries()) {
    const previous = ordered[index - 1];
    const previousRank = ranked[index - 1]?.rank ?? 0;
    const shared = previous !== undefined && arePlayersTied(previous, row);
    const { legsFor: _legsFor, legsPlayed: _legsPlayed, ...rest } = row;
    ranked.push({ ...rest, rank: shared ? previousRank : index + 1 });
  }
  return ranked;
}
