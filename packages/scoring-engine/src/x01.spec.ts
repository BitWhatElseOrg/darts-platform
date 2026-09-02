import { describe, expect, it } from "vitest";

import {
  ScoringValidationError,
  createX01Match,
  executeX01Command,
  isAttainableScore,
  projectX01Match,
  type X01Side,
} from "./x01.js";

function visit(
  commandId: string,
  seat: 1 | 2,
  throwerPlayerId: string,
  points: number,
  dartsThrown: 1 | 2 | 3 = 3,
  checkoutDouble?: number,
) {
  return {
    type: "SUBMIT_VISIT" as const,
    commandId,
    seat,
    throwerPlayerId,
    points,
    dartsThrown,
    ...(checkoutDouble === undefined ? {} : { checkoutDouble }),
  };
}

function singles(one: string, two: string): readonly [X01Side, X01Side] {
  return [
    { seat: 1, playerIds: [one] },
    { seat: 2, playerIds: [two] },
  ];
}

describe("X01 scoring", () => {
  it("supports straight-out checkout when configured", () => {
    const match = createX01Match({
      sides: singles("one", "two"),
      rules: { startingScore: 10, doubleOut: false, legsToWinSet: 1, setsToWin: 1 },
    });
    const result = executeX01Command(match, {
      type: "SUBMIT_VISIT",
      commandId: "straight-out",
      seat: 1,
      throwerPlayerId: "one",
      points: 10,
      dartsThrown: 1,
    });
    expect(result.state.status).toBe("COMPLETED");
    expect(result.state.winnerSeat).toBe(1);
  });
  it("scores a normal 501 visit and changes the active side", () => {
    const result = executeX01Command(createX01Match({ sides: singles("a", "b") }), visit("1", 1, "a", 100));
    expect(result.state.sides[0].remaining).toBe(401);
    expect(result.state.activeSeat).toBe(2);
    expect(result.state.activeThrowerPlayerId).toBe("b");
  });

  it.each([
    ["overthrow", 60, 62, undefined],
    ["rest one", 60, 59, undefined],
    ["missing double", 60, 60, undefined],
  ])("detects a bust for %s", (_label, remaining, points, checkoutDouble) => {
    const match = createX01Match({ sides: singles("a", "b"), rules: { startingScore: remaining as number, doubleOut: true, legsToWinSet: 1, setsToWin: 1 } });
    const result = executeX01Command(match, visit("1", 1, "a", points as number, 3, checkoutDouble));
    expect(result.state.visits[0]?.outcome).toBe("BUST");
    expect(result.state.sides[0].remaining).toBe(remaining);
  });

  it("accepts a checkout with fewer than three darts", () => {
    const match = createX01Match({ sides: singles("a", "b"), rules: { startingScore: 40, doubleOut: true, legsToWinSet: 1, setsToWin: 1 } });
    const result = executeX01Command(match, visit("1", 1, "a", 40, 1, 20));
    expect(result.state.status).toBe("COMPLETED");
    expect(result.state.visits[0]?.outcome).toBe("MATCH_WON");
  });

  it("tracks leg, set and match wins", () => {
    let match = createX01Match({ sides: singles("a", "b"), rules: { startingScore: 40, doubleOut: true, legsToWinSet: 2, setsToWin: 2 } });
    const commands = [
      visit("1", 1, "a", 40, 1, 20),
      visit("2", 2, "b", 0, 1),
      visit("3", 1, "a", 40, 1, 20),
      visit("4", 1, "a", 40, 1, 20),
      visit("5", 2, "b", 0, 1),
      visit("6", 1, "a", 40, 1, 20),
    ];
    const outcomes: string[] = [];
    for (const command of commands) {
      const result = executeX01Command(match, command);
      match = result.match;
      if (result.outcome?.endsWith("WON") === true) outcomes.push(result.outcome);
    }
    expect(outcomes).toEqual(["LEG_WON", "SET_WON", "LEG_WON", "MATCH_WON"]);
  });

  it("undoes and replays the latest visit", () => {
    const first = executeX01Command(createX01Match({ sides: singles("a", "b") }), visit("v1", 1, "a", 100));
    const undone = executeX01Command(first.match, { type: "UNDO_LAST_VISIT", commandId: "u1", targetCommandId: "v1" });
    expect(undone.state.sides[0].remaining).toBe(501);
    expect(undone.state.activeSeat).toBe(1);
    expect(undone.state.activeThrowerPlayerId).toBe("a");
    expect(undone.state.revertedCommandIds).toContain("v1");
  });

  it("returns the same state for a repeated command id", () => {
    const match = createX01Match({ sides: singles("a", "b") });
    const first = executeX01Command(match, visit("same", 1, "a", 100));
    const repeated = executeX01Command(first.match, visit("same", 1, "a", 100));
    expect(repeated.duplicate).toBe(true);
    expect(repeated.state.visits).toHaveLength(1);
  });

  it("rejects impossible and otherwise invalid scores", () => {
    expect(isAttainableScore(180, 3)).toBe(true);
    expect(isAttainableScore(180, 1)).toBe(false);
    expect(() => executeX01Command(createX01Match({ sides: singles("a", "b") }), visit("1", 1, "a", 181))).toThrow(ScoringValidationError);
  });

  it("records checkout attempts and rejects more attempts than darts", () => {
    const match = createX01Match({ sides: singles("a", "b") });
    const result = executeX01Command(match, { ...visit("attempts", 1, "a", 60), checkoutAttempts: 2 });
    expect(result.state.visits[0]?.checkoutAttempts).toBe(2);
    expect(() => executeX01Command(match, { ...visit("too-many", 1, "a", 60, 2), checkoutAttempts: 3 })).toThrow(ScoringValidationError);
  });
});

