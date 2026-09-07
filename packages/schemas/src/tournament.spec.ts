import { describe, expect, it } from "vitest";

import {
  createTournamentSchema,
  publicTournamentDashboardSchema,
  tournamentDashboardSchema,
  withdrawTournamentParticipantSchema,
} from "./tournament";

const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const valid = {
  name: "Vereinsmeisterschaft",
  startsAt: new Date("2026-09-12T12:00:00.000Z"),
  format: "GROUPS_THEN_KNOCKOUT" as const,
  startingScore: 501 as const,
  inRule: "STRAIGHT" as const,
  outRule: "DOUBLE" as const,
  bestOfLegs: 3,
  participantIds: Array.from({ length: 8 }, (_, index) => id(index + 1)),
  groupCount: 2,
  qualifyPerGroup: 2,
  knockoutSize: 4 as const,
  seeding: "SEEDED" as const,
  boardIds: [id(100), id(101)],
};

describe("create tournament contract", () => {
  it("accepts a structurally valid tournament", () => {
    expect(createTournamentSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an out rule the platform does not know", () => {
    expect(createTournamentSchema.safeParse({ ...valid, outRule: "TRIPLE" }).success).toBe(false);
  });

  it("defaults the round limit to null", () => {
    expect(createTournamentSchema.parse(valid).maxRounds).toBeNull();
  });

  it("rejects duplicate participants and boards", () => {
    expect(
      createTournamentSchema.safeParse({
        ...valid,
        participantIds: [...valid.participantIds.slice(0, 7), valid.participantIds[0]],
      }).success,
    ).toBe(false);
    expect(
      createTournamentSchema.safeParse({ ...valid, boardIds: [id(100), id(100)] }).success,
    ).toBe(false);
  });

  it("rejects impossible qualification and knockout combinations", () => {
    expect(
      createTournamentSchema.safeParse({ ...valid, qualifyPerGroup: 5, knockoutSize: 16 }).success,
    ).toBe(false);
    expect(
      createTournamentSchema.safeParse({ ...valid, qualifyPerGroup: 4, knockoutSize: 4 }).success,
    ).toBe(false);
    expect(
      createTournamentSchema.safeParse({ ...valid, knockoutSize: 8 }).success,
    ).toBe(false);
    expect(
      createTournamentSchema.safeParse({
        ...valid,
        format: "SINGLE_ELIMINATION",
        knockoutSize: 32,
      }).success,
    ).toBe(false);
  });
});

describe("withdraw tournament participant contract", () => {
  it("accepts a versioned withdrawal with a meaningful reason", () => {
    expect(
      withdrawTournamentParticipantSchema.parse({
        commandId: id(201),
        expectedVersion: 4,
        playerId: id(202),
        reason: "  Verletzung  ",
      }),
    ).toMatchObject({ expectedVersion: 4, reason: "Verletzung" });
  });

  it("rejects reasons outside the 3 to 500 character boundary", () => {
    const base = { commandId: id(201), expectedVersion: 4, playerId: id(202) };
    expect(withdrawTournamentParticipantSchema.safeParse({ ...base, reason: "ab" }).success).toBe(false);
    expect(withdrawTournamentParticipantSchema.safeParse({ ...base, reason: "x".repeat(501) }).success).toBe(false);
  });
});

describe("tournament disruption projection", () => {
  it("exposes withdrawn participants and walkover results", () => {
    const parsed = tournamentDashboardSchema.parse({
      tournament: { id: id(1), organizationId: id(2), name: "Cup", status: "KNOCKOUT", format: "SINGLE_ELIMINATION", version: 4, stageLabel: "K.-o.-Runde", startingScore: 501, inRule: "STRAIGHT", outRule: "DOUBLE", playedMatches: 1, totalMatches: 3, startsAt: new Date() },
      participants: [{ playerId: id(3), displayName: "Alex", seed: 1, status: "WITHDRAWN", withdrawnAt: new Date(), withdrawalReason: "Verletzung" }],
      boards: [], queue: [], conflicts: [], groups: [],
      bracket: [{ matchId: id(4), stageLabel: "K.-o. · Runde 1", round: 1, position: 1, status: "COMPLETED", resultType: "WALKOVER", participantNames: ["Alex", "Bea"], winnerDisplayName: "Bea" }],
      recentResults: [{ matchId: id(4), stageLabel: "K.-o. · Runde 1", resultType: "WALKOVER", participantNames: ["Alex", "Bea"], winnerPlayerId: id(5), winnerDisplayName: "Bea", completedAt: new Date() }],
      generatedAt: new Date(),
    });
    expect(parsed.participants).toEqual([
      expect.objectContaining({ status: "WITHDRAWN", withdrawalReason: "Verletzung" }),
    ]);
    expect(parsed.bracket[0]?.resultType).toBe("WALKOVER");
    expect(parsed.recentResults[0]?.resultType).toBe("WALKOVER");
  });
});

describe("public tournament projection", () => {
  it("nennt in der oeffentlichen Turnieransicht weder Mandant noch Betriebsinterna", () => {
    const publicShape = publicTournamentDashboardSchema.shape;
    const publicTournamentShape = publicShape.tournament.shape;

    expect(Object.keys(publicShape)).not.toContain("conflicts");
    expect(Object.keys(publicTournamentShape)).not.toContain("organizationId");
    expect(Object.keys(publicShape.boards.element.shape)).not.toContain("blockedReason");
    expect(Object.keys(publicShape.queue.element.shape)).not.toContain("blockedReason");

    // Die interne Sicht behaelt alles: sie ist der Arbeitsplatz der
    // Turnierleitung.
    expect(Object.keys(tournamentDashboardSchema.shape)).toContain("conflicts");
    expect(Object.keys(tournamentDashboardSchema.shape.tournament.shape)).toContain(
      "organizationId",
    );
  });
});
