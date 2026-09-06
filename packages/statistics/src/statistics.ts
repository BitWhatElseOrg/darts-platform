export interface StatisticsParticipant { readonly playerId: string; readonly displayName: string; readonly legsWon: number; readonly setsWon: number }
export interface StatisticsLeg { readonly id: string; readonly winnerPlayerId: string | null }
export interface StatisticsVisit { readonly legId: string; readonly playerId: string; readonly appliedPoints: number; readonly dartsThrown: number; readonly checkoutAttempts: number; readonly outcome: "SCORED" | "BUST" | "LEG_WON" | "SET_WON" | "MATCH_WON"; readonly reverted: boolean }
export interface StatisticsMatch {
  readonly id: string;
  readonly completedAt: Date;
  /**
   * Die Ausgangsregel des Matches (`matches.out_rule`). Unter `SINGLE`
   * (Reglement 1.1, Klasse C: 501 SO) gibt es keinen Doppelversuch: die
   * Scoring Engine liefert dort per Konstruktion 0 Versuche
   * (`checkoutAttemptsFromDarts`), eine Checkout-Quote ist fachlich nicht
   * definiert. Solche Matches zaehlen deshalb nicht in die Checkout-Kennzahlen.
   */
  readonly outRule: "SINGLE" | "DOUBLE" | "MASTER";
  readonly winnerPlayerId: string;
  readonly participants: readonly [StatisticsParticipant, StatisticsParticipant];
  readonly legs: readonly StatisticsLeg[];
  readonly visits: readonly StatisticsVisit[];
}

export interface CareerStatistics {
  readonly matchesPlayed: number; readonly wins: number; readonly losses: number;
  readonly threeDartAverage: number; readonly firstNineAverage: number;
  /**
   * Die drei Checkout-Kennzahlen sind `null`, wenn keine einzige gewertete
   * Aufnahme aus einem Match mit Doppel- oder Master-Out stammt — „nicht
   * anwendbar", nicht „null Checkouts". Siehe DATABASE_SCHEMA.md, Abschnitt 10.
   */
  readonly checkoutPercentage: number | null;
  readonly checkoutAttempts: number | null;
  readonly checkouts: number | null;
  readonly oneEighties: number; readonly highFinish: number; readonly bestLeg: number | null; readonly dartsPerLeg: number;
}

export interface MatchHistoryEntry { readonly matchId: string; readonly playedAt: Date; readonly opponentPlayerId: string; readonly opponentDisplayName: string; readonly won: boolean; readonly legsWon: number; readonly legsLost: number; readonly setsWon: number; readonly setsLost: number; readonly threeDartAverage: number }
export interface HeadToHeadEntry { readonly opponentPlayerId: string; readonly opponentDisplayName: string; readonly matchesPlayed: number; readonly wins: number; readonly losses: number }
export interface RankingHistoryEntry { readonly matchId: string; readonly recordedAt: Date; readonly rating: number }
export interface PlayerStatisticsAggregate { readonly career: CareerStatistics; readonly matchHistory: readonly MatchHistoryEntry[]; readonly headToHead: readonly HeadToHeadEntry[]; readonly rankingHistory: readonly RankingHistoryEntry[] }

const rounded = (value: number): number => Math.round(value * 100) / 100;
const average = (points: number, darts: number): number => darts === 0 ? 0 : rounded(points / darts * 3);

/**
 * Elo-Parameter des Rankingverlaufs. `RATING_K` ist der Ausschlag je Match,
 * `RATING_START` die Bewertung einer Person ohne Historie.
 */
const RATING_K = 24;
const RATING_START = 1_500;

/**
 * Reihenfolge der Matches. Sie entscheidet über jede Bewertung, muss also
 * eindeutig sein: nach Abschlusszeitpunkt, bei Gleichstand nach Id. Der
 * Vergleich läuft über Code-Units statt `localeCompare` — eine ICU-Kollation
 * kann je nach Laufzeit anders sortieren, und Server, Worker und Test müssen
 * dieselbe Zahl liefern.
 */
