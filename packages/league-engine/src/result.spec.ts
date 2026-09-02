import { describe, expect, it } from "vitest";

import { LeagueValidationError } from "./errors.js";
import {
  calculateEncounterResult,
  resolveDeciderRequirement,
  type ResultInput,
  type ResultSlot,
  type ScoringRules,
  type SlotOutcome,
} from "./result.js";
import type { Side } from "./template.js";

const leagueScoring: ScoringRules = {
  pointsWin: 3,
  pointsDraw: 1,
  pointsLoss: 0,
  pointsDeciderBonus: 1,
  deciderRule: "EXTRA_SLOT",
};

const played = (winner: Side): SlotOutcome => ({
  type: "PLAYED",
  winner,
  homeLegs: winner === "HOME" ? 2 : 0,
  awayLegs: winner === "AWAY" ? 2 : 0,
});

const slot = (sequence: number, outcome: SlotOutcome, role: ResultSlot["role"] = "REGULAR"): ResultSlot => ({
  sequence,
  role,
  legsToWinSet: 2,
  setsToWin: 1,
  outcome,
});

/** 18 reguläre Slots, davon `homeWins` an die Heimseite. */
const regularSlots = (homeWins: number, rest: SlotOutcome = played("AWAY")): ResultSlot[] =>
  Array.from({ length: 18 }, (_, index) =>
    slot(index + 1, index < homeWins ? played("HOME") : rest),
  );

const encounter = (
  slots: readonly ResultSlot[],
  overrides: Partial<ResultInput> = {},
): ResultInput => ({ slots, scoring: leagueScoring, ...overrides });

const expectCode = (act: () => void, code: string): void => {
  expect(act).toThrow(LeagueValidationError);
  expect(act).toThrow(expect.objectContaining({ code }));
};

describe("calculateEncounterResult", () => {
  it("wertet 18:0 Spiele als 3:0 Punkte", () => {
    const result = calculateEncounterResult(encounter(regularSlots(18)));
    expect(result).toEqual({
      homeGames: 18,
      awayGames: 0,
      homeLegs: 36,
      awayLegs: 0,
      homePoints: 3,
      awayPoints: 0,
      result: "HOME_WIN",
      resultType: "PLAYED",
      complete: true,
    });
  });

  it("wertet 8:10 Spiele als 0:3 Punkte", () => {
    const result = calculateEncounterResult(encounter(regularSlots(8)));
    expect(result.awayGames).toBe(10);
    expect(result.homePoints).toBe(0);
    expect(result.awayPoints).toBe(3);
    expect(result.result).toBe("AWAY_WIN");
  });

  it("wertet 9:9 Spiele ohne Entscheidungsdoppel als Unentschieden", () => {
    const result = calculateEncounterResult(
      encounter(regularSlots(9), {
        scoring: { ...leagueScoring, deciderRule: "NONE", pointsDeciderBonus: 0 },
      }),
    );
    expect(result.homePoints).toBe(1);
    expect(result.awayPoints).toBe(1);
    expect(result.result).toBe("DRAW");
    expect(result.resultType).toBe("PLAYED");
    expect(result.complete).toBe(true);
  });

  it("hält 9:9 Spiele mit offenem Entscheidungsdoppel als unentschieden offen", () => {
    const slots = [...regularSlots(9), slot(19, { type: "PENDING" }, "DECIDER")];
    const result = calculateEncounterResult(encounter(slots));
    expect(result.complete).toBe(false);
    expect(result.result).toBeNull();
    expect(result.resultType).toBeNull();
    expect(result.homePoints).toBe(0);
    expect(result.awayPoints).toBe(0);
    expect(result.homeGames).toBe(9);
  });

  it("wertet das gewonnene Entscheidungsdoppel als 2:1 Punkte bei 10:9 Spielen", () => {
    const slots = [...regularSlots(9), slot(19, played("HOME"), "DECIDER")];
    const result = calculateEncounterResult(encounter(slots));
    expect(result).toEqual({
      homeGames: 10,
      awayGames: 9,
      homeLegs: 20,
      awayLegs: 18,
      homePoints: 2,
      awayPoints: 1,
      result: "HOME_WIN",
      resultType: "DECIDER",
      complete: true,
    });
  });

  it("zählt einen nicht benötigten Entscheidungsslot nirgends mit", () => {
    const slots = [...regularSlots(10), slot(19, { type: "CANCELLED" }, "DECIDER")];
    const result = calculateEncounterResult(encounter(slots));
    expect(result.homeGames).toBe(10);
    expect(result.awayGames).toBe(8);
    expect(result.homeLegs).toBe(20);
    expect(result.resultType).toBe("PLAYED");
  });

  it("wertet die Begegnung einer mit drei Personen angetretenen Mannschaft", () => {
    const slots = regularSlots(0).map((entry, index) =>
      index < 4 || index === 8
        ? { ...entry, outcome: { type: "WALKOVER", winner: "AWAY" } as SlotOutcome }
        : entry,
    );
    const result = calculateEncounterResult(encounter(slots));
    expect(result.awayGames).toBe(18);
    expect(result.awayLegs).toBe(36);
    expect(result.homeGames).toBe(0);
    expect(result.result).toBe("AWAY_WIN");
  });

  it("vergibt beim Walkover die zum Sieg nötige Legzahl", () => {
    const slots = regularSlots(17).map((entry, index) =>
      index === 17
        ? {
            ...entry,
            legsToWinSet: 3,
            setsToWin: 2,
            outcome: { type: "WALKOVER", winner: "AWAY" } as SlotOutcome,
          }
        : entry,
    );
    const result = calculateEncounterResult(encounter(slots));
    expect(result.awayGames).toBe(1);
    expect(result.awayLegs).toBe(6);
  });

  it("wertet den Nichtantritt mit 0:3 Punkten, 0:18 Spielen und 0:36 Legs", () => {
    const slots = [
      ...regularSlots(0, { type: "CANCELLED" }),
      slot(19, { type: "CANCELLED" }, "DECIDER"),
    ];
    const result = calculateEncounterResult(encounter(slots, { forfeitSide: "HOME" }));
    expect(result).toEqual({
      homeGames: 0,
      awayGames: 18,
      homeLegs: 0,
      awayLegs: 36,
      homePoints: 0,
      awayPoints: 3,
      result: "AWAY_WIN",
      resultType: "FORFEIT",
      complete: true,
    });
  });

  it("liefert bei offenen regulären Slots nur den Zwischenstand", () => {
    const slots = regularSlots(5).map((entry, index) =>
      index >= 10 ? { ...entry, outcome: { type: "PENDING" } as SlotOutcome } : entry,
    );
    const result = calculateEncounterResult(encounter(slots));
    expect(result.complete).toBe(false);
    expect(result.homeGames).toBe(5);
    expect(result.awayGames).toBe(5);
    expect(result.homePoints).toBe(0);
    expect(result.result).toBeNull();
  });

  it("lehnt Gleichstand ohne vorhandenen Entscheidungsslot ab", () => {
    expectCode(
      () => calculateEncounterResult(encounter(regularSlots(9))),
      "MISSING_DECIDER_SLOT",
    );
  });

  it("lehnt einen Zusatzpunkt ohne Entscheidungsdoppel ab", () => {
    expectCode(
      () =>
        calculateEncounterResult(
          encounter(regularSlots(18), { scoring: { ...leagueScoring, deciderRule: "NONE" } }),
        ),
      "INVALID_SCORING_RULES",
    );
  });

  it("lehnt zwei Entscheidungsslots ab", () => {
    const slots = [
      ...regularSlots(9),
      slot(19, played("HOME"), "DECIDER"),
      slot(20, played("HOME"), "DECIDER"),
    ];
    expectCode(() => calculateEncounterResult(encounter(slots)), "MULTIPLE_DECIDER_SLOTS");
  });

  it("lehnt eine negative Legzahl ab", () => {
    const slots = regularSlots(18).map((entry, index) =>
      index === 0
        ? {
            ...entry,
            outcome: { type: "PLAYED", winner: "HOME", homeLegs: 2, awayLegs: -1 } as SlotOutcome,
          }
        : entry,
    );
    expectCode(() => calculateEncounterResult(encounter(slots)), "INVALID_SLOT_RESULT");
  });
});

