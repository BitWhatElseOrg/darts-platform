import type { StatisticsMatch } from "@darts-platform/statistics";

export interface CompletedMatchRow {
  readonly id: string;
  readonly winnerSeat: number;
  readonly completedAt: Date;
}

export interface ParticipantRow {
  readonly matchId: string;
  readonly seat: number;
  readonly playerId: string;
  readonly displayName: string;
  readonly legsWon: number;
}

export interface LegRow {
  readonly id: string;
  readonly matchId: string;
  readonly winnerSeat: number | null;
}

export interface VisitRow {
  readonly matchId: string;
  readonly legId: string;
  readonly throwerPlayerId: string;
  readonly appliedPoints: number;
  readonly dartsThrown: number;
  readonly checkoutAttempts: number;
  readonly outcome: string;
  readonly revertedAt: Date | null;
}

export interface StatisticsSource {
  readonly matches: readonly CompletedMatchRow[];
  readonly participants: readonly ParticipantRow[];
  readonly legs: readonly LegRow[];
  readonly visits: readonly VisitRow[];
}

type VisitOutcome = "SCORED" | "BUST" | "LEG_WON" | "SET_WON" | "MATCH_WON";

/**
 * Baut die Statistikspiele einer Person.
 *
 * Gewertet wird ausschliesslich das Einzel — erkennbar daran, dass beide
 * Sitze genau eine Person tragen (Spec „Statistik", Reglement Anhang 1). Ein
 * Doppel traegt je Sitz zwei Personen; wuerde es mitgewertet, stuenden zwei
 * Personen derselben Seite als Gegner gegeneinander und ein 701-Doppel
 * verschoebe die Averages aller 501-Einzel.
 */
export function buildStatisticsMatches(source: StatisticsSource): readonly StatisticsMatch[] {
  return source.matches.flatMap((match): StatisticsMatch[] => {
    const participants = source.participants.filter(
      (participant) => participant.matchId === match.id,
    );
    const ofSeat = (seat: number): readonly ParticipantRow[] =>
      participants.filter((participant) => participant.seat === seat);
    const home = ofSeat(1);
    const away = ofSeat(2);
    if (home.length !== 1 || away.length !== 1 || participants.length !== 2) return [];

    const first = home[0];
    const second = away[0];
    if (first === undefined || second === undefined) return [];

    const playerOfSeat = (seat: number | null): string | null => {
      if (seat === 1) return first.playerId;
      if (seat === 2) return second.playerId;
      return null;
    };
    const winnerPlayerId = playerOfSeat(match.winnerSeat);
    if (winnerPlayerId === null) return [];

    return [
      {
        id: match.id,
        completedAt: match.completedAt,
        winnerPlayerId,
        participants: [
          {
            playerId: first.playerId,
            displayName: first.displayName,
            legsWon: first.legsWon,
            setsWon: match.winnerSeat === 1 ? 1 : 0,
          },
          {
            playerId: second.playerId,
            displayName: second.displayName,
            legsWon: second.legsWon,
            setsWon: match.winnerSeat === 2 ? 1 : 0,
          },
        ],
        legs: source.legs
          .filter((leg) => leg.matchId === match.id)
          .map((leg) => ({ id: leg.id, winnerPlayerId: playerOfSeat(leg.winnerSeat) })),
        visits: source.visits
          .filter((visit) => visit.matchId === match.id)
          .map((visit) => ({
            legId: visit.legId,
            playerId: visit.throwerPlayerId,
            appliedPoints: visit.appliedPoints,
            dartsThrown: visit.dartsThrown,
            checkoutAttempts: visit.checkoutAttempts,
            outcome: visit.outcome as VisitOutcome,
            reverted: visit.revertedAt !== null,
          })),
      },
    ];
  });
}