function compareByCompletion(left: StatisticsMatch, right: StatisticsMatch): number {
  const byTime = left.completedAt.getTime() - right.completedAt.getTime();
  if (byTime !== 0) return byTime;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function calculatePlayerStatistics(playerId: string, matches: readonly StatisticsMatch[]): PlayerStatisticsAggregate {
  const ordered = [...matches].sort(compareByCompletion);
  let totalPoints = 0;
  let totalDarts = 0;
  let firstNinePoints = 0;
  let firstNineDarts = 0;
  let checkoutAttempts = 0;
  let checkouts = 0;
  let checkoutRatedMatches = 0;
  let oneEighties = 0;
  let highFinish = 0;
  const legDarts: number[] = [];
  const history: MatchHistoryEntry[] = [];
  const headToHead = new Map<string, HeadToHeadEntry>();
  const rankingHistory: RankingHistoryEntry[] = [];
  /**
   * Die Bewertung jeder Person, die in dieser Eingabe vorkommt. Beide Seiten
   * werden je Match fortgeschrieben, damit in der Elo-Formel die Bewertung des
   * TATSAECHLICHEN Gegners steht und nicht eine feste Zahl.
   *
   * Reichweite, die man kennen muss: die Eingabe enthaelt nur Matches der
   * betrachteten Person. Die Bewertung eines Gegners bewegt sich hier also nur
   * in den gemeinsamen Begegnungen — sie ist keine ligaweite Elo-Zahl. Die
   * gehoert in eine eigene Ranking Engine (ARCHITECTURE §23, ROADMAP Phase 10)
   * und nicht in diese Karriereauswertung.
   */
  const ratings = new Map<string, number>();
  const ratingOf = (id: string): number => ratings.get(id) ?? RATING_START;

  for (const match of ordered) {
    const player = match.participants.find((participant) => participant.playerId === playerId);
    const opponent = match.participants.find((participant) => participant.playerId !== playerId);
    if (player === undefined || opponent === undefined) continue;
    const activeVisits = match.visits.filter((visit) => visit.playerId === playerId && !visit.reverted);
    const matchPoints = activeVisits.reduce((sum, visit) => sum + visit.appliedPoints, 0);
    const matchDarts = activeVisits.reduce((sum, visit) => sum + visit.dartsThrown, 0);
    totalPoints += matchPoints;
    totalDarts += matchDarts;
    // Einheitenbruch, bewusst in Kauf genommen: `checkoutAttempts` ist bei
    // einer Aufnahme OHNE Einzelwuerfe eine Aufnahmenzahl (0 oder 1), bei
    // einer Aufnahme MIT Einzelwuerfen eine Wurfzahl (0 bis 3, abgeleitet in
    // `checkoutAttemptsFromDarts` der Scoring Engine). Diese Summe mischt
    // ueber den Umstellungszeitpunkt hinweg beide Einheiten, und
    // `checkoutPercentage` unten erbt das. Der Zaehler (`checkouts`) bleibt
    // davon unberuehrt, er zaehlt erfolgreiche Checkout-Aufnahmen. Eine
    // Umrechnung der Historie ist unmoeglich: fuer alte Aufnahmen existieren
    // die Wurfdaten nicht. Siehe DATABASE_SCHEMA.md, Abschnitt 10.
    //
    // Dritte Einheit: unter `SINGLE` gibt es keinen Doppelversuch. Solche
    // Matches fliessen gar nicht erst ein; bleibt am Ende kein einziges
    // gewertetes Match uebrig, sind die drei Kennzahlen `null`.
    if (match.outRule !== "SINGLE") {
      checkoutRatedMatches += 1;
      checkoutAttempts += activeVisits.reduce((sum, visit) => sum + visit.checkoutAttempts, 0);
      checkouts += activeVisits.filter((visit) => visit.checkoutAttempts > 0 && visit.outcome.endsWith("WON")).length;
    }
    oneEighties += activeVisits.filter((visit) => visit.appliedPoints === 180 && visit.outcome !== "BUST").length;
    for (const visit of activeVisits.filter((entry) => entry.outcome.endsWith("WON"))) highFinish = Math.max(highFinish, visit.appliedPoints);
    for (const leg of match.legs) {
      const visits = activeVisits.filter((visit) => visit.legId === leg.id);
      let darts = 0;
      for (const visit of visits) {
        if (darts < 9) { firstNinePoints += visit.appliedPoints; firstNineDarts += visit.dartsThrown; }
        darts += visit.dartsThrown;
      }
      if (leg.winnerPlayerId === playerId) legDarts.push(darts);
    }
    const won = match.winnerPlayerId === playerId;
    history.push({ matchId: match.id, playedAt: match.completedAt, opponentPlayerId: opponent.playerId, opponentDisplayName: opponent.displayName, won, legsWon: player.legsWon, legsLost: opponent.legsWon, setsWon: player.setsWon, setsLost: opponent.setsWon, threeDartAverage: average(matchPoints, matchDarts) });
    const previous = headToHead.get(opponent.playerId);
    headToHead.set(opponent.playerId, { opponentPlayerId: opponent.playerId, opponentDisplayName: opponent.displayName, matchesPlayed: (previous?.matchesPlayed ?? 0) + 1, wins: (previous?.wins ?? 0) + (won ? 1 : 0), losses: (previous?.losses ?? 0) + (won ? 0 : 1) });
    const playerRating = ratingOf(playerId);
    const opponentRating = ratingOf(opponent.playerId);
    // Beide Erwartungswerte stehen auf den Bewertungen VOR diesem Match; erst
    // danach wird geschrieben, sonst rechnete die zweite Seite gegen die
    // bereits aktualisierte erste.
    const expected = 1 / (1 + 10 ** ((opponentRating - playerRating) / 400));
    const nextPlayerRating = Math.round(playerRating + RATING_K * ((won ? 1 : 0) - expected));
    const nextOpponentRating = Math.round(opponentRating + RATING_K * ((won ? 0 : 1) - (1 - expected)));
    ratings.set(playerId, nextPlayerRating);
    ratings.set(opponent.playerId, nextOpponentRating);
    rankingHistory.push({ matchId: match.id, recordedAt: match.completedAt, rating: nextPlayerRating });
  }
  const wins = history.filter((match) => match.won).length;
  const completedLegCount = ordered.reduce((sum, match) => sum + match.legs.filter((leg) => leg.winnerPlayerId !== null).length, 0);
  const checkoutApplicable = checkoutRatedMatches > 0;
  const checkoutPercentage = !checkoutApplicable
    ? null
    : checkoutAttempts === 0
      ? 0
      : rounded(checkouts / checkoutAttempts * 100);
  return {
    career: {
      matchesPlayed: history.length, wins, losses: history.length - wins, threeDartAverage: average(totalPoints, totalDarts), firstNineAverage: average(firstNinePoints, firstNineDarts),
      checkoutPercentage,
      checkoutAttempts: checkoutApplicable ? checkoutAttempts : null,
      checkouts: checkoutApplicable ? checkouts : null,
      oneEighties, highFinish, bestLeg: legDarts.length === 0 ? null : Math.min(...legDarts), dartsPerLeg: completedLegCount === 0 ? 0 : rounded(totalDarts / completedLegCount),
    },
    matchHistory: [...history].reverse(),
    headToHead: [...headToHead.values()].sort(
      (left, right) =>
        right.matchesPlayed - left.matchesPlayed ||
        // Kein `localeCompare`: die ICU-Kollation der Laufzeit darf die
        // Reihenfolge einer Domaenenauswertung nicht bestimmen. Die Fläche kann
        // fuer die Anzeige sprachrichtig nachsortieren.
        (left.opponentPlayerId < right.opponentPlayerId ? -1 : left.opponentPlayerId > right.opponentPlayerId ? 1 : 0),
    ),
    rankingHistory,
  };
}
