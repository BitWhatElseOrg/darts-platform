import { describe, expect, it } from "vitest";

import { COMPETITION_RULE_MESSAGES, createCompetitionSchema } from "@darts-platform/schemas";

import {
  competitionFormErrors,
  deciderReachability,
  lineupPositionsHint,
  legDistanceHint,
} from "./competition-form";

function payload(overrides: Record<string, unknown> = {}): unknown {
  return {
    type: "LEAGUE",
    name: "Testliga",
    slug: "testliga",
    status: "ACTIVE",
    pointsWin: 3,
    pointsDraw: 1,
    pointsLoss: 0,
    pointsDeciderBonus: 1,
    deciderRule: "EXTRA_SLOT",
    lineupPositions: 4,
    minNominations: 4,
    minNominationsShorthanded: 3,
    maxSubstitutionsPerEncounter: 4,
    maxDoublesPerPlayer: 1,
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

function errorsFor(overrides: Record<string, unknown>): Readonly<Record<string, string>> {
  const parsed = createCompetitionSchema.safeParse(payload(overrides));
  if (parsed.success) throw new Error("Expected the payload to be rejected.");
  return competitionFormErrors(parsed.error.issues, {
    lineupPositions: Number(overrides.lineupPositions ?? 4),
  });
}

describe("competitionFormErrors", () => {
  it("explains the lineup-position rule instead of the minimum rule", () => {
    // Beide Regeln zeigen auf dasselbe Feld; nur die Regel unterscheidet sie.
    const errors = errorsFor({ lineupPositions: 2, minNominations: 4, minNominationsShorthanded: 3 });

    expect(errors.minNominationsShorthanded).toBe(
      "Die Ausnahmemeldung darf die Aufstellungspositionen nicht übersteigen; hier sind es 2.",
    );
  });

  it("explains the minimum rule when the shorthanded minimum is the larger one", () => {
    const errors = errorsFor({ lineupPositions: 4, minNominations: 2, minNominationsShorthanded: 3 });

    expect(errors.minNominationsShorthanded).toBe(
      "Die Ausnahmemeldung darf die reguläre Mindestmeldung nicht übersteigen.",
    );
  });

  it("keeps a German message for a rule it does not know", () => {
    const errors = competitionFormErrors([
      { code: "custom", path: ["name"], message: "Something went wrong" },
    ]);

    expect(errors.name).toBe(
      "Der Wettbewerb braucht einen Namen, unter dem er in der Liste auffindbar ist.",
    );
  });

  it("covers every rule message the schema can raise", () => {
    const known = competitionFormErrors(
      Object.values(COMPETITION_RULE_MESSAGES).map((message) => ({
        code: "custom" as const,
        path: ["rule"],
        message,
      })),
    );

    expect(Object.keys(known)).toHaveLength(1);
    expect(known.rule).not.toBe(undefined);
  });
});

describe("deciderReachability", () => {
  it("reports the decider as reachable when the regular games can end level", () => {
    expect(deciderReachability({ lineupPositions: 4, regularDoubles: 2, withDecider: true })).toBe(
      null,
    );
  });

  it("warns when an odd number of regular games makes a draw impossible", () => {
    expect(deciderReachability({ lineupPositions: 2, regularDoubles: 1, withDecider: true })).toBe(
      "5 reguläre Spiele können nicht unentschieden enden. Das Entscheidungsdoppel käme nie zum Einsatz.",
    );
  });

  it("stays quiet when no decider is configured", () => {
    expect(deciderReachability({ lineupPositions: 2, regularDoubles: 1, withDecider: false })).toBe(
      null,
    );
  });
});

describe("form hints", () => {
  it("describes the chosen number of lineup positions", () => {
    expect(lineupPositionsHint(2)).toBe("Zwei Positionen ergeben vier Einzel.");
    expect(lineupPositionsHint(4)).toBe("Vier Positionen ergeben sechzehn Einzel.");
  });

  it("describes the chosen leg distance", () => {
    expect(legDistanceHint(1)).toBe("Ein Gewinnsatz entspricht Best of 1.");
    expect(legDistanceHint(3)).toBe("Zwei Gewinnsätze entsprechen Best of 3.");
    expect(legDistanceHint(5)).toBe("Drei Gewinnsätze entsprechen Best of 5.");
  });
});
