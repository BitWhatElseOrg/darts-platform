import { describe, expect, it } from "vitest";

import {
  ScoringValidationError,
  createX01Match,
  executeX01Command,
  isAttainableScore,
  previewVisitOutcome,
  projectX01Match,
  type Dart,
  type InRule,
  type OutRule,
  type SubmitVisitCommand,
  type X01Command,
  type X01Match,
  type X01MatchState,
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

/**
 * Replay eines gespeicherten Kommando-Stroms: haengt die Kommandos direkt an
 * und projiziert. Bewusst NICHT ueber `executeX01Command`, weil der
 * Schreibpfad Regeln traegt, die nur fuer NEUE Kommandos gelten
 * (`DARTS_REQUIRED_FOR_DOUBLE_IN`, `CHECKOUT_DETAIL_REQUIRED`). Gespeicherte
 * Kommandos muessen beim Lesen unveraendert gewertet werden — genau das
 * pruefen die Tests, die diesen Helfer verwenden.
 */
function replay(
  match: X01Match,
  ...commands: readonly X01Command[]
): { readonly match: X01Match; readonly state: X01MatchState } {
  const next: X01Match = { ...match, commands: [...match.commands, ...commands] };
  return { match: next, state: projectX01Match(next) };
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
    bullOffFromLegOne: false,
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
    // Ohne Wurfdaten und ohne Segment lehnt der Schreibpfad die Aufnahme heute
    // ab (CHECKOUT_DETAIL_REQUIRED); geprueft wird hier die Wertung eines
    // bereits gespeicherten Kommandos.
    const master = replay(
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

  it("without checkoutMissed, master out still relies on the segment heuristic (backwards compatibility)", () => {
    // Replay statt Schreibpfad: neue Kommandos dieser Form verlangt die Engine
    // seit CHECKOUT_DETAIL_REQUIRED belegt, gespeicherte wertet sie unveraendert.
    const result = replay(
      createX01Match({ sides: singles("one", "two"), rules: rules({ startingScore: 40, outRule: "MASTER" }) }),
      { type: "SUBMIT_VISIT", commandId: "master-heuristic", seat: 1, throwerPlayerId: "one", points: 40, dartsThrown: 3 },
    );
    expect(result.state.status).toBe("COMPLETED");
    expect(result.state.winnerSeat).toBe(1);
  });

  it("with checkoutMissed, master out busts even though the segment heuristic alone would finish", () => {
    const result = executeX01Command(
      createX01Match({ sides: singles("one", "two"), rules: rules({ startingScore: 40, outRule: "MASTER" }) }),
      { type: "SUBMIT_VISIT", commandId: "master-missed", seat: 1, throwerPlayerId: "one", points: 40, dartsThrown: 3, checkoutMissed: true },
    );
    expect(result.outcome).toBe("BUST");
    expect(result.state.status).toBe("IN_PROGRESS");
    expect(result.state.sides[0].remaining).toBe(40);
  });

  it("rejects checkoutMissed combined with a checkout double", () => {
    expect(() =>
      executeX01Command(
        createX01Match({ sides: singles("one", "two"), rules: rules({ startingScore: 40, outRule: "MASTER" }) }),
        { type: "SUBMIT_VISIT", commandId: "contradiction-double", seat: 1, throwerPlayerId: "one", points: 40, dartsThrown: 3, checkoutMissed: true, checkoutDouble: 20 },
      ),
    ).toThrow(ScoringValidationError);
  });

  it("rejects checkoutMissed combined with recorded darts", () => {
    const darts: readonly Dart[] = [{ segment: 20, multiplier: 3 }, { segment: 20, multiplier: 3 }, { segment: 20, multiplier: 1 }];
    expect(() =>
      executeX01Command(
        createX01Match({ sides: singles("one", "two"), rules: rules({ startingScore: 140, outRule: "MASTER" }) }),
        { type: "SUBMIT_VISIT", commandId: "contradiction-darts", seat: 1, throwerPlayerId: "one", points: 140, dartsThrown: 3, checkoutMissed: true, darts },
      ),
    ).toThrow(ScoringValidationError);
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
    // Der Schreibpfad verlangt fuer eine Eroeffnungsaufnahme inzwischen
    // Wurfdaten; `DOUBLE_IN_REQUIRED` ist damit die Wertung eines
    // GESPEICHERTEN Kommandos ohne Wurfdaten geblieben.
    try {
      replay(match, visit("no-double", 1, "one", 3, 1));
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
    // Rundensumme ohne Wurfdaten: als gespeichertes Kommando weiterhin
    // gueltig, im Schreibpfad seit DARTS_REQUIRED_FOR_DOUBLE_IN abgelehnt.
    match = replay(match, visit("open", 1, "one", 40, 1, 20)).match;
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
    const result = replay(match, visit("bust-open", 1, "one", 12, 1, 6));
    expect(result.state.visits.at(-1)?.outcome).toBe("BUST");
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

  it("laesst das sudden-death-Doppel schon Leg eins ausbullen", () => {
    // Reglement 2.2.9: „Ausgenommen von dieser Regel ist das
    // Entscheidungs-Doppel sudden death. Der Spielbeginn wird beim sudden death
    // immer durch Wurf auf Bull entschieden."
    const match = createX01Match({
      sides: singles("one", "two"),
      startingSeat: 1,
      rules: rules({ startingScore: 40, legsToWinSet: 2, setsToWin: 1, bullOffFromLegOne: true }),
    });
    const decided = executeX01Command(match, {
      type: "DECIDE_LEG_START",
      commandId: "bull-leg-one",
      legNumber: 1,
      startingSeat: 2,
    }).match;
    const state = projectX01Match(decided);

    expect(state.legNumber).toBe(1);
    expect(state.legStartingSeat).toBe(2);
    expect(state.activeSeat).toBe(2);
  });

  it("haelt ohne das Flag am festen Legbeginn der ersten beiden Legs fest", () => {
    const match = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ bullOffFromLegOne: false }),
    });
    try {
      executeX01Command(match, {
        type: "DECIDE_LEG_START",
        commandId: "too-early",
        legNumber: 1,
        startingSeat: 2,
      });
      expect.unreachable("leg one belongs to the home side");
    } catch (error: unknown) {
      expect((error as ScoringValidationError).code).toBe("LEG_START_FIXED");
    }
  });

  it("wertet ein gespeichertes DECIDE_LEG_START fuer Leg drei unveraendert (Replay-Sicherheit)", () => {
    // Reglement 2.2.9: das Flag ist eine Match-Regel, kein Kommandofeld.
    // Ein Bestandsmatch traegt `bullOffFromLegOne: false` und muss ein
    // gespeichertes `DECIDE_LEG_START` fuer Leg drei (vor dieser Aenderung
    // zulaessig) beim Replay unveraendert werten.
    const match = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ startingScore: 40, legsToWinSet: 2, setsToWin: 1, bullOffFromLegOne: false }),
    });
    const { state } = replay(
      match,
      visit("leg1", 1, "one", 40, 1, 20),
      visit("leg2-guest", 2, "two", 40, 1, 20),
      { type: "DECIDE_LEG_START", commandId: "bull", legNumber: 3, startingSeat: 2 },
    );
    expect(state.legNumber).toBe(3);
    expect(state.legStartingSeat).toBe(2);
    expect(state.activeSeat).toBe(2);
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

  /**
   * `assertWritableVisit` traegt Regeln fuer die EINGABE (Wurfdaten unter
   * Double In, Abschlussbeleg unter Master Out). Ein Zustand, in dem gar keine
   * Aufnahme mehr moeglich ist, geht ihnen vor: sonst verlangt die Flaeche
   * Wurfdaten fuer ein Leg, das ausgebullt werden muss.
   */
  it("meldet an der Rundengrenze den Zustand, nicht die Eingaberegel", () => {
    let match = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ maxRounds: 2, inRule: "DOUBLE" }),
    });
    // Beide Seiten eroeffnen mit Wurfdaten und spielen zwei volle Runden.
    const opening = (commandId: string, seat: 1 | 2, thrower: string): SubmitVisitCommand => ({
      type: "SUBMIT_VISIT",
      commandId,
      seat,
      throwerPlayerId: thrower,
      points: 40,
      dartsThrown: 3,
      checkoutAttempts: 0,
      darts: [
        { segment: 20, multiplier: 2 },
        { segment: 0, multiplier: 1 },
        { segment: 0, multiplier: 1 },
      ],
    });
    match = executeX01Command(match, opening("r1-one", 1, "one")).match;
    match = executeX01Command(match, opening("r1-two", 2, "two")).match;
    match = executeX01Command(match, visit("r2-one", 1, "one", 60)).match;
    match = executeX01Command(match, visit("r2-two", 2, "two", 60)).match;
    expect(projectX01Match(match).roundLimitReached).toBe(true);

    // Eine Rundensumme ohne Wurfdaten: unter Double In waere das eine
    // Eingaberegel -- aber die Seite hat laengst eroeffnet, und vor allem ist
    // das Leg an der Rundengrenze.
    try {
      executeX01Command(match, visit("too-many", 1, "one", 60));
      expect.unreachable("the round limit is reached");
    } catch (error: unknown) {
      expect((error as ScoringValidationError).code).toBe("ROUND_LIMIT_REACHED");
    }

    // Und auch die noch nicht eroeffnete Gegenseite bekommt den Zustand
    // gemeldet, nicht DARTS_REQUIRED_FOR_DOUBLE_IN.
    let unopened = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ maxRounds: 1, inRule: "DOUBLE" }),
    });
    unopened = executeX01Command(unopened, opening("only-round-one", 1, "one")).match;
    unopened = executeX01Command(unopened, visit("only-round-two", 2, "two", 0)).match;
    expect(projectX01Match(unopened).roundLimitReached).toBe(true);
    try {
      executeX01Command(unopened, visit("past-limit", 1, "one", 61, 3));
      expect.unreachable("the round limit is reached");
    } catch (error: unknown) {
      expect((error as ScoringValidationError).code).toBe("ROUND_LIMIT_REACHED");
    }
  });

  /**
   * Regression zum selben Punkt von der anderen Seite: ein beendetes Match
   * meldet weiterhin MATCH_ALREADY_COMPLETED. Das trug bereits, weil die
   * Projektion fuer ein beendetes Match `activeSeat: null` liefert und
   * `assertWritableVisit` an seinem ersten Waechter aussteigt -- der Test
   * haelt das fest, damit es beim Umbau der Reihenfolge nicht kippt.
   */
  it("meldet fuer ein beendetes Match den Zustand, nicht die Eingaberegel", () => {
    let match = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ startingScore: 40, inRule: "DOUBLE", outRule: "DOUBLE" }),
    });
    match = executeX01Command(match, {
      type: "SUBMIT_VISIT",
      commandId: "finish",
      seat: 1,
      throwerPlayerId: "one",
      points: 40,
      dartsThrown: 1,
      checkoutAttempts: 1,
      checkoutDouble: 20,
      darts: [{ segment: 20, multiplier: 2 }],
    }).match;
    expect(projectX01Match(match).status).toBe("COMPLETED");

    try {
      executeX01Command(match, visit("after-the-end", 2, "two", 61, 3));
      expect.unreachable("the match is over");
    } catch (error: unknown) {
      expect((error as ScoringValidationError).code).toBe("MATCH_ALREADY_COMPLETED");
    }
  });

  /**
   * Rundengrenze erreicht, Seite unter Double In noch nicht eroeffnet,
   * Kommando ohne Wuerfe -- der Zustandsfehler muss vor dem Eingabefehler
   * kommen. Beide Seiten spielen Runde 1 punktelos (kein Doppel, keine
   * Eroeffnung); danach ist Seat 1 wieder an der Reihe, aber unter der
   * Rundengrenze. Ohne die Reihenfolge aus Task 8 meldet die noch
   * unveroeffnete Seite hier DARTS_REQUIRED_FOR_DOUBLE_IN statt
   * ROUND_LIMIT_REACHED.
   */
  it("meldet an der Rundengrenze den Zustand fuer eine noch unveroeffnete Seite", () => {
    let match = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ maxRounds: 1, inRule: "DOUBLE" }),
    });
    match = executeX01Command(match, visit("r1-one", 1, "one", 0)).match;
    match = executeX01Command(match, visit("r1-two", 2, "two", 0)).match;
    expect(projectX01Match(match).roundLimitReached).toBe(true);

    try {
      executeX01Command(match, visit("regression", 1, "one", 60));
      expect.unreachable("the round limit is reached");
    } catch (error: unknown) {
      expect((error as ScoringValidationError).code).toBe("ROUND_LIMIT_REACHED");
    }
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

  it("rejects sides whose declared seat does not match their position", () => {
    // Die Projektion liest den Sitz aus der Position im Tupel. Eine
    // vertauschte oder doppelte Sitzangabe wuerde stillschweigend zu einer
    // anderen Seite gehoeren als das Feld behauptet.
    for (const seats of [
      [2, 1],
      [1, 1],
      [2, 2],
    ] as const) {
      try {
        createX01Match({
          sides: [
            { seat: seats[0], playerIds: ["a"] },
            { seat: seats[1], playerIds: ["b"] },
          ],
        });
        expect.unreachable(`seats ${seats.join("/")} were accepted`);
      } catch (error: unknown) {
        expect((error as ScoringValidationError).code).toBe("INVALID_SEATS");
      }
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

describe("X01 mit Einzelwürfen", () => {
  const sides = singles("p1", "p2");

  const submit = (
    commandId: string,
    throwerPlayerId: string,
    seat: 1 | 2,
    darts: readonly Dart[],
  ): SubmitVisitCommand => ({
    type: "SUBMIT_VISIT", commandId, seat, throwerPlayerId,
    points: darts.reduce((sum, dart) => sum + dart.segment * dart.multiplier, 0),
    dartsThrown: darts.length as 1 | 2 | 3,
    darts,
  });

  it("lehnt eine Aufnahme ab, deren Würfe nicht zur Punktzahl passen", () => {
    const match = createX01Match({ rules: rules(), sides, startingSeat: 1 });
    expect(() => executeX01Command(match, {
      type: "SUBMIT_VISIT", commandId: "c1", seat: 1, throwerPlayerId: "p1",
      points: 100, dartsThrown: 3,
      darts: [{ segment: 20, multiplier: 1 }, { segment: 20, multiplier: 1 }, { segment: 20, multiplier: 1 }],
    })).toThrow(ScoringValidationError);
  });

  it("lehnt eine andere Wurfzahl als dartsThrown ab", () => {
    const match = createX01Match({ rules: rules(), sides, startingSeat: 1 });
    expect(() => executeX01Command(match, {
      type: "SUBMIT_VISIT", commandId: "c1", seat: 1, throwerPlayerId: "p1",
      points: 60, dartsThrown: 3,
      darts: [{ segment: 20, multiplier: 3 }],
    })).toThrow(ScoringValidationError);
  });

  it("schliesst das Leg auf dem tatsächlich geworfenen Doppel", () => {
    const match = createX01Match({ rules: rules({ startingScore: 40 }), sides, startingSeat: 1 });
    const result = executeX01Command(match, submit("c1", "p1", 1, [{ segment: 20, multiplier: 2 }]));
    const visit = result.state.visits.at(-1);
    expect(visit?.outcome).toBe("MATCH_WON");
    expect(visit?.checkoutDouble).toBe(20);
    expect(visit?.darts).toHaveLength(1);
  });

  it("wertet einen Single-Finish bei Double Out als Bust", () => {
    const match = createX01Match({ rules: rules({ startingScore: 20 }), sides, startingSeat: 1 });
    const result = executeX01Command(match, submit("c1", "p1", 1, [{ segment: 20, multiplier: 1 }]));
    expect(result.state.visits.at(-1)?.outcome).toBe("BUST");
  });

  it("lässt Master Out auf einem Triple schliessen", () => {
    const match = createX01Match({ rules: rules({ startingScore: 60, outRule: "MASTER" }), sides, startingSeat: 1 });
    const result = executeX01Command(match, submit("c1", "p1", 1, [{ segment: 20, multiplier: 3 }]));
    const visit = result.state.visits.at(-1);
    expect(visit?.outcome).toBe("MATCH_WON");
    expect(visit?.checkoutDouble).toBeNull();
  });

  it("zählt bei Double In erst ab dem ersten Doppel", () => {
    const match = createX01Match({ rules: rules({ startingScore: 501, inRule: "DOUBLE" }), sides, startingSeat: 1 });
    const result = executeX01Command(match, submit("c1", "p1", 1, [
      { segment: 20, multiplier: 1 },
      { segment: 10, multiplier: 2 },
      { segment: 5, multiplier: 1 },
    ]));
    const visit = result.state.visits.at(-1);
    expect(visit?.points).toBe(45);
    expect(visit?.appliedPoints).toBe(25);
    expect(visit?.scoreAfter).toBe(476);
  });

  it("rechnet bei Double In ohne Doppel nichts an, ohne zu scheitern", () => {
    const match = createX01Match({ rules: rules({ startingScore: 501, inRule: "DOUBLE" }), sides, startingSeat: 1 });
    const result = executeX01Command(match, submit("c1", "p1", 1, [
      { segment: 20, multiplier: 1 }, { segment: 20, multiplier: 1 }, { segment: 20, multiplier: 1 },
    ]));
    const visit = result.state.visits.at(-1);
    expect(visit?.appliedPoints).toBe(0);
    expect(visit?.scoreAfter).toBe(501);
    expect(visit?.outcome).toBe("SCORED");
  });

  it("zählt Würfe auf ein Finishfeld als Checkout-Versuche", () => {
    const match = createX01Match({ rules: rules({ startingScore: 40 }), sides, startingSeat: 1 });
    const result = executeX01Command(match, submit("c1", "p1", 1, [
      { segment: 20, multiplier: 1 },
      { segment: 20, multiplier: 1 },
      { segment: 0, multiplier: 1 },
    ]));
    // Rest 40 vor dem ersten Wurf, Rest 20 vor dem zweiten: zwei Positionen,
    // auf denen ein Doppel geschlossen haette.
    expect(result.state.visits.at(-1)?.checkoutAttempts).toBe(2);
  });

  it("bleibt ohne Würfe beim bisherigen Verhalten", () => {
    const match = createX01Match({ rules: rules({ startingScore: 40 }), sides, startingSeat: 1 });
    const result = executeX01Command(match, {
      type: "SUBMIT_VISIT", commandId: "c1", seat: 1, throwerPlayerId: "p1",
      points: 40, dartsThrown: 2, checkoutDouble: 20,
    });
    expect(result.state.visits.at(-1)?.outcome).toBe("MATCH_WON");
    expect(result.state.visits.at(-1)?.darts).toEqual([]);
  });
});

/**
 * Befund des PR-Agenten: die Wertung über Gesamtsumme und letzten Wurf nimmt
 * Aufnahmen an, die über den Legabschluss hinaus weitergeworfen wurden. Die
 * Fläche verhindert das schon in der Eingabe, ein handgebautes Kommando oder
 * ein Score-Provider-Adapter (Autodarts, Scolia) ist daran nicht gebunden.
 */
describe("X01 Würfe nach dem Legabschluss", () => {
  const sides = singles("p1", "p2");

  const submit = (
    commandId: string,
    throwerPlayerId: string,
    seat: 1 | 2,
    darts: readonly Dart[],
  ): SubmitVisitCommand => ({
    type: "SUBMIT_VISIT", commandId, seat, throwerPlayerId,
    points: darts.reduce((sum, dart) => sum + dart.segment * dart.multiplier, 0),
    dartsThrown: darts.length as 1 | 2 | 3,
    darts,
  });

  const expectRejection = (match: ReturnType<typeof createX01Match>, command: SubmitVisitCommand): void => {
    try {
      executeX01Command(match, command);
      expect.unreachable("Die Aufnahme hätte abgelehnt werden müssen.");
    } catch (error) {
      expect(error).toBeInstanceOf(ScoringValidationError);
      expect((error as ScoringValidationError).code).toBe("DARTS_AFTER_LEG_CLOSED");
    }
  };

  it("lehnt bei Double Out einen Fehlwurf nach dem schliessenden Doppel ab", () => {
    // Der gemeldete Fall: Rest 40, D20 gewinnt das Leg — der Fehlwurf danach
    // wurde bisher als Finish-Wurf gelesen und die Aufnahme zum Bust.
    const match = createX01Match({ rules: rules({ startingScore: 40 }), sides, startingSeat: 1 });
    expectRejection(match, submit("c1", "p1", 1, [
      { segment: 20, multiplier: 2 },
      { segment: 0, multiplier: 1 },
    ]));
  });

  it("lehnt bei Single Out einen Wurf nach dem schliessenden Single ab", () => {
    const match = createX01Match({ rules: rules({ startingScore: 40, outRule: "SINGLE" }), sides, startingSeat: 1 });
    expectRejection(match, submit("c1", "p1", 1, [
      { segment: 20, multiplier: 1 },
      { segment: 20, multiplier: 1 },
      { segment: 0, multiplier: 1 },
    ]));
  });

  it("lehnt bei Master Out einen Wurf nach dem schliessenden Triple ab", () => {
    const match = createX01Match({ rules: rules({ startingScore: 60, outRule: "MASTER" }), sides, startingSeat: 1 });
    expectRejection(match, submit("c1", "p1", 1, [
      { segment: 20, multiplier: 3 },
      { segment: 0, multiplier: 1 },
    ]));
  });

  it("lehnt bei Double In einen Wurf nach dem schliessenden Doppel ab", () => {
    const match = createX01Match({ rules: rules({ startingScore: 40, inRule: "DOUBLE" }), sides, startingSeat: 1 });
    expectRejection(match, submit("c1", "p1", 1, [
      { segment: 20, multiplier: 2 },
      { segment: 0, multiplier: 1 },
    ]));
  });

  it("gewinnt bei Double Out weiterhin auf dem letzten Wurf", () => {
    const match = createX01Match({ rules: rules({ startingScore: 100 }), sides, startingSeat: 1 });
    const result = executeX01Command(match, submit("c1", "p1", 1, [
      { segment: 20, multiplier: 3 },
      { segment: 20, multiplier: 2 },
    ]));
    expect(result.state.visits.at(-1)?.outcome).toBe("MATCH_WON");
    expect(result.state.visits.at(-1)?.checkoutDouble).toBe(20);
  });

  it("gewinnt bei Single Out weiterhin auf dem letzten Wurf", () => {
    const match = createX01Match({ rules: rules({ startingScore: 60, outRule: "SINGLE" }), sides, startingSeat: 1 });
    const result = executeX01Command(match, submit("c1", "p1", 1, [
      { segment: 20, multiplier: 1 },
      { segment: 20, multiplier: 1 },
      { segment: 20, multiplier: 1 },
    ]));
    expect(result.state.visits.at(-1)?.outcome).toBe("MATCH_WON");
  });

  it("gewinnt bei Master Out weiterhin auf dem letzten Wurf", () => {
    const match = createX01Match({ rules: rules({ startingScore: 100, outRule: "MASTER" }), sides, startingSeat: 1 });
    const result = executeX01Command(match, submit("c1", "p1", 1, [
      { segment: 20, multiplier: 1 },
      { segment: 20, multiplier: 1 },
      { segment: 20, multiplier: 3 },
    ]));
    expect(result.state.visits.at(-1)?.outcome).toBe("MATCH_WON");
  });

  it("gewinnt bei Double In auf dem eröffnenden Doppel, das zugleich schliesst", () => {
    const match = createX01Match({ rules: rules({ startingScore: 40, inRule: "DOUBLE" }), sides, startingSeat: 1 });
    const result = executeX01Command(match, submit("c1", "p1", 1, [
      { segment: 20, multiplier: 1 },
      { segment: 20, multiplier: 2 },
    ]));
    expect(result.state.visits.at(-1)?.outcome).toBe("MATCH_WON");
  });

  it("lässt bei Double In einen Wurf vor der Eröffnung nicht schliessen", () => {
    // Master Out, Rest 60: das T20 würde die Ausgangsregel erfüllen, zählt vor
    // dem ersten Doppel aber nicht — es kann das Leg also nicht schliessen, und
    // das folgende Doppel ist kein Wurf "nach dem Legabschluss".
    const match = createX01Match({
      rules: rules({ startingScore: 60, inRule: "DOUBLE", outRule: "MASTER" }),
      sides,
      startingSeat: 1,
    });
    const result = executeX01Command(match, submit("c1", "p1", 1, [
      { segment: 20, multiplier: 3 },
      { segment: 20, multiplier: 2 },
    ]));
    const visit = result.state.visits.at(-1);
    expect(visit?.outcome).toBe("SCORED");
    expect(visit?.appliedPoints).toBe(40);
    expect(visit?.scoreAfter).toBe(20);
  });

  it("nimmt Würfe nach einem Bust weiterhin an", () => {
    // Bewusste Grenze der Prüfung: nach einem Überwurf ist die Aufnahme
    // fachlich zu Ende, die Engine wertet sie aber als Ganzes und kommt zum
    // selben Bust. Es entsteht kein falscher Zustand — eine Ablehnung würde
    // bloss bereits gespeicherte, korrekt gewertete Kommandos im Replay
    // scheitern lassen.
    const match = createX01Match({ rules: rules({ startingScore: 30 }), sides, startingSeat: 1 });
    const result = executeX01Command(match, submit("c1", "p1", 1, [
      { segment: 20, multiplier: 3 },
      { segment: 20, multiplier: 1 },
    ]));
    expect(result.state.visits.at(-1)?.outcome).toBe("BUST");
    expect(result.state.sides[0].remaining).toBe(30);
  });

  it("lässt ein Kommando ohne Würfe unverändert gewinnen", () => {
    // Rückwärtskompatibilität: dieselbe Aufnahme ohne `darts` (D20 plus zwei
    // Fehlwürfe, gemeldet als 40 aus drei Darts) gewinnt weiterhin — die neue
    // Prüfung greift nur, wo Würfe vorliegen.
    const match = createX01Match({ rules: rules({ startingScore: 40 }), sides, startingSeat: 1 });
    const result = executeX01Command(match, {
      type: "SUBMIT_VISIT", commandId: "c1", seat: 1, throwerPlayerId: "p1",
      points: 40, dartsThrown: 3, checkoutDouble: 20,
    });
    expect(result.state.visits.at(-1)?.outcome).toBe("MATCH_WON");
  });
});

describe("previewVisitOutcome", () => {
  it("zaehlt bei Double In erst ab dem ersten Doppel, wie die Engine auch", () => {
    // Reglement-Fall aus Task-8-Review: T20/T20/D20 bei Rest 501 mit Double
    // In. Die Engine zaehlt (siehe "zählt bei Double In erst ab dem ersten
    // Doppel" oben) nur ab dem Doppel: hier 40 Punkte, nicht 160.
    const preview = previewVisitOutcome({
      darts: [
        { segment: 20, multiplier: 3 },
        { segment: 20, multiplier: 3 },
        { segment: 20, multiplier: 2 },
      ],
      remaining: 501,
      rules: { startingScore: 501, inRule: "DOUBLE", outRule: "DOUBLE" },
    });
    expect(preview).toMatchObject({ points: 160, appliedPoints: 40, remaining: 461, complete: true, outcome: "SCORED" });
  });

  /**
   * Review-Befund der Abschlussrunde: die Flaeche am Board sendet `points`
   * aus dieser Vorschau als Aufnahmesumme. Waere darin die angerechnete
   * Summe, verlangte `validateVisit` (DART_SUM_MISMATCH) und dieselbe Regel
   * in `submitVisitSchema` vergeblich Gleichheit mit der Wurfsumme — unter
   * Double In waere die Eroeffnungsaufnahme deshalb nicht absendbar. Der
   * Test haelt fest, dass `points` die rohe Summe ist und die Engine sie
   * annimmt.
   */
  it("liefert eine Aufnahmesumme, die die Engine unter Double In auch annimmt", () => {
    const darts = [
      { segment: 20, multiplier: 3 },
      { segment: 20, multiplier: 3 },
      { segment: 20, multiplier: 2 },
    ] as const;
    const preview = previewVisitOutcome({
      darts,
      remaining: 501,
      rules: { startingScore: 501, inRule: "DOUBLE", outRule: "DOUBLE" },
    });
    const match = createX01Match({ sides: singles("one", "two"), rules: rules({ inRule: "DOUBLE" }) });
    const result = executeX01Command(match, {
      type: "SUBMIT_VISIT",
      commandId: "double-in-preview-sum",
      seat: 1,
      throwerPlayerId: "one",
      points: preview.points,
      dartsThrown: 3,
      darts: [...darts],
    });
    expect(result.state.visits.at(-1)).toMatchObject({ points: 160, appliedPoints: 40, scoreAfter: 461 });
  });

  it("rechnet bei Double In ohne Doppel nichts an, ohne zu scheitern", () => {
    const preview = previewVisitOutcome({
      darts: [
        { segment: 20, multiplier: 1 },
        { segment: 20, multiplier: 1 },
        { segment: 20, multiplier: 1 },
      ],
      remaining: 501,
      rules: { startingScore: 501, inRule: "DOUBLE", outRule: "DOUBLE" },
    });
    expect(preview).toMatchObject({ points: 60, appliedPoints: 0, remaining: 501, complete: true, outcome: "SCORED" });
  });

  it("behandelt eine bereits eroeffnete Seite bei Double In wie Straight In", () => {
    // Rest 461 statt 501: die Seite hat das Leg schon in einer frueheren
    // Aufnahme eroeffnet, der Reststand ist deshalb unter den Startwert
    // gesunken. Alle Wuerfe dieser Aufnahme zaehlen wieder normal.
    const preview = previewVisitOutcome({
      darts: [{ segment: 20, multiplier: 1 }],
      remaining: 461,
      rules: { startingScore: 501, inRule: "DOUBLE", outRule: "DOUBLE" },
    });
    expect(preview).toMatchObject({ points: 20, appliedPoints: 20, remaining: 441, complete: false, outcome: "OPEN" });
  });

  it("erkennt einen Checkout bereits nach dem zweiten Wurf, ohne auf den dritten zu warten", () => {
    const preview = previewVisitOutcome({
      darts: [
        { segment: 20, multiplier: 1 },
        { segment: 20, multiplier: 2 },
      ],
      remaining: 60,
      rules: { startingScore: 501, inRule: "STRAIGHT", outRule: "DOUBLE" },
    });
    expect(preview).toMatchObject({ complete: true, outcome: "CHECKOUT", remaining: 0 });
  });

  it("erkennt den Bust unter null", () => {
    const preview = previewVisitOutcome({
      darts: [{ segment: 20, multiplier: 3 }],
      remaining: 40,
      rules: { startingScore: 501, inRule: "STRAIGHT", outRule: "DOUBLE" },
    });
    expect(preview).toMatchObject({ complete: true, outcome: "BUST", remaining: 40 });
  });

  it("wertet ein Single-Finish bei Double Out als Bust", () => {
    const preview = previewVisitOutcome({
      darts: [{ segment: 20, multiplier: 1 }],
      remaining: 20,
      rules: { startingScore: 501, inRule: "STRAIGHT", outRule: "DOUBLE" },
    });
    expect(preview.outcome).toBe("BUST");
  });

  /**
   * Review-Befund Runde 2: die Ableitung von `openedInLeg` aus `remaining`
   * ist kein unbedingter Fakt, sondern ein dokumentierter Rueckfall mit einer
   * bekannten Luecke. Gegenbeweis: Rest 101 bei Double In/Double Out, die
   * Seite hat mit D20+T20 (100 gezaehlte Punkte ab dem eroeffnenden Doppel)
   * bereits eroeffnet und in derselben Aufnahme ueberworfen (Rest 1 -> Bust).
   * `projectX01Match` schreibt danach `openedInLeg: true` fort, waehrend
   * `remaining` unveraendert bei 101 (== startingScore) bleibt (x01.ts:691
   * und :720). Die Ableitung liest daraus faelschlich "noch nicht
   * eroeffnet" und ignoriert im Folge-Visit T20/T20 alle 120 Punkte.
   */
  it("liest bei einem Bust in der Eroeffnungsaufnahme faelschlich 'noch nicht eroeffnet' (bekannte Grenze des Rueckfalls)", () => {
    const preview = previewVisitOutcome({
      darts: [
        { segment: 20, multiplier: 3 },
        { segment: 20, multiplier: 3 },
      ],
      remaining: 101,
      rules: { startingScore: 101, inRule: "DOUBLE", outRule: "DOUBLE" },
    });
    expect(preview).toEqual({ points: 120, appliedPoints: 0, remaining: 101, complete: false, outcome: "OPEN" });
  });

  it("liefert mit explizit uebergebenem openedInLeg das von der Engine tatsaechlich gewertete Ergebnis", () => {
    const preview = previewVisitOutcome({
      darts: [
        { segment: 20, multiplier: 3 },
        { segment: 20, multiplier: 3 },
      ],
      remaining: 101,
      rules: { startingScore: 101, inRule: "DOUBLE", outRule: "DOUBLE" },
      openedInLeg: true,
    });
    expect(preview).toEqual({ points: 120, appliedPoints: 120, remaining: 101, complete: true, outcome: "BUST" });
  });
});

describe("X01 Audit-Korrekturen", () => {
  /**
   * Befund K1: Mit dem Satzgewinn beginnt die Legzaehlung fuer BEIDE Seiten
   * neu. Vorher behielt die unterlegene Seite ihre Legs aus dem verlorenen
   * Satz und gewann den naechsten mit entsprechend weniger Legs.
   */
  it("setzt die Legzaehlung beim Satzgewinn auf beiden Seiten zurueck", () => {
    let match = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ startingScore: 40, legsToWinSet: 3, setsToWin: 2 }),
    });
    // Satz 1 geht A B A B A: der Legbeginn wechselt, die beginnende Seite
    // checkt jeweils mit D20 aus.
    const setOne: readonly (readonly [string, 1 | 2, string])[] = [
      ["leg1", 1, "one"],
      ["leg2", 2, "two"],
      ["leg3", 1, "one"],
      ["leg4", 2, "two"],
      ["leg5", 1, "one"],
    ];
    for (const [commandId, seat, playerId] of setOne) {
      match = executeX01Command(match, visit(commandId, seat, playerId, 40, 1, 20)).match;
    }
    const afterSet = projectX01Match(match);
    expect(afterSet.setNumber).toBe(2);
    expect(afterSet.sides[0].setsWon).toBe(1);
    expect(afterSet.sides[0].legsWonInSet).toBe(0);
    expect(afterSet.sides[1].legsWonInSet).toBe(0);

    // Satz 2, erstes Leg an die im ersten Satz unterlegene Seite: ein Leg
    // allein darf den Satz nicht entscheiden.
    const next = executeX01Command(match, visit("set2-leg1", 2, "two", 40, 1, 20));
    expect(next.outcome).toBe("LEG_WON");
    expect(next.state.sides[1].legsWonInSet).toBe(1);
    expect(next.state.sides[1].setsWon).toBe(0);
    expect(next.state.setNumber).toBe(2);
  });

  it("wertet einen Satz ohne Gegenlegs unveraendert", () => {
    let match = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ startingScore: 40, legsToWinSet: 3, setsToWin: 2 }),
    });
    match = executeX01Command(match, visit("leg1", 1, "one", 40, 1, 20)).match;
    // Leg 2 beginnt die Gastseite; sie wirft daneben, danach checkt die
    // Heimseite aus.
    match = executeX01Command(match, visit("leg2-miss", 2, "two", 0, 3)).match;
    match = executeX01Command(match, visit("leg2", 1, "one", 40, 1, 20)).match;
    const third = executeX01Command(match, visit("leg3", 1, "one", 40, 1, 20));
    expect(third.outcome).toBe("SET_WON");
    expect(third.state.sides[0].setsWon).toBe(1);
    expect(third.state.sides[0].legsWonInSet).toBe(0);
    expect(third.state.sides[1].legsWonInSet).toBe(0);
    expect(third.state.sides[0].totalLegsWon).toBe(3);
  });

  /**
   * Befund K2: Unter Double In laesst sich aus einer Rundensumme nicht
   * ablesen, wie viele Punkte vor dem eroeffnenden Doppel fielen. Der
   * Schreibpfad verlangt deshalb Wurfdaten, solange die Seite nicht eroeffnet
   * hat.
   */
  it("lehnt eine Rundensumme vor der Eroeffnung unter Double In ab", () => {
    const match = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ startingScore: 501, inRule: "DOUBLE" }),
    });
    try {
      executeX01Command(match, visit("round-sum", 1, "one", 61, 3));
      expect.unreachable("a round sum cannot open a double-in leg");
    } catch (error: unknown) {
      expect((error as ScoringValidationError).code).toBe("DARTS_REQUIRED_FOR_DOUBLE_IN");
    }
    expect(projectX01Match(match).sides[0].remaining).toBe(501);
  });

  it("nimmt dieselbe Eroeffnungsaufnahme mit Wurfdaten an und zaehlt ab dem Doppel", () => {
    const match = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ startingScore: 501, inRule: "DOUBLE" }),
    });
    const result = executeX01Command(match, {
      type: "SUBMIT_VISIT",
      commandId: "opening-darts",
      seat: 1,
      throwerPlayerId: "one",
      points: 61,
      dartsThrown: 3,
      darts: [
        { segment: 1, multiplier: 1 },
        { segment: 20, multiplier: 2 },
        { segment: 20, multiplier: 1 },
      ],
    });
    expect(result.state.visits.at(-1)?.appliedPoints).toBe(60);
    expect(result.state.sides[0].remaining).toBe(441);
    expect(result.state.sides[0].openedInLeg).toBe(true);
  });

  it("nimmt eine Rundensumme nach der Eroeffnung unter Double In an", () => {
    let match = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ startingScore: 501, inRule: "DOUBLE" }),
    });
    match = executeX01Command(match, {
      type: "SUBMIT_VISIT",
      commandId: "open",
      seat: 1,
      throwerPlayerId: "one",
      points: 40,
      dartsThrown: 1,
      darts: [{ segment: 20, multiplier: 2 }],
    }).match;
    match = executeX01Command(match, visit("guest-miss", 2, "two", 0, 3)).match;
    const result = executeX01Command(match, visit("round-sum", 1, "one", 60, 3));
    expect(result.state.sides[0].remaining).toBe(401);
    expect(result.state.visits.at(-1)?.appliedPoints).toBe(60);
  });

  it("nimmt eine Rundensumme unter Straight In unveraendert an", () => {
    const match = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ startingScore: 501 }),
    });
    const result = executeX01Command(match, visit("round-sum", 1, "one", 61, 3));
    expect(result.state.sides[0].remaining).toBe(440);
    expect(result.state.visits.at(-1)?.appliedPoints).toBe(61);
  });

  it("wertet ein gespeichertes Double-In-Kommando ohne Wurfdaten beim Replay unveraendert", () => {
    const stored = replay(
      createX01Match({
        sides: singles("one", "two"),
        rules: rules({ startingScore: 501, inRule: "DOUBLE" }),
      }),
      visit("stored-round-sum", 1, "one", 61, 3),
    );
    expect(stored.state.visits.at(-1)?.appliedPoints).toBe(61);
    expect(stored.state.sides[0].remaining).toBe(440);
  });

  /**
   * Befund D-I1: Ohne Beleg raet die Master-Out-Heuristik permissiv. Neue
   * Kommandos muessen den Abschluss deshalb belegen.
   */
  it("lehnt einen Master-Out-Abschluss ohne Beleg ab", () => {
    const match = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ startingScore: 60, outRule: "MASTER" }),
    });
    try {
      executeX01Command(match, visit("no-detail", 1, "one", 60, 3));
      expect.unreachable("a master-out finish needs a detail");
    } catch (error: unknown) {
      expect((error as ScoringValidationError).code).toBe("CHECKOUT_DETAIL_REQUIRED");
    }
    expect(projectX01Match(match).status).toBe("IN_PROGRESS");
  });

  it("nimmt einen Master-Out-Abschluss mit checkoutDouble an", () => {
    const result = executeX01Command(
      createX01Match({
        sides: singles("one", "two"),
        rules: rules({ startingScore: 60, outRule: "MASTER" }),
      }),
      visit("with-double", 1, "one", 60, 3, 10),
    );
    expect(result.outcome).toBe("MATCH_WON");
  });

  it("wertet denselben Rest mit Wurfdaten regelrichtig", () => {
    const bust = executeX01Command(
      createX01Match({
        sides: singles("one", "two"),
        rules: rules({ startingScore: 60, outRule: "MASTER" }),
      }),
      {
        type: "SUBMIT_VISIT",
        commandId: "three-singles",
        seat: 1,
        throwerPlayerId: "one",
        points: 60,
        dartsThrown: 3,
        darts: [
          { segment: 20, multiplier: 1 },
          { segment: 20, multiplier: 1 },
          { segment: 20, multiplier: 1 },
        ],
      },
    );
    expect(bust.outcome).toBe("BUST");
    expect(bust.state.sides[0].remaining).toBe(60);

    const finish = executeX01Command(
      createX01Match({
        sides: singles("one", "two"),
        rules: rules({ startingScore: 60, outRule: "MASTER" }),
      }),
      {
        type: "SUBMIT_VISIT",
        commandId: "treble",
        seat: 1,
        throwerPlayerId: "one",
        points: 60,
        dartsThrown: 1,
        darts: [{ segment: 20, multiplier: 3 }],
      },
    );
    expect(finish.outcome).toBe("MATCH_WON");
  });

  it("nimmt einen Master-Out-Abschluss mit checkoutMissed als Bust an", () => {
    const result = executeX01Command(
      createX01Match({
        sides: singles("one", "two"),
        rules: rules({ startingScore: 60, outRule: "MASTER" }),
      }),
      { type: "SUBMIT_VISIT", commandId: "missed", seat: 1, throwerPlayerId: "one", points: 60, dartsThrown: 3, checkoutMissed: true },
    );
    expect(result.outcome).toBe("BUST");
    expect(result.state.sides[0].remaining).toBe(60);
  });

  it("wertet ein gespeichertes Master-Out-Kommando ohne Beleg beim Replay unveraendert", () => {
    const stored = replay(
      createX01Match({
        sides: singles("one", "two"),
        rules: rules({ startingScore: 60, outRule: "MASTER" }),
      }),
      visit("stored-no-detail", 1, "one", 60, 3),
    );
    expect(stored.state.status).toBe("COMPLETED");
    expect(stored.state.winnerSeat).toBe(1);
  });
});

