import { describe, expect, it } from "vitest";

import { createTournamentSchema, withdrawTournamentParticipantSchema } from "./tournament";

const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const valid = {
  name: "Vereinsmeisterschaft",
  startsAt: new Date("2026-09-12T12:00:00.000Z"),
  format: "GROUPS_THEN_KNOCKOUT" as const,
  startingScore: 501 as const,
  doubleOut: true,
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
