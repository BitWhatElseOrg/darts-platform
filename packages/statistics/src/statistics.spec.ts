import { describe, expect, it } from "vitest";
import { calculatePlayerStatistics, type StatisticsMatch } from "./statistics.js";

describe("Spielerstatistiken", () => {
  it("aggregiert Average, First 9, Checkout, 180, High Finish und Best Leg deterministisch", () => {
    const match: StatisticsMatch = {
      id: "m1", completedAt: new Date("2026-01-01T12:00:00Z"), winnerPlayerId: "a",
      outRule: "DOUBLE",
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
      outRule: "DOUBLE",
      participants: [{ playerId: "a", displayName: "Anna", legsWon: 1, setsWon: 1 }, { playerId: "b", displayName: "Beat", legsWon: 0, setsWon: 0 }],
      legs: [{ id: "leg", winnerPlayerId: "a" }],
      visits: [{ legId: "leg", playerId: "a", appliedPoints: 40, dartsThrown: 1, checkoutAttempts: 0, outcome: "MATCH_WON", reverted: false }],
    };
    expect(calculatePlayerStatistics("a", [match]).career).toMatchObject({ checkoutAttempts: 0, checkouts: 0, checkoutPercentage: 0, highFinish: 40 });
  });

  it("weist die Checkout-Kennzahlen unter Single Out als nicht anwendbar aus", () => {
    // Reglement 1.1, Klasse C: 501 SO. Unter Straight Out gibt es keinen
    // Doppelversuch, den man zaehlen koennte -- die Quote ist nicht definiert.
    const match: StatisticsMatch = {
      id: "single-out", completedAt: new Date("2026-02-01T12:00:00Z"), winnerPlayerId: "a",
      outRule: "SINGLE",
      participants: [{ playerId: "a", displayName: "Anna", legsWon: 1, setsWon: 1 }, { playerId: "b", displayName: "Beat", legsWon: 0, setsWon: 0 }],
      legs: [{ id: "l1", winnerPlayerId: "a" }],
      visits: [
        { legId: "l1", playerId: "a", appliedPoints: 180, dartsThrown: 3, checkoutAttempts: 0, outcome: "SCORED", reverted: false },
        { legId: "l1", playerId: "a", appliedPoints: 321, dartsThrown: 3, checkoutAttempts: 0, outcome: "MATCH_WON", reverted: false },
      ],
    };
    const career = calculatePlayerStatistics("a", [match]).career;

    expect(career.checkoutPercentage).toBeNull();
    expect(career.checkoutAttempts).toBeNull();
    expect(career.checkouts).toBeNull();
    // Alles andere bleibt auswertbar.
    expect(career).toMatchObject({ matchesPlayed: 1, wins: 1, oneEighties: 1, highFinish: 321, bestLeg: 6 });
  });

  it("zaehlt nur Aufnahmen aus Matches mit Doppel- oder Master-Out in die Quote", () => {
    const singleOut: StatisticsMatch = {
      id: "single-out", completedAt: new Date("2026-02-01T12:00:00Z"), winnerPlayerId: "a",
      outRule: "SINGLE",
      participants: [{ playerId: "a", displayName: "Anna", legsWon: 1, setsWon: 1 }, { playerId: "b", displayName: "Beat", legsWon: 0, setsWon: 0 }],
      legs: [{ id: "l1", winnerPlayerId: "a" }],
      visits: [{ legId: "l1", playerId: "a", appliedPoints: 40, dartsThrown: 2, checkoutAttempts: 0, outcome: "MATCH_WON", reverted: false }],
    };
    const doubleOut: StatisticsMatch = {
      id: "double-out", completedAt: new Date("2026-02-02T12:00:00Z"), winnerPlayerId: "a",
      outRule: "DOUBLE",
      participants: [{ playerId: "a", displayName: "Anna", legsWon: 1, setsWon: 1 }, { playerId: "b", displayName: "Beat", legsWon: 0, setsWon: 0 }],
      legs: [{ id: "l2", winnerPlayerId: "a" }],
      visits: [{ legId: "l2", playerId: "a", appliedPoints: 40, dartsThrown: 2, checkoutAttempts: 2, outcome: "MATCH_WON", reverted: false }],
    };
    const career = calculatePlayerStatistics("a", [singleOut, doubleOut]).career;

    // Zwei Darts auf ein Finish, ein erfolgreiches Checkout -> 50 %.
    expect(career).toMatchObject({ checkoutAttempts: 2, checkouts: 1, checkoutPercentage: 50 });
  });
});
