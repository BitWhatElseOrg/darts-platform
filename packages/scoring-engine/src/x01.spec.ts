import { describe, expect, it } from "vitest";

import { ScoringValidationError, createX01Match, executeX01Command, isAttainableScore } from "./x01.js";

function visit(commandId: string, playerId: string, points: number, dartsThrown: 1 | 2 | 3 = 3, checkoutDouble?: number) {
  return { type: "SUBMIT_VISIT" as const, commandId, playerId, points, dartsThrown, ...(checkoutDouble === undefined ? {} : { checkoutDouble }) };
}

describe("X01 scoring", () => {
  it("supports straight-out checkout when configured", () => {
    const match = createX01Match({
      playerIds: ["one", "two"],
      rules: { startingScore: 10, doubleOut: false, legsToWinSet: 1, setsToWin: 1 },
    });
    const result = executeX01Command(match, {
      type: "SUBMIT_VISIT",
      commandId: "straight-out",
      playerId: "one",
      points: 10,
      dartsThrown: 1,
    });
    expect(result.state.status).toBe("COMPLETED");
    expect(result.state.winnerPlayerId).toBe("one");
  });
  it("scores a normal 501 visit and changes the active player", () => {
    const result = executeX01Command(createX01Match({ playerIds: ["a", "b"] }), visit("1", "a", 100));
    expect(result.state.players[0].remaining).toBe(401);
    expect(result.state.activePlayerId).toBe("b");
  });

  it.each([
    ["overthrow", 60, 62, undefined],
    ["rest one", 60, 59, undefined],
    ["missing double", 60, 60, undefined],
  ])("detects a bust for %s", (_label, remaining, points, checkoutDouble) => {
    const match = createX01Match({ playerIds: ["a", "b"], rules: { startingScore: remaining as number, doubleOut: true, legsToWinSet: 1, setsToWin: 1 } });
    const result = executeX01Command(match, visit("1", "a", points as number, 3, checkoutDouble));
    expect(result.state.visits[0]?.outcome).toBe("BUST");
    expect(result.state.players[0].remaining).toBe(remaining);
  });

  it("accepts a checkout with fewer than three darts", () => {
    const match = createX01Match({ playerIds: ["a", "b"], rules: { startingScore: 40, doubleOut: true, legsToWinSet: 1, setsToWin: 1 } });
    const result = executeX01Command(match, visit("1", "a", 40, 1, 20));
    expect(result.state.status).toBe("COMPLETED");
    expect(result.state.visits[0]?.outcome).toBe("MATCH_WON");
  });

  it("tracks leg, set and match wins", () => {
    let match = createX01Match({ playerIds: ["a", "b"], rules: { startingScore: 40, doubleOut: true, legsToWinSet: 2, setsToWin: 2 } });
    const commands = [
      visit("1", "a", 40, 1, 20),
      visit("2", "b", 0, 1),
      visit("3", "a", 40, 1, 20),
      visit("4", "a", 40, 1, 20),
      visit("5", "b", 0, 1),
      visit("6", "a", 40, 1, 20),
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
    const first = executeX01Command(createX01Match({ playerIds: ["a", "b"] }), visit("v1", "a", 100));
    const undone = executeX01Command(first.match, { type: "UNDO_LAST_VISIT", commandId: "u1", targetCommandId: "v1" });
    expect(undone.state.players[0].remaining).toBe(501);
    expect(undone.state.activePlayerId).toBe("a");
    expect(undone.state.revertedCommandIds).toContain("v1");
  });

  it("returns the same state for a repeated command id", () => {
    const match = createX01Match({ playerIds: ["a", "b"] });
    const first = executeX01Command(match, visit("same", "a", 100));
    const repeated = executeX01Command(first.match, visit("same", "a", 100));
    expect(repeated.duplicate).toBe(true);
    expect(repeated.state.visits).toHaveLength(1);
  });

  it("rejects impossible and otherwise invalid scores", () => {
    expect(isAttainableScore(180, 3)).toBe(true);
    expect(isAttainableScore(180, 1)).toBe(false);
    expect(() => executeX01Command(createX01Match({ playerIds: ["a", "b"] }), visit("1", "a", 181))).toThrow(ScoringValidationError);
  });

  it("records checkout attempts and rejects more attempts than darts", () => {
    const match = createX01Match({ playerIds: ["a", "b"] });
    const result = executeX01Command(match, { ...visit("attempts", "a", 60), checkoutAttempts: 2 });
    expect(result.state.visits[0]?.checkoutAttempts).toBe(2);
    expect(() => executeX01Command(match, { ...visit("too-many", "a", 60, 2), checkoutAttempts: 3 })).toThrow(ScoringValidationError);
  });
});
