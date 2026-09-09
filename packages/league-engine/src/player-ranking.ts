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
  /**
   * Reglement A1.2/A1.7 ist ausschliesslich für ein Einzel definiert, das
   * innerhalb eines einzigen Satzes entschieden wird — das ist, was A1.7
   * „Satz" nennt, ist in dieser Engine ein `leg`, und „2 Gewinnsätze" ist
   * `legsToWinSet`. Für `setsToWin !== 1` hat die Punktetabelle keine
   * fachliche Bedeutung; solche Slots werden verworfen (siehe Filter unten).
   */
  readonly setsToWin: number;
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
 * Reglement A1.9: Ranglistenpunkte, dann Q-Sp., dann Q-Satz. Positiv, wenn
 * `first` vor `second` stehen soll (fachlich besser ist), 0 bei einem
 * echten Gleichstand aller drei Kriterien. Trägt bewusst keinen technischen
 * Tiebreak — der lebt ausschliesslich im `.sort(...)`-Aufruf unten, damit
 * `compareRows(...) === 0` weiterhin einen echten fachlichen Gleichstand
 * erkennt (dasselbe Idiom wie `compareKeys`/`calculateStandings` in
 * `standings.ts`).
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

  return compareFractions(first.legsFor, first.legsPlayed, second.legsFor, second.legsPlayed);
}

export function calculatePlayerRanking(input: PlayerRankingInput): readonly PlayerRankingRow[] {
  const tallies = new Map<string, Tally>();

  for (const slot of input.slots) {
    if (slot.encounterStatus !== "COMPLETED") continue;
    if (slot.discipline !== "SINGLES") continue;
    if (slot.status !== "COMPLETED" && slot.status !== "WALKOVER") continue;
    // Reglement A1.2/A1.7 ist nur für ein innerhalb eines Satzes entschiedenes
    // Einzel definiert (`setsToWin === 1`, siehe `PlayerRankingSlot.setsToWin`).
    // Für jeden anderen Wert hat die Punktetabelle keine fachliche Bedeutung —
    // kein Skalierungsfehler, sondern ein von der Regel nicht abgedeckter Fall.
    // Die realen Web-UI-Vorlagen (`buildEncounterTemplate`/`vfcTemplateOptions`)
    // setzen `setsToWin` immer auf 1, aber die API ist mandantenfähig und lässt
    // Werte bis 11 zu (`competitionSlotInputSchema`), darum die explizite Prüfung.
    if (slot.setsToWin !== 1) continue;

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
    };
  });

  // `compareRows(a, b) > 0` heisst „a ist besser als b"; für eine nach dem
  // besten Rang beginnende Liste muss der Comparator bei besserem `a`
  // negativ werden — daher die vertauschten Argumente. Bei einem echten
  // Gleichstand (compareRows === 0) sorgt der `playerId`-Tiebreak für eine
  // stabile, aber rein technische Reihenfolge ohne fachliche Bedeutung.
  const ordered = [...rows].sort((a, b) => {
    const business = compareRows(b, a);
    if (business !== 0) return business;
    if (a.playerId === b.playerId) return 0;
    return a.playerId < b.playerId ? -1 : 1;
  });

  const ranked: PlayerRankingRow[] = [];
  for (const [index, row] of ordered.entries()) {
    const previous = ordered[index - 1];
    const previousRank = ranked[index - 1]?.rank ?? 0;
    const shared = previous !== undefined && compareRows(previous, row) === 0;
    ranked.push({
      playerId: row.playerId,
      teamId: row.teamId,
      otherTeamsCount: row.otherTeamsCount,
      played: row.played,
      won: row.won,
      lost: row.lost,
      achievedPoints: row.achievedPoints,
      possiblePoints: row.possiblePoints,
      hitRate: row.hitRate,
      rankingPoints: row.rankingPoints,
      rank: shared ? previousRank : index + 1,
    });
  }
  return ranked;
}
