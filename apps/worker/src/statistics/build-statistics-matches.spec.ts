import { describe, expect, it } from "vitest";

import { buildStatisticsMatches } from "./build-statistics-matches.js";

const completedAt = new Date("2026-09-03T20:00:00.000Z");

const singles = {
  matches: [{ id: "match-1", winnerSeat: 1, completedAt, outRule: "DOUBLE" }],
  participants: [
    { matchId: "match-1", seat: 1, playerId: "home", displayName: "Heim", legsWon: 2 },
    { matchId: "match-1", seat: 2, playerId: "away", displayName: "Gast", legsWon: 1 },
  ],
  legs: [
    { id: "leg-1", matchId: "match-1", winnerSeat: 1 },
    { id: "leg-2", matchId: "match-1", winnerSeat: 2 },
    { id: "leg-3", matchId: "match-1", winnerSeat: 1 },
  ],
  visits: [
    {
      matchId: "match-1",
      legId: "leg-1",
      throwerPlayerId: "home",
      appliedPoints: 180,
      dartsThrown: 3,
      checkoutAttempts: 0,
      outcome: "SCORED",
      revertedAt: null,
    },
  ],
};

describe("buildStatisticsMatches", () => {
  it("wertet ein Einzel mit beiden Sitzen", () => {
    const result = buildStatisticsMatches(singles);

    expect(result).toHaveLength(1);
    expect(result[0]?.winnerPlayerId).toBe("home");
    expect(result[0]?.participants.map((participant) => participant.playerId)).toEqual([
      "home",
      "away",
    ]);
    expect(result[0]?.participants[0]?.setsWon).toBe(1);
    expect(result[0]?.participants[1]?.setsWon).toBe(0);
    expect(result[0]?.legs.map((leg) => leg.winnerPlayerId)).toEqual([
      "home",
      "away",
      "home",
    ]);
    expect(result[0]?.visits).toHaveLength(1);
  });

  it("verwirft ein Doppel, statt zwei Personen derselben Seite gegeneinander zu werten", () => {
    const result = buildStatisticsMatches({
      ...singles,
      participants: [
        { matchId: "match-1", seat: 1, playerId: "home-a", displayName: "Heim A", legsWon: 2 },
        { matchId: "match-1", seat: 1, playerId: "home-b", displayName: "Heim B", legsWon: 2 },
        { matchId: "match-1", seat: 2, playerId: "away-a", displayName: "Gast A", legsWon: 1 },
        { matchId: "match-1", seat: 2, playerId: "away-b", displayName: "Gast B", legsWon: 1 },
      ],
    });

    expect(result).toEqual([]);
  });

  it("verwirft ein Match ohne zweiten Sitz", () => {
    const result = buildStatisticsMatches({
      ...singles,
      participants: [singles.participants[0]!],
    });

    expect(result).toEqual([]);
  });

  it("verwirft ein Match, dessen Siegersitz keine Person traegt", () => {
    const result = buildStatisticsMatches({
      ...singles,
      matches: [{ id: "match-1", winnerSeat: 3, completedAt, outRule: "DOUBLE" }],
    });

    expect(result).toEqual([]);
  });

  it("laesst ein Leg ohne Siegersitz ohne Person stehen", () => {
    const result = buildStatisticsMatches({
      ...singles,
      legs: [{ id: "leg-1", matchId: "match-1", winnerSeat: null }],
    });

    expect(result[0]?.legs[0]?.winnerPlayerId).toBeNull();
  });

  it("ordnet Legs und Visits ihrem eigenen Match zu", () => {
    const result = buildStatisticsMatches({
      matches: [
        { id: "match-1", winnerSeat: 1, completedAt, outRule: "DOUBLE" },
        { id: "match-2", winnerSeat: 2, completedAt, outRule: "DOUBLE" },
      ],
      participants: [
        ...singles.participants,
        { matchId: "match-2", seat: 1, playerId: "home", displayName: "Heim", legsWon: 0 },
        { matchId: "match-2", seat: 2, playerId: "away", displayName: "Gast", legsWon: 2 },
      ],
      legs: [
        { id: "leg-1", matchId: "match-1", winnerSeat: 1 },
        { id: "leg-9", matchId: "match-2", winnerSeat: 2 },
      ],
      visits: singles.visits,
    });

    expect(result).toHaveLength(2);
    expect(result[1]?.legs.map((leg) => leg.id)).toEqual(["leg-9"]);
    expect(result[1]?.visits).toEqual([]);
  });
});
