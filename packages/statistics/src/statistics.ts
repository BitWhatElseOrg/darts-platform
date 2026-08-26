export interface StatisticsParticipant { readonly playerId: string; readonly displayName: string; readonly legsWon: number; readonly setsWon: number }
export interface StatisticsLeg { readonly id: string; readonly winnerPlayerId: string | null }
export interface StatisticsVisit { readonly legId: string; readonly playerId: string; readonly appliedPoints: number; readonly dartsThrown: number; readonly checkoutAttempts: number; readonly outcome: "SCORED" | "BUST" | "LEG_WON" | "SET_WON" | "MATCH_WON"; readonly reverted: boolean }
export interface StatisticsMatch { readonly id: string; readonly completedAt: Date; readonly winnerPlayerId: string; readonly participants: readonly [StatisticsParticipant, StatisticsParticipant]; readonly legs: readonly StatisticsLeg[]; readonly visits: readonly StatisticsVisit[] }

export interface CareerStatistics {
  readonly matchesPlayed: number; readonly wins: number; readonly losses: number;
  readonly threeDartAverage: number; readonly firstNineAverage: number;
  readonly checkoutPercentage: number; readonly checkoutAttempts: number; readonly checkouts: number;
  readonly oneEighties: number; readonly highFinish: number; readonly bestLeg: number | null; readonly dartsPerLeg: number;
}

export interface MatchHistoryEntry { readonly matchId: string; readonly playedAt: Date; readonly opponentPlayerId: string; readonly opponentDisplayName: string; readonly won: boolean; readonly legsWon: number; readonly legsLost: number; readonly setsWon: number; readonly setsLost: number; readonly threeDartAverage: number }
export interface HeadToHeadEntry { readonly opponentPlayerId: string; readonly opponentDisplayName: string; readonly matchesPlayed: number; readonly wins: number; readonly losses: number }
export interface RankingHistoryEntry { readonly matchId: string; readonly recordedAt: Date; readonly rating: number }
export interface PlayerStatisticsAggregate { readonly career: CareerStatistics; readonly matchHistory: readonly MatchHistoryEntry[]; readonly headToHead: readonly HeadToHeadEntry[]; readonly rankingHistory: readonly RankingHistoryEntry[] }

const rounded = (value: number): number => Math.round(value * 100) / 100;
const average = (points: number, darts: number): number => darts === 0 ? 0 : rounded(points / darts * 3);

export function calculatePlayerStatistics(playerId: string, matches: readonly StatisticsMatch[]): PlayerStatisticsAggregate {
  const ordered = [...matches].sort((left, right) => left.completedAt.getTime() - right.completedAt.getTime());
  let totalPoints = 0;
  let totalDarts = 0;
  let firstNinePoints = 0;
  let firstNineDarts = 0;
  let checkoutAttempts = 0;
  let checkouts = 0;
  let oneEighties = 0;
  let highFinish = 0;
  const legDarts: number[] = [];
  const history: MatchHistoryEntry[] = [];
  const headToHead = new Map<string, HeadToHeadEntry>();
  const rankingHistory: RankingHistoryEntry[] = [];
  let rating = 1_500;

  for (const match of ordered) {
    const player = match.participants.find((participant) => participant.playerId === playerId);
    const opponent = match.participants.find((participant) => participant.playerId !== playerId);
    if (player === undefined || opponent === undefined) continue;
    const activeVisits = match.visits.filter((visit) => visit.playerId === playerId && !visit.reverted);
    const matchPoints = activeVisits.reduce((sum, visit) => sum + visit.appliedPoints, 0);
    const matchDarts = activeVisits.reduce((sum, visit) => sum + visit.dartsThrown, 0);
    totalPoints += matchPoints;
    totalDarts += matchDarts;
    checkoutAttempts += activeVisits.reduce((sum, visit) => sum + visit.checkoutAttempts, 0);
    checkouts += activeVisits.filter((visit) => visit.checkoutAttempts > 0 && visit.outcome.endsWith("WON")).length;
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
    const expected = 1 / (1 + 10 ** ((1_500 - rating) / 400));
    rating = Math.round(rating + 24 * ((won ? 1 : 0) - expected));
    rankingHistory.push({ matchId: match.id, recordedAt: match.completedAt, rating });
  }
  const wins = history.filter((match) => match.won).length;
  const completedLegCount = ordered.reduce((sum, match) => sum + match.legs.filter((leg) => leg.winnerPlayerId !== null).length, 0);
  return {
    career: { matchesPlayed: history.length, wins, losses: history.length - wins, threeDartAverage: average(totalPoints, totalDarts), firstNineAverage: average(firstNinePoints, firstNineDarts), checkoutPercentage: checkoutAttempts === 0 ? 0 : rounded(checkouts / checkoutAttempts * 100), checkoutAttempts, checkouts, oneEighties, highFinish, bestLeg: legDarts.length === 0 ? null : Math.min(...legDarts), dartsPerLeg: completedLegCount === 0 ? 0 : rounded(totalDarts / completedLegCount) },
    matchHistory: [...history].reverse(),
    headToHead: [...headToHead.values()].sort((left, right) => right.matchesPlayed - left.matchesPlayed || left.opponentDisplayName.localeCompare(right.opponentDisplayName)),
    rankingHistory,
  };
}
