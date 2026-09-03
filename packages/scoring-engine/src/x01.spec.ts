import { describe, expect, it } from "vitest";

import {
  ScoringValidationError,
  createX01Match,
  executeX01Command,
  isAttainableScore,
  projectX01Match,
  type InRule,
  type OutRule,
  type X01Rules,
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

function rules(overrides: Partial<X01Rules> = {}): X01Rules {
  return {
    startingScore: 501,
    inRule: "STRAIGHT",
    outRule: "DOUBLE",
    maxRounds: null,
    legsToWinSet: 1,
    setsToWin: 1,
    ...overrides,
  };
}

describe("X01 scoring", () => {
  it("supports straight-out checkout when configured", () => {
    const match = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ startingScore: 10, outRule: "SINGLE" }),
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
  it("finishes on a treble under master out but not under double out", () => {
    const master = executeX01Command(
      createX01Match({ sides: singles("one", "two"), rules: rules({ startingScore: 12, outRule: "MASTER" }) }),
      visit("master", 1, "one", 12, 1),
    );
    expect(master.state.status).toBe("COMPLETED");
    expect(master.state.winnerSeat).toBe(1);

    const double = executeX01Command(
      createX01Match({ sides: singles("one", "two"), rules: rules({ startingScore: 12, outRule: "DOUBLE" }) }),
      visit("double", 1, "one", 12, 1),
    );
    expect(double.outcome).toBe("BUST");
    expect(double.state.sides[0].remaining).toBe(12);
  });

  it("accepts a recorded double as a master-out checkout", () => {
    const result = executeX01Command(
      createX01Match({ sides: singles("one", "two"), rules: rules({ startingScore: 12, outRule: "MASTER" }) }),
      visit("d6", 1, "one", 12, 1, 6),
    );
    expect(result.state.status).toBe("COMPLETED");
  });

  it("busts on a remainder of one unless the out rule is single", () => {
    for (const outRule of ["DOUBLE", "MASTER"] as const satisfies readonly OutRule[]) {
      const result = executeX01Command(
        createX01Match({ sides: singles("one", "two"), rules: rules({ startingScore: 12, outRule }) }),
        visit(`bust-${outRule}`, 1, "one", 11, 1),
      );
      expect(result.outcome).toBe("BUST");
      expect(result.state.sides[0].remaining).toBe(12);
    }
    const single = executeX01Command(
      createX01Match({ sides: singles("one", "two"), rules: rules({ startingScore: 12, outRule: "SINGLE" }) }),
      visit("single", 1, "one", 11, 1),
    );
    expect(single.outcome).toBe("SCORED");
    expect(single.state.sides[0].remaining).toBe(1);
  });

  it("rejects rules the reglement does not know", () => {
    const invalid = [
      { key: "INVALID_IN_RULE", rule: rules({ inRule: "TRIPLE" as InRule }) },
      { key: "INVALID_OUT_RULE", rule: rules({ outRule: "ANY" as OutRule }) },
      { key: "INVALID_MAX_ROUNDS", rule: rules({ maxRounds: 0 }) },
    ] as const;
    for (const { key, rule } of invalid) {
      try {
        createX01Match({ sides: singles("one", "two"), rules: rule });
        expect.unreachable(`${key} was accepted`);
      } catch (error: unknown) {
        expect((error as ScoringValidationError).code).toBe(key);
      }
    }
  });

  it("requires the opening double and keeps the side closed on a miss", () => {
    const match = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ startingScore: 10, inRule: "DOUBLE" }),
    });
    try {
      executeX01Command(match, visit("no-double", 1, "one", 3, 1));
      expect.unreachable("a single must not open the leg");
    } catch (error: unknown) {
      expect((error as ScoringValidationError).code).toBe("DOUBLE_IN_REQUIRED");
    }

    const missed = executeX01Command(match, visit("miss", 1, "one", 0, 3));
    expect(missed.state.sides[0].openedInLeg).toBe(false);
    expect(missed.state.sides[0].remaining).toBe(10);
  });

  it("opens on a double in a 701 double-in double-out leg", () => {
    let match = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ startingScore: 701, inRule: "DOUBLE" }),
    });
    match = executeX01Command(match, visit("open", 1, "one", 40, 1, 20)).match;
    const opened = projectX01Match(match);
    expect(opened.sides[0].openedInLeg).toBe(true);
    expect(opened.sides[0].remaining).toBe(661);

    match = executeX01Command(match, visit("guest-miss", 2, "two", 0, 3)).match;
    expect(projectX01Match(match).sides[1].openedInLeg).toBe(false);
  });

  it("keeps a side open after a bust in the opening visit", () => {
    const match = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ startingScore: 10, inRule: "DOUBLE" }),
    });
    const result = executeX01Command(match, visit("bust-open", 1, "one", 12, 1, 6));
    expect(result.outcome).toBe("BUST");
    expect(result.state.sides[0].openedInLeg).toBe(true);
    expect(result.state.sides[0].remaining).toBe(10);
  });

  it("lets a bull throw decide who starts the third leg", () => {
    let match = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ startingScore: 40, legsToWinSet: 2, setsToWin: 1 }),
    });
    match = executeX01Command(match, visit("leg1", 1, "one", 40, 1, 20)).match;
    match = executeX01Command(match, visit("leg2-guest", 2, "two", 40, 1, 20)).match;
    expect(projectX01Match(match).legNumber).toBe(3);
    expect(projectX01Match(match).legStartingSeat).toBe(1);

    match = executeX01Command(match, {
      type: "DECIDE_LEG_START",
      commandId: "bull",
      legNumber: 3,
      startingSeat: 2,
    }).match;
    const state = projectX01Match(match);
    expect(state.legStartingSeat).toBe(2);
    expect(state.activeSeat).toBe(2);
  });

  it("refuses to decide the start of the first two legs", () => {
    const match = createX01Match({ sides: singles("one", "two") });
    try {
      executeX01Command(match, {
        type: "DECIDE_LEG_START",
        commandId: "too-early",
        legNumber: 2,
        startingSeat: 2,
      });
      expect.unreachable("leg two is fixed by the reglement");
    } catch (error: unknown) {
      expect((error as ScoringValidationError).code).toBe("LEG_START_FIXED");
    }
  });

  it("refuses to decide the start of a leg that is already running", () => {
    let match = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ startingScore: 40, legsToWinSet: 3, setsToWin: 1 }),
    });
    match = executeX01Command(match, visit("leg1", 1, "one", 40, 1, 20)).match;
    match = executeX01Command(match, visit("leg2", 2, "two", 40, 1, 20)).match;
    match = executeX01Command(match, visit("leg3-open", 1, "one", 20, 1)).match;
    try {
      executeX01Command(match, {
        type: "DECIDE_LEG_START",
        commandId: "late",
        legNumber: 3,
        startingSeat: 2,
      });
      expect.unreachable("the leg is already running");
    } catch (error: unknown) {
      expect((error as ScoringValidationError).code).toBe("LEG_ALREADY_STARTED");
    }
  });

  it("stops the leg at the round limit and decides it by bull", () => {
    let match = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ maxRounds: 2 }),
    });
    for (const [index, seat] of ([1, 2, 1, 2] as const).entries()) {
      match = executeX01Command(
        match,
        visit(`v${index}`, seat, seat === 1 ? "one" : "two", 60),
      ).match;
    }
    const limited = projectX01Match(match);
    expect(limited.roundsPlayedInLeg).toBe(2);
    expect(limited.roundLimitReached).toBe(true);

    try {
      executeX01Command(match, visit("too-many", 1, "one", 60));
      expect.unreachable("the round limit is reached");
    } catch (error: unknown) {
      expect((error as ScoringValidationError).code).toBe("ROUND_LIMIT_REACHED");
    }

    const decided = executeX01Command(match, {
      type: "DECIDE_LEG_BY_BULL",
      commandId: "bull-out",
      winnerSeat: 2,
    });
    expect(decided.outcome).toBe("MATCH_WON");
    expect(decided.state.winnerSeat).toBe(2);
    expect(decided.state.sides[1].totalLegsWon).toBe(1);
    expect(decided.state.legDecisions).toHaveLength(1);
  });

  it("refuses the bull decision before the round limit and without one", () => {
    let match = createX01Match({ sides: singles("one", "two"), rules: rules({ maxRounds: 2 }) });
    match = executeX01Command(match, visit("v0", 1, "one", 60)).match;
    try {
      executeX01Command(match, { type: "DECIDE_LEG_BY_BULL", commandId: "early", winnerSeat: 1 });
      expect.unreachable("the round limit is not reached");
    } catch (error: unknown) {
      expect((error as ScoringValidationError).code).toBe("ROUND_LIMIT_NOT_REACHED");
    }

    const unlimited = createX01Match({ sides: singles("one", "two") });
    try {
      executeX01Command(unlimited, { type: "DECIDE_LEG_BY_BULL", commandId: "no-limit", winnerSeat: 1 });
      expect.unreachable("a match without a round limit is never decided by bull");
    } catch (error: unknown) {
      expect((error as ScoringValidationError).code).toBe("ROUND_LIMIT_NOT_REACHED");
    }
  });

  it("continues with the next leg after a leg decided by bull", () => {
    let match = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ maxRounds: 1, legsToWinSet: 2, setsToWin: 1 }),
    });
    match = executeX01Command(match, visit("a", 1, "one", 60)).match;
    match = executeX01Command(match, visit("b", 2, "two", 60)).match;
    match = executeX01Command(match, {
      type: "DECIDE_LEG_BY_BULL",
      commandId: "bull-1",
      winnerSeat: 1,
    }).match;
    const state = projectX01Match(match);
    expect(state.status).toBe("IN_PROGRESS");
    expect(state.legNumber).toBe(2);
    expect(state.legStartingSeat).toBe(2);
    expect(state.sides[0].remaining).toBe(501);
    expect(state.roundsPlayedInLeg).toBe(0);
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
    const match = createX01Match({ sides: singles("a", "b"), rules: rules({ startingScore: remaining as number }) });
    const result = executeX01Command(match, visit("1", 1, "a", points as number, 3, checkoutDouble));
    expect(result.state.visits[0]?.outcome).toBe("BUST");
    expect(result.state.sides[0].remaining).toBe(remaining);
  });

  it("accepts a checkout with fewer than three darts", () => {
    const match = createX01Match({ sides: singles("a", "b"), rules: rules({ startingScore: 40 }) });
    const result = executeX01Command(match, visit("1", 1, "a", 40, 1, 20));
    expect(result.state.status).toBe("COMPLETED");
    expect(result.state.visits[0]?.outcome).toBe("MATCH_WON");
  });

  it("tracks leg, set and match wins", () => {
    let match = createX01Match({ sides: singles("a", "b"), rules: rules({ startingScore: 40, legsToWinSet: 2, setsToWin: 2 }) });
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
      rules: rules({ startingScore: 40, legsToWinSet: 2, setsToWin: 1 }),
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

  it("returns the throw to the same person when a doubles visit is undone mid rotation", () => {
    let match = createX01Match({
      sides: [
        { seat: 1, playerIds: ["a1", "a2"] },
        { seat: 2, playerIds: ["b1", "b2"] },
      ],
    });
    match = executeX01Command(match, visit("1", 1, "a1", 60)).match;
    match = executeX01Command(match, visit("2", 2, "b1", 60)).match;
    const played = executeX01Command(match, visit("3", 1, "a2", 100));
    match = played.match;
    // Mitten in der Rotation: Seite 1 hat a1 und a2 geworfen, dran ist b2.
    expect(played.state.activeSeat).toBe(2);
    expect(played.state.activeThrowerPlayerId).toBe("b2");
    expect(played.state.sides[0].remaining).toBe(341);

    const undone = executeX01Command(match, {
      type: "UNDO_LAST_VISIT",
      commandId: "u3",
      targetCommandId: "3",
    });
    // Nicht a1: der Wurf gehoert weiter a2, nur eben noch einmal.
    expect(undone.state.activeSeat).toBe(1);
    expect(undone.state.activeThrowerPlayerId).toBe("a2");
    expect(undone.state.sides[0].remaining).toBe(441);
    expect(undone.state.visits).toHaveLength(2);

    const replayed = executeX01Command(undone.match, visit("3b", 1, "a2", 41));
    expect(replayed.state.sides[0].remaining).toBe(400);
    expect(replayed.state.activeThrowerPlayerId).toBe("b2");
  });

  it("returns a doubles checkout to its thrower when the finished leg is undone", () => {
    let match = createX01Match({
      sides: [
        { seat: 1, playerIds: ["a1", "a2"] },
        { seat: 2, playerIds: ["b1", "b2"] },
      ],
      rules: rules({ startingScore: 40, legsToWinSet: 2, setsToWin: 1 }),
    });
    match = executeX01Command(match, visit("1", 1, "a1", 0)).match;
    match = executeX01Command(match, visit("2", 2, "b1", 0)).match;
    const won = executeX01Command(match, visit("3", 1, "a2", 40, 1, 20));
    match = won.match;
    expect(won.outcome).toBe("LEG_WON");
    expect(won.state.legNumber).toBe(2);
    expect(won.state.activeThrowerPlayerId).toBe("b2");

    const undone = executeX01Command(match, {
      type: "UNDO_LAST_VISIT",
      commandId: "u3",
      targetCommandId: "3",
    });
    // Zurueck in Leg 1: der Legwechsel verschiebt die Reihenfolge nicht.
    expect(undone.state.legNumber).toBe(1);
    expect(undone.state.activeSeat).toBe(1);
    expect(undone.state.activeThrowerPlayerId).toBe("a2");
    expect(undone.state.sides[0].remaining).toBe(40);
    expect(undone.state.sides[0].legsWonInSet).toBe(0);
    expect(undone.state.sides[0].totalLegsWon).toBe(0);
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
