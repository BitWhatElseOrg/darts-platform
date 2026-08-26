import { describe, expect, it } from "vitest";

import {
  TournamentValidationError,
  allocateGroups,
  calculateGroupStandings,
  createTournamentPlan,
  generateKnockoutBracket,
  generateRoundRobin,
  previewTournamentStructure,
} from "./tournament";

const participants = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    playerId: `player-${index + 1}`,
    seed: index + 1,
  }));

describe("round robin", () => {
  it("generates every pairing once for an even player count", () => {
    const matches = generateRoundRobin(participants(4).map((entry) => entry.playerId));
    expect(matches).toHaveLength(6);
    expect(new Set(matches.map((match) => [match.playerOneId, match.playerTwoId].sort().join(":"))).size).toBe(6);
    expect(new Set(matches.map((match) => match.round))).toEqual(new Set([1, 2, 3]));
  });

  it("handles an odd player count without duplicate players per round", () => {
    const matches = generateRoundRobin(participants(5).map((entry) => entry.playerId));
    expect(matches).toHaveLength(10);
    for (const round of [1, 2, 3, 4, 5]) {
      const players = matches
        .filter((match) => match.round === round)
        .flatMap((match) => [match.playerOneId, match.playerTwoId]);
      expect(new Set(players).size).toBe(players.length);
    }
  });
});

describe("group allocation", () => {
  it("allocates the reference field into eight balanced seeded groups", () => {
    const groups = allocateGroups({ participants: participants(32), groupCount: 8, seeding: "SEEDED" });
    expect(groups).toHaveLength(8);
    expect(groups.every((group) => group.participants.length === 4)).toBe(true);
    expect(groups.map((group) => group.participants[0]?.seed)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(groups.flatMap((group) => group.participants.map((entry) => entry.playerId))).size).toBe(32);
  });
});

describe("single elimination", () => {
  for (const size of [8, 16, 32, 64] as const) {
    it(`generates a valid ${size}-player dependency graph`, () => {
      const matches = generateKnockoutBracket({
        stageKey: "ko",
        participants: participants(size).map((entry) => ({ type: "PLAYER" as const, playerId: entry.playerId })),
        bracketSize: size,
      });
      expect(matches).toHaveLength(size - 1);
      const keys = new Set(matches.map((match) => match.key));
      for (const match of matches) {
        for (const reference of [match.participantOne, match.participantTwo]) {
          if (reference?.type === "MATCH_WINNER") expect(keys.has(reference.matchKey)).toBe(true);
        }
      }
    });
  }

  it("represents byes explicitly and never duplicates a player", () => {
    const matches = generateKnockoutBracket({
      stageKey: "ko",
      participants: participants(6).map((entry) => ({ type: "PLAYER" as const, playerId: entry.playerId })),
      bracketSize: 8,
    });
    expect(matches.filter((match) => match.state === "BYE")).toHaveLength(2);
    const firstRoundPlayers = matches
      .filter((match) => match.round === 1)
      .flatMap((match) => [match.participantOne, match.participantTwo])
      .flatMap((reference) => (reference?.type === "PLAYER" ? [reference.playerId] : []));
    expect(new Set(firstRoundPlayers).size).toBe(6);
  });
});

describe("combined tournament", () => {
  it("creates 48 group matches and a 16-player knockout for the reference scenario", () => {
    const plan = createTournamentPlan({
      format: "GROUPS_THEN_KNOCKOUT",
      participants: participants(32),
      groupCount: 8,
      qualifyPerGroup: 2,
      knockoutSize: 16,
      seeding: "SEEDED",
    });
    expect(plan.groups).toHaveLength(8);
    expect(plan.matches.filter((match) => match.stageType === "GROUP")).toHaveLength(48);
    expect(plan.matches.filter((match) => match.stageType === "SINGLE_ELIMINATION")).toHaveLength(15);
    expect(plan.matches).toHaveLength(63);
  });

  it("rejects duplicate participants and mismatched knockout capacity", () => {
    expect(() => generateRoundRobin(["one", "one"])).toThrow(TournamentValidationError);
    expect(() =>
      createTournamentPlan({
        format: "GROUPS_THEN_KNOCKOUT",
        participants: participants(8),
        groupCount: 2,
        qualifyPerGroup: 4,
        knockoutSize: 4,
        seeding: "SEEDED",
      }),
    ).toThrowError(/must equal the number of qualifiers/u);
    expect(() =>
      createTournamentPlan({
        format: "GROUPS_THEN_KNOCKOUT",
        participants: participants(8),
        groupCount: 2,
        qualifyPerGroup: 2,
        knockoutSize: 8,
        seeding: "SEEDED",
      }),
    ).toThrowError(/must equal the number of qualifiers/u);
  });
});

describe("structure preview", () => {
  it("describes round robin and knockout without group-only totals", () => {
    expect(previewTournamentStructure({
      format: "ROUND_ROBIN",
      participantCount: 5,
      groupCount: 1,
      qualifyPerGroup: 1,
      knockoutSize: 8,
    })).toMatchObject({ groupMatchCount: 10, knockoutMatchCount: 0, totalMatches: 10 });
    expect(previewTournamentStructure({
      format: "SINGLE_ELIMINATION",
      participantCount: 6,
      groupCount: 1,
      qualifyPerGroup: 1,
      knockoutSize: 8,
    })).toMatchObject({ groupMatchCount: 0, knockoutMatchCount: 7, byes: 2, totalMatches: 7 });
  });
});

describe("group ranking", () => {
  it("ranks by points, leg difference, legs won and seed", () => {
    const standings = calculateGroupStandings({
      participants: participants(4),
      results: [
        { playerOneId: "player-1", playerTwoId: "player-2", playerOneLegs: 3, playerTwoLegs: 0, winnerPlayerId: "player-1" },
        { playerOneId: "player-3", playerTwoId: "player-4", playerOneLegs: 3, playerTwoLegs: 2, winnerPlayerId: "player-3" },
        { playerOneId: "player-1", playerTwoId: "player-3", playerOneLegs: 2, playerTwoLegs: 3, winnerPlayerId: "player-3" },
      ],
    });
    expect(standings.map((row) => row.playerId)).toEqual(["player-3", "player-1", "player-4", "player-2"]);
    expect(standings[0]).toMatchObject({ won: 2, points: 4, legDifference: 2 });
  });
});
