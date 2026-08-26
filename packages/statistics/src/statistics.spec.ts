import { describe, expect, it } from "vitest";
import { calculatePlayerStatistics, type StatisticsMatch } from "./statistics.js";

describe("Spielerstatistiken", () => {
  it("aggregiert Average, First 9, Checkout, 180, High Finish und Best Leg deterministisch", () => {
    const match: StatisticsMatch = {
      id: "m1", completedAt: new Date("2026-01-01T12:00:00Z"), winnerPlayerId: "a",
      participants: [{ playerId: "a", displayName: "Anna", legsWon: 1, setsWon: 1 }, { playerId: "b", displayName: "Beat", legsWon: 0, setsWon: 0 }],
      legs: [{ id: "l1", winnerPlayerId: "a" }],
      visits: [
        { legId: "l1", playerId: "a", appliedPoints: 180, dartsThrown: 3, checkoutAttempts: 0, outcome: "SCORED", reverted: false },
        { legId: "l1", playerId: "a", appliedPoints: 180, dartsThrown: 3, checkoutAttempts: 0, outcome: "SCORED", reverted: false },
        { legId: "l1", playerId: "a", appliedPoints: 101, dartsThrown: 3, checkoutAttempts: 2, outcome: "MATCH_WON", reverted: false },
      ],
    };
    const result = calculatePlayerStatistics("a", [match]);
    expect(result.career).toMatchObject({ matchesPlayed: 1, wins: 1, threeDartAverage: 153.67, firstNineAverage: 153.67, checkoutPercentage: 50, oneEighties: 2, highFinish: 101, bestLeg: 9, dartsPerLeg: 9 });
    expect(result.headToHead[0]).toMatchObject({ opponentPlayerId: "b", wins: 1 });
    expect(result.rankingHistory[0]?.rating).toBe(1512);
  });

  it("wertet historische Checkouts ohne erfasste Doppelversuche nicht als Quote", () => {
    const match: StatisticsMatch = {
      id: "legacy", completedAt: new Date("2025-01-01T12:00:00Z"), winnerPlayerId: "a",
      participants: [{ playerId: "a", displayName: "Anna", legsWon: 1, setsWon: 1 }, { playerId: "b", displayName: "Beat", legsWon: 0, setsWon: 0 }],
      legs: [{ id: "leg", winnerPlayerId: "a" }],
      visits: [{ legId: "leg", playerId: "a", appliedPoints: 40, dartsThrown: 1, checkoutAttempts: 0, outcome: "MATCH_WON", reverted: false }],
    };
    expect(calculatePlayerStatistics("a", [match]).career).toMatchObject({ checkoutAttempts: 0, checkouts: 0, checkoutPercentage: 0, highFinish: 40 });
  });
});