describe("X01 Checkout-Segment", () => {
  /**
   * Befund F2: `checkoutDouble` kann per `checkoutValue` nur D1-D20 und Bull
   * tragen. Ein Triple-Finish unter Master Out war damit ohne Einzelwuerfe
   * nicht belegbar und fiel seit `CHECKOUT_DETAIL_REQUIRED` durch. Das neue
   * Feld `checkoutSegment` traegt Segment UND Multiplikator.
   */
  it("nimmt ein Triple-Finish unter Master Out mit checkoutSegment an", () => {
    const result = executeX01Command(
      createX01Match({ sides: singles("one", "two"), rules: rules({ startingScore: 60, outRule: "MASTER" }) }),
      {
        type: "SUBMIT_VISIT", commandId: "triple-finish", seat: 1, throwerPlayerId: "one",
        points: 60, dartsThrown: 1, checkoutSegment: { segment: 20, multiplier: 3 },
      },
    );
    expect(result.outcome).toBe("MATCH_WON");
    // Ein Triple fuellt `checkoutDouble` nicht: das Feld kennt nur Doppel.
    expect(result.state.visits.at(-1)?.checkoutDouble).toBeNull();
    expect(result.state.visits.at(-1)?.checkoutAttempts).toBe(1);
  });

  it("nimmt ein Doppel-Finish mit checkoutSegment an und fuellt checkoutDouble", () => {
    const result = executeX01Command(
      createX01Match({ sides: singles("one", "two"), rules: rules({ startingScore: 40, outRule: "MASTER" }) }),
      {
        type: "SUBMIT_VISIT", commandId: "double-finish", seat: 1, throwerPlayerId: "one",
        points: 40, dartsThrown: 2, checkoutSegment: { segment: 20, multiplier: 2 },
      },
    );
    expect(result.outcome).toBe("MATCH_WON");
    expect(result.state.visits.at(-1)?.checkoutDouble).toBe(20);
  });

  it("wertet ein Single-Segment unter Master Out als Bust", () => {
    const result = executeX01Command(
      createX01Match({ sides: singles("one", "two"), rules: rules({ startingScore: 60, outRule: "MASTER" }) }),
      {
        type: "SUBMIT_VISIT", commandId: "single-finish", seat: 1, throwerPlayerId: "one",
        points: 60, dartsThrown: 3, checkoutSegment: { segment: 20, multiplier: 1 },
      },
    );
    expect(result.outcome).toBe("BUST");
    expect(result.state.sides[0].remaining).toBe(60);
  });

  it("wertet ein Triple-Segment unter Double Out als Bust", () => {
    const result = executeX01Command(
      createX01Match({ sides: singles("one", "two"), rules: rules({ startingScore: 60, outRule: "DOUBLE" }) }),
      {
        type: "SUBMIT_VISIT", commandId: "triple-under-double-out", seat: 1, throwerPlayerId: "one",
        points: 60, dartsThrown: 1, checkoutSegment: { segment: 20, multiplier: 3 },
      },
    );
    expect(result.outcome).toBe("BUST");
  });

  /**
   * Dieselben zwei Bedingungen wie bei `checkoutDouble`: der Segmentwert muss
   * in der Rundensumme stecken und der Rest mit den uebrigen Darts werfbar
   * sein. 60 Punkte mit einem Dart lassen neben T20 keinen Rest zu, ein
   * gemeldetes D20 (40) waere also nicht geworfen worden.
   */
  it("lehnt ein Segment ab, das nicht in die Rundensumme passt", () => {
    const result = executeX01Command(
      createX01Match({ sides: singles("one", "two"), rules: rules({ startingScore: 60, outRule: "MASTER" }) }),
      {
        type: "SUBMIT_VISIT", commandId: "impossible-segment", seat: 1, throwerPlayerId: "one",
        points: 60, dartsThrown: 1, checkoutSegment: { segment: 20, multiplier: 2 },
      },
    );
    expect(result.outcome).toBe("BUST");
  });

  it("weist checkoutSegment neben darts, checkoutMissed oder checkoutDouble zurueck", () => {
    const match = createX01Match({ sides: singles("one", "two"), rules: rules({ startingScore: 60, outRule: "MASTER" }) });
    const base = {
      type: "SUBMIT_VISIT" as const, commandId: "conflicting", seat: 1 as const, throwerPlayerId: "one",
      points: 60, dartsThrown: 1 as const, checkoutSegment: { segment: 20, multiplier: 3 as const },
    };
    for (const extra of [
      { darts: [{ segment: 20, multiplier: 3 as const }] },
      { checkoutMissed: true },
      { checkoutDouble: 20 },
    ]) {
      expect(() => executeX01Command(match, { ...base, ...extra })).toThrow(ScoringValidationError);
    }
  });

  it("weist ein ungueltiges Segment zurueck", () => {
    expect(() =>
      executeX01Command(
        createX01Match({ sides: singles("one", "two"), rules: rules({ startingScore: 60, outRule: "MASTER" }) }),
        {
          type: "SUBMIT_VISIT", commandId: "invalid-segment", seat: 1, throwerPlayerId: "one",
          points: 60, dartsThrown: 3, checkoutSegment: { segment: 25, multiplier: 3 },
        },
      ),
    ).toThrow(ScoringValidationError);
  });

  it("belegt einen Master-Out-Abschluss und macht CHECKOUT_DETAIL_REQUIRED gegenstandslos", () => {
    const result = executeX01Command(
      createX01Match({ sides: singles("one", "two"), rules: rules({ startingScore: 57, outRule: "MASTER" }) }),
      {
        type: "SUBMIT_VISIT", commandId: "detail-provided", seat: 1, throwerPlayerId: "one",
        points: 57, dartsThrown: 2, checkoutSegment: { segment: 19, multiplier: 3 },
      },
    );
    expect(result.outcome).toBe("MATCH_WON");
  });

  /**
   * Replay-Sicherheit: das Feld ist rein additiv. Derselbe Kommando-Strom
   * OHNE `checkoutSegment` ergibt exakt denselben Zustand wie vor der
   * Erweiterung — gespeicherte Kommandos aendern ihre Wertung nicht.
   */
  it("laesst gespeicherte Kommandos ohne checkoutSegment unveraendert", () => {
    const stored = replay(
      createX01Match({ sides: singles("one", "two"), rules: rules({ startingScore: 121 }) }),
      visit("v1", 1, "one", 60, 3),
      visit("v2", 2, "two", 0, 3),
      visit("v3", 1, "one", 61, 3, 20),
    );
    expect(stored.state.status).toBe("COMPLETED");
    expect(stored.state.winnerSeat).toBe(1);
    expect(stored.state.visits.map((applied) => applied.outcome)).toEqual(["SCORED", "SCORED", "MATCH_WON"]);
    expect(stored.state.visits.map((applied) => applied.checkoutDouble)).toEqual([null, null, 20]);
    expect(stored.state.visits.map((applied) => applied.checkoutAttempts)).toEqual([0, 0, 1]);
  });

  /**
   * Minor aus dem F1-Review: der D-I1-Block rechnet mit der ROHEN
   * Rundensumme. Unter Double In vor der Eroeffnung ist die nicht die
   * angerechnete — dort greift aber schon der Double-In-Block. Mit Wurfdaten
   * greift keiner von beiden, und die Engine zaehlt korrekt ab dem Doppel.
   */
  it("laesst unter Master Out und Double In vor der Eroeffnung die Wurfdaten entscheiden", () => {
    const match = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ startingScore: 60, inRule: "DOUBLE", outRule: "MASTER" }),
    });
    // Ohne Wurfdaten schlaegt die Double-In-Regel zu, nicht die Master-Regel.
    expect(() =>
      executeX01Command(match, visit("raw-sum", 1, "one", 60, 3)),
    ).toThrow(/double in/i);
    // Mit Wurfdaten: S20 zaehlt nicht (kein Doppel), D20 eroeffnet, S20
    // bringt den Rest auf 60 - 40 - 20 = 0, schliesst aber als Single nicht.
    const withDarts = executeX01Command(match, {
      type: "SUBMIT_VISIT", commandId: "with-darts", seat: 1, throwerPlayerId: "one",
      points: 80, dartsThrown: 3,
      darts: [
        { segment: 20, multiplier: 1 },
        { segment: 20, multiplier: 2 },
        { segment: 20, multiplier: 1 },
      ],
    });
    expect(withDarts.outcome).toBe("BUST");
    expect(withDarts.state.sides[0].openedInLeg).toBe(true);
  });
});
