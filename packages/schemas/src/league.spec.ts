import { describe, expect, it } from "vitest";

import {
  COMPETITION_RULE_MESSAGES,
  createCompetitionSchema,
  createTeamSchema,
  declareSlotWalkoverSchema,
  submitDoublesSchema,
  submitNominationsSchema,
  substitutePlayerSchema,
} from "./league";

const uuid = "11111111-1111-4111-8111-111111111111";
const otherUuid = "22222222-2222-4222-8222-222222222222";

function competition(overrides: Record<string, unknown> = {}): unknown {
  return {
    name: "Nationalliga A",
    slug: "nationalliga-a",
    slots: [
      {
        sequence: 1,
        discipline: "SINGLES",
        label: "Einzel 1",
        homePosition: 1,
        awayPosition: 1,
        startingScore: 501,
        bestOfLegs: 3,
      },
    ],
    ...overrides,
  };
}

describe("league schemas", () => {
  it("trims a team name and defaults the short name to null", () => {
    const parsed = createTeamSchema.parse({ name: "  Bulls  " });
    expect(parsed).toEqual({ name: "Bulls", shortName: null });
  });

  it("rejects an empty team name", () => {
    expect(createTeamSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("fills the reglement defaults for a competition", () => {
    const parsed = createCompetitionSchema.parse(competition());
    expect(parsed.pointsWin).toBe(3);
    expect(parsed.pointsDraw).toBe(1);
    expect(parsed.deciderRule).toBe("NONE");
    expect(parsed.lineupPositions).toBe(4);
    expect(parsed.minNominationsShorthanded).toBe(3);
    expect(parsed.slots[0]?.role).toBe("REGULAR");
    expect(parsed.slots[0]?.inRule).toBe("STRAIGHT");
    expect(parsed.slots[0]?.outRule).toBe("DOUBLE");
    expect(parsed.slots[0]?.maxRounds).toBeNull();
  });

  it("rejects a slug that is not lowercase and hyphen separated", () => {
    expect(createCompetitionSchema.safeParse(competition({ slug: "Liga A" })).success).toBe(false);
  });

  it("rejects an even best-of-legs distance", () => {
    const invalid = competition({
      slots: [
        {
          sequence: 1,
          discipline: "SINGLES",
          label: "Einzel 1",
          homePosition: 1,
          awayPosition: 1,
          startingScore: 501,
          bestOfLegs: 4,
        },
      ],
    });
    expect(createCompetitionSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a starting score outside the reglement", () => {
    const invalid = competition({
      slots: [
        {
          sequence: 1,
          discipline: "SINGLES",
          label: "Einzel 1",
          homePosition: 1,
          awayPosition: 1,
          startingScore: 401,
          bestOfLegs: 3,
        },
      ],
    });
    expect(createCompetitionSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects fewer nominations than lineup positions", () => {
    const invalid = competition({ lineupPositions: 4, minNominations: 3 });
    expect(createCompetitionSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a shorthanded minimum above the lineup positions", () => {
    // Die Meldepruefung zaehlt besetzte Positionen; mehr als vier kann es bei
    // vier Positionen nicht geben. Der Wettbewerb waere nie bespielbar.
    const invalid = competition({
      lineupPositions: 4,
      minNominations: 5,
      minNominationsShorthanded: 5,
    });
    expect(createCompetitionSchema.safeParse(invalid).success).toBe(false);
    expect(
      createCompetitionSchema.safeParse(
        competition({ lineupPositions: 4, minNominations: 5, minNominationsShorthanded: 4 }),
      ).success,
    ).toBe(true);
  });

  it("rejects a decider bonus without the decider rule", () => {
    const invalid = competition({ deciderRule: "NONE", pointsDeciderBonus: 1 });
    expect(createCompetitionSchema.safeParse(invalid).success).toBe(false);
    expect(
      createCompetitionSchema.safeParse(
        competition({ deciderRule: "EXTRA_SLOT", pointsDeciderBonus: 1 }),
      ).success,
    ).toBe(true);
  });

  it("rejects points that are not ordered win >= draw >= loss", () => {
    expect(
      createCompetitionSchema.safeParse(competition({ pointsWin: 1, pointsDraw: 2 })).success,
    ).toBe(false);
  });

  it("accepts a substitute without a position and demands a command envelope", () => {
    const parsed = submitNominationsSchema.parse({
      commandId: uuid,
      expectedVersion: 3,
      side: "HOME",
      nominations: [{ position: null, playerId: otherUuid }],
    });
    expect(parsed.nominations[0]?.origin).toBe("SQUAD");
    expect(
      submitNominationsSchema.safeParse({
        side: "HOME",
        nominations: [{ position: 1, playerId: otherUuid, origin: "SQUAD" }],
      }).success,
    ).toBe(false);
  });

  it("demands exactly two players per doubles pairing", () => {
    const pairing = (playerIds: readonly string[]): unknown => ({
      commandId: uuid,
      expectedVersion: 1,
      side: "AWAY",
      pairings: [{ sequence: 9, playerIds }],
    });
    expect(submitDoublesSchema.safeParse(pairing([uuid, otherUuid])).success).toBe(true);
    expect(submitDoublesSchema.safeParse(pairing([uuid])).success).toBe(false);
  });

  it("demands a reason for a walkover but leaves a substitution reason optional", () => {
    expect(
      declareSlotWalkoverSchema.safeParse({
        commandId: uuid,
        expectedVersion: 1,
        winnerSide: "HOME",
        reason: "ab",
      }).success,
    ).toBe(false);
    const substitution = substitutePlayerSchema.parse({
      commandId: uuid,
      expectedVersion: 1,
      side: "HOME",
      position: 2,
      outPlayerId: uuid,
      inPlayerId: otherUuid,
      effectiveFromSequence: 5,
    });
    expect(substitution.reason).toBeNull();
  });
});

describe("competition rule messages", () => {
  it("names the lineup-position rule when the shorthanded minimum exceeds the positions", () => {
    // Zwei Regeln teilen sich den Pfad `minNominationsShorthanded`. Ohne
    // unterscheidbare Meldung zeigt die Fläche die falsche Begründung an.
    const result = createCompetitionSchema.safeParse(
      competition({ lineupPositions: 2, minNominations: 4, minNominationsShorthanded: 3 }),
    );
    expect(result.success).toBe(false);
    const issue = result.error?.issues.find(
      (candidate) => candidate.path[0] === "minNominationsShorthanded",
    );
    expect(issue?.message).toBe(COMPETITION_RULE_MESSAGES.shorthandedNotAbovePositions);
  });

  it("names the minimum rule when the shorthanded minimum exceeds the regular minimum", () => {
    const result = createCompetitionSchema.safeParse(
      competition({ lineupPositions: 4, minNominations: 2, minNominationsShorthanded: 3 }),
    );
    expect(result.success).toBe(false);
    const issue = result.error?.issues.find(
      (candidate) => candidate.path[0] === "minNominationsShorthanded",
    );
    expect(issue?.message).toBe(COMPETITION_RULE_MESSAGES.shorthandedNotAboveMinimum);
  });
});