describe("X01 sides", () => {
  it("treats a singles match as a side with one player", () => {
    const match = createX01Match({ sides: singles("a", "b") });
    const result = executeX01Command(match, visit("1", 1, "a", 100));
    expect(result.state.sides[0].remaining).toBe(401);
    expect(result.state.activeSeat).toBe(2);
    expect(result.state.activeThrowerPlayerId).toBe("b");
  });

  it("rotates the thrower inside a doubles side and alternates per leg", () => {
    let match = createX01Match({
      sides: [
        { seat: 1, playerIds: ["a1", "a2"] },
        { seat: 2, playerIds: ["b1", "b2"] },
      ],
      rules: { startingScore: 40, doubleOut: true, legsToWinSet: 2, setsToWin: 1 },
    });
    // Leg 1: Seite 1 wirft a1, danach a2, ...
    expect(projectX01Match(match).activeThrowerPlayerId).toBe("a1");
    let result = executeX01Command(match, visit("1", 1, "a1", 0));
    match = result.match;
    result = executeX01Command(match, visit("2", 2, "b1", 0));
    match = result.match;
    expect(projectX01Match(match).activeThrowerPlayerId).toBe("a2");
    result = executeX01Command(match, visit("3", 1, "a2", 40, 1, 20));
    match = result.match;
    expect(result.outcome).toBe("LEG_WON");
    // Leg 2 beginnt Seite 2, und innerhalb der Seiten rückt die Reihenfolge weiter.
    expect(result.state.legNumber).toBe(2);
    expect(result.state.activeSeat).toBe(2);
    expect(result.state.activeThrowerPlayerId).toBe("b2");
  });

  it("rejects a visit from the wrong person of the active side", () => {
    const match = createX01Match({
      sides: [
        { seat: 1, playerIds: ["a1", "a2"] },
        { seat: 2, playerIds: ["b1", "b2"] },
      ],
    });
    expect(() => executeX01Command(match, visit("1", 1, "a2", 60))).toThrow(ScoringValidationError);
    try {
      executeX01Command(match, visit("2", 1, "a2", 60));
    } catch (error: unknown) {
      expect((error as ScoringValidationError).code).toBe("INVALID_THROWER");
    }
  });

  it("rejects a visit for the side that is not active", () => {
    const match = createX01Match({ sides: singles("a", "b") });
    try {
      executeX01Command(match, visit("1", 2, "b", 60));
    } catch (error: unknown) {
      expect((error as ScoringValidationError).code).toBe("NOT_ACTIVE_SEAT");
    }
  });

  it("rejects an empty side and a person on both sides", () => {
    expect(() =>
      createX01Match({ sides: [{ seat: 1, playerIds: [] }, { seat: 2, playerIds: ["b"] }] }),
    ).toThrow(ScoringValidationError);
    expect(() =>
      createX01Match({ sides: [{ seat: 1, playerIds: ["a"] }, { seat: 2, playerIds: ["a"] }] }),
    ).toThrow(ScoringValidationError);
  });
});