describe("resolveDeciderRequirement", () => {
  it("meldet offene reguläre Slots", () => {
    const slots = [
      ...regularSlots(9).map((entry, index) =>
        index === 17 ? { ...entry, outcome: { type: "PENDING" } as SlotOutcome } : entry,
      ),
      slot(19, { type: "PENDING" }, "DECIDER"),
    ];
    expect(resolveDeciderRequirement(encounter(slots))).toEqual({
      status: "REGULAR_SLOTS_PENDING",
      required: false,
      slotSequence: 19,
    });
  });

  it("verlangt bei Gleichstand das Entscheidungsdoppel", () => {
    const slots = [...regularSlots(9), slot(19, { type: "PENDING" }, "DECIDER")];
    expect(resolveDeciderRequirement(encounter(slots))).toEqual({
      status: "REQUIRED",
      required: true,
      slotSequence: 19,
    });
  });

  it("meldet ein bereits gespieltes Entscheidungsdoppel als abgeschlossen", () => {
    const slots = [...regularSlots(9), slot(19, played("AWAY"), "DECIDER")];
    expect(resolveDeciderRequirement(encounter(slots))).toEqual({
      status: "COMPLETED",
      required: true,
      slotSequence: 19,
    });
  });

  it("verlangt bei Vorsprung kein Entscheidungsdoppel", () => {
    const slots = [...regularSlots(10), slot(19, { type: "PENDING" }, "DECIDER")];
    expect(resolveDeciderRequirement(encounter(slots)).status).toBe("NOT_REQUIRED");
  });

  it("verlangt ohne Entscheidungsregel kein Entscheidungsdoppel", () => {
    expect(
      resolveDeciderRequirement(
        encounter(regularSlots(9), {
          scoring: { ...leagueScoring, deciderRule: "NONE", pointsDeciderBonus: 0 },
        }),
      ).status,
    ).toBe("NOT_REQUIRED");
  });

  it("verlangt beim Nichtantritt kein Entscheidungsdoppel", () => {
    expect(
      resolveDeciderRequirement(
        encounter(regularSlots(0, { type: "CANCELLED" }), { forfeitSide: "AWAY" }),
      ),
    ).toEqual({ status: "NOT_REQUIRED", required: false, slotSequence: null });
  });

  it("lehnt Gleichstand ohne vorhandenen Entscheidungsslot ab", () => {
    expectCode(
      () => resolveDeciderRequirement(encounter(regularSlots(9))),
      "MISSING_DECIDER_SLOT",
    );
  });
});
