const dartValues = [
  0,
  ...Array.from({ length: 20 }, (_, index) => index + 1),
  ...Array.from({ length: 20 }, (_, index) => (index + 1) * 2),
  ...Array.from({ length: 20 }, (_, index) => (index + 1) * 3),
  25,
  50,
] as const;

export type InRule = "STRAIGHT" | "DOUBLE";
export type OutRule = "SINGLE" | "DOUBLE" | "MASTER";

export interface X01Rules {
  readonly startingScore: number;
  readonly inRule: InRule;
  readonly outRule: OutRule;
  readonly maxRounds: number | null;
  readonly legsToWinSet: number;
  readonly setsToWin: number;
}

export interface X01Side {
  readonly seat: 1 | 2;
  readonly playerIds: readonly string[];
}

export interface SubmitVisitCommand {
  readonly type: "SUBMIT_VISIT";
  readonly commandId: string;
  readonly seat: 1 | 2;
  readonly throwerPlayerId: string;
  readonly points: number;
  readonly dartsThrown: 1 | 2 | 3;
  readonly checkoutDouble?: number;
  readonly checkoutAttempts?: number;
}

export interface UndoVisitCommand {
  readonly type: "UNDO_LAST_VISIT";
  readonly commandId: string;
  readonly targetCommandId: string;
}

/**
 * Reglement 2.2.9: Leg 1 beginnt die Heimseite, Leg 2 die Gastseite, ab Leg 3
 * entscheidet ein Wurf auf Bull. Fehlt das Kommando, wechselt der Legbeginn
 * wie bisher.
 */
export interface DecideLegStartCommand {
  readonly type: "DECIDE_LEG_START";
  readonly commandId: string;
  readonly legNumber: number;
  readonly startingSeat: 1 | 2;
}

export type X01Command = SubmitVisitCommand | UndoVisitCommand | DecideLegStartCommand;

export interface X01Match {
  readonly sides: readonly [X01Side, X01Side];
  readonly startingSeat: 1 | 2;
  readonly rules: X01Rules;
  readonly commands: readonly X01Command[];
}

export type VisitOutcome =
  | "SCORED"
  | "BUST"
  | "LEG_WON"
  | "SET_WON"
  | "MATCH_WON";

export interface AppliedVisit {
  readonly commandId: string;
  readonly seat: 1 | 2;
  readonly throwerPlayerId: string;
  readonly legNumber: number;
  readonly points: number;
  readonly appliedPoints: number;
  readonly dartsThrown: 1 | 2 | 3;
  readonly scoreBefore: number;
  readonly scoreAfter: number;
  readonly checkoutDouble: number | null;
  readonly checkoutAttempts: number;
  readonly outcome: VisitOutcome;
}

export interface X01SideState {
  readonly seat: 1 | 2;
  readonly playerIds: readonly string[];
  readonly remaining: number;
  readonly openedInLeg: boolean;
  readonly legsWonInSet: number;
  readonly totalLegsWon: number;
  readonly setsWon: number;
}

export interface X01MatchState {
  readonly status: "IN_PROGRESS" | "COMPLETED";
  readonly winnerSeat: 1 | 2 | null;
  readonly activeSeat: 1 | 2 | null;
  readonly activeThrowerPlayerId: string | null;
  readonly legStartingSeat: 1 | 2;
  readonly legNumber: number;
  readonly setNumber: number;
  readonly sides: readonly [X01SideState, X01SideState];
  readonly visits: readonly AppliedVisit[];
  readonly revertedCommandIds: readonly string[];
}

export interface ExecuteX01Result {
  readonly match: X01Match;
  readonly state: X01MatchState;
  readonly duplicate: boolean;
  readonly outcome: VisitOutcome | "VISIT_UNDONE" | null;
}

export class ScoringValidationError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ScoringValidationError";
  }
}

const inRules: readonly InRule[] = ["STRAIGHT", "DOUBLE"];
const outRules: readonly OutRule[] = ["SINGLE", "DOUBLE", "MASTER"];

function assertRules(rules: X01Rules): void {
  if (!Number.isInteger(rules.startingScore) || rules.startingScore < 2) {
    throw new ScoringValidationError("INVALID_STARTING_SCORE", "Starting score must be an integer of at least 2.");
  }
  if (!inRules.includes(rules.inRule)) {
    throw new ScoringValidationError("INVALID_IN_RULE", "In rule must be STRAIGHT or DOUBLE.");
  }
  if (!outRules.includes(rules.outRule)) {
    throw new ScoringValidationError("INVALID_OUT_RULE", "Out rule must be SINGLE, DOUBLE or MASTER.");
  }
  if (rules.maxRounds !== null && (!Number.isInteger(rules.maxRounds) || rules.maxRounds < 1)) {
    throw new ScoringValidationError("INVALID_MAX_ROUNDS", "The round limit must be a positive integer or null.");
  }
  if (!Number.isInteger(rules.legsToWinSet) || rules.legsToWinSet < 1) {
    throw new ScoringValidationError("INVALID_LEG_TARGET", "Leg target must be a positive integer.");
  }
  if (!Number.isInteger(rules.setsToWin) || rules.setsToWin < 1) {
    throw new ScoringValidationError("INVALID_SET_TARGET", "Set target must be a positive integer.");
  }
}

function seatOf(index: 0 | 1): 1 | 2 {
  return index === 0 ? 1 : 2;
}

function indexOfSeat(seat: 1 | 2): 0 | 1 {
  return seat === 1 ? 0 : 1;
}

function throwerFor(side: X01Side, visitsInLeg: number, legNumber: number): string {
  const position = (visitsInLeg + legNumber - 1) % side.playerIds.length;
  const playerId = side.playerIds[position];
  if (playerId === undefined) {
    throw new ScoringValidationError("EMPTY_SIDE", "A side needs at least one player.");
  }
  return playerId;
}

export function createX01Match(input: {
  readonly sides: readonly [X01Side, X01Side];
  readonly startingSeat?: 1 | 2;
  readonly rules?: X01Rules;
}): X01Match {
  const [first, second] = input.sides;
  if (first.playerIds.length === 0 || second.playerIds.length === 0) {
    throw new ScoringValidationError("EMPTY_SIDE", "A side needs at least one player.");
  }
  const all = [...first.playerIds, ...second.playerIds];
  if (new Set(all).size !== all.length) {
    throw new ScoringValidationError("DUPLICATE_PLAYER", "A person can only appear once in a match.");
  }
  const rules = input.rules ?? {
    startingScore: 501,
    inRule: "STRAIGHT",
    outRule: "DOUBLE",
    maxRounds: null,
    legsToWinSet: 1,
    setsToWin: 1,
  };
  assertRules(rules);
  return {
    sides: input.sides,
    startingSeat: input.startingSeat ?? 1,
    rules,
    commands: [],
  };
}

const attainableByDarts = new Map<number, ReadonlySet<number>>();

function attainableTotals(darts: number): ReadonlySet<number> {
  const cached = attainableByDarts.get(darts);
  if (cached !== undefined) return cached;
  let totals = new Set<number>([0]);
  for (let dart = 0; dart < darts; dart += 1) {
    const next = new Set<number>();
    for (const total of totals) {
      for (const value of dartValues) next.add(total + value);
    }
    totals = next;
  }
  attainableByDarts.set(darts, totals);
  return totals;
}

export function isAttainableScore(points: number, dartsThrown: 1 | 2 | 3): boolean {
  return Number.isInteger(points) && points >= 0 && attainableTotals(dartsThrown).has(points);
}

function checkoutValue(segment: number): number | null {
  if (segment === 25) return 50;
  if (Number.isInteger(segment) && segment >= 1 && segment <= 20) return segment * 2;
  return null;
}

const masterFinishes: readonly number[] = [
  ...Array.from({ length: 20 }, (_, index) => (index + 1) * 2),
  ...Array.from({ length: 20 }, (_, index) => (index + 1) * 3),
  50,
];

/**
 * Master Out schliesst auf einem Doppel oder einem Triple; Bull (50) zaehlt als
 * Doppel 25, das aeussere Bull (25) ist ein Single und schliesst nicht. Ohne
 * festgehaltenes Segment prueft die Engine, ob der Visit ueberhaupt so
 * geworfen werden konnte.
 */
function finishesOnMasterSegment(points: number, dartsThrown: 1 | 2 | 3): boolean {
  return masterFinishes.some(
    (value) => points >= value && attainableTotals(dartsThrown - 1).has(points - value),
  );
}

const doubleValues: readonly number[] = [
  ...Array.from({ length: 20 }, (_, index) => (index + 1) * 2),
  50,
];

/**
 * Double In eroeffnet auf einem Doppel als erstem Dart des Visits. Ohne
 * festgehaltenes Segment prueft die Engine, ob der Visit so geworfen werden
 * konnte.
 */
function opensOnDouble(points: number, dartsThrown: 1 | 2 | 3): boolean {
  return doubleValues.some(
    (value) => points >= value && attainableTotals(dartsThrown - 1).has(points - value),
  );
}

function closesLeg(
  outRule: OutRule,
  command: SubmitVisitCommand,
  validDoubleCheckout: boolean,
): boolean {
  switch (outRule) {
    case "SINGLE":
      return true;
    case "DOUBLE":
      return validDoubleCheckout;
    case "MASTER":
      return command.checkoutDouble === undefined
        ? finishesOnMasterSegment(command.points, command.dartsThrown)
        : validDoubleCheckout;
  }
}

function validateVisit(command: SubmitVisitCommand): void {
  if (!isAttainableScore(command.points, command.dartsThrown)) {
    throw new ScoringValidationError("INVALID_VISIT_SCORE", `${command.points} cannot be scored with ${command.dartsThrown} dart(s).`);
  }
  if (command.checkoutDouble !== undefined && checkoutValue(command.checkoutDouble) === null) {
    throw new ScoringValidationError("INVALID_CHECKOUT_DOUBLE", "Checkout double must be D1-D20 or bull (25).");
  }
  if (command.checkoutAttempts !== undefined && (!Number.isInteger(command.checkoutAttempts) || command.checkoutAttempts < 0 || command.checkoutAttempts > command.dartsThrown)) {
    throw new ScoringValidationError("INVALID_CHECKOUT_ATTEMPTS", "Checkout attempts must be between zero and the number of darts thrown.");
  }
}

function initialSide(side: X01Side, rules: X01Rules): X01SideState {
  return {
    seat: side.seat,
    playerIds: side.playerIds,
    remaining: rules.startingScore,
    openedInLeg: rules.inRule === "STRAIGHT",
    legsWonInSet: 0,
    totalLegsWon: 0,
    setsWon: 0,
  };
}

function replaceSide(
  sides: readonly [X01SideState, X01SideState],
  index: 0 | 1,
  side: X01SideState,
): [X01SideState, X01SideState] {
  return index === 0 ? [side, sides[1]] : [sides[0], side];
}

function other(index: 0 | 1): 0 | 1 {
  return index === 0 ? 1 : 0;
}

interface ActiveCommands {
  readonly submissions: readonly SubmitVisitCommand[];
  readonly reverted: readonly string[];
  readonly legStarts: ReadonlyMap<number, 1 | 2>;
}

function activeCommands(commands: readonly X01Command[]): ActiveCommands {
  const reverted = new Set(
    commands
      .filter((command): command is UndoVisitCommand => command.type === "UNDO_LAST_VISIT")
      .map((command) => command.targetCommandId),
  );
  const legStarts = new Map<number, 1 | 2>();
  for (const command of commands) {
    if (command.type !== "DECIDE_LEG_START") continue;
    if (!Number.isInteger(command.legNumber) || command.legNumber < 3) {
      throw new ScoringValidationError(
        "LEG_START_FIXED",
        "Leg one belongs to the home side and leg two to the guest side.",
      );
    }
    if (legStarts.has(command.legNumber)) {
      throw new ScoringValidationError(
        "LEG_START_ALREADY_SET",
        "The starting side of that leg is already decided.",
      );
    }
    legStarts.set(command.legNumber, command.startingSeat);
  }
  return {
    submissions: commands.filter(
      (command): command is SubmitVisitCommand =>
        command.type === "SUBMIT_VISIT" && !reverted.has(command.commandId),
    ),
    reverted: [...reverted],
    legStarts,
  };
}

function nextLegStartIndex(
  legStarts: ReadonlyMap<number, 1 | 2>,
  nextLegNumber: number,
  previous: 0 | 1,
): 0 | 1 {
  const decided = legStarts.get(nextLegNumber);
  return decided === undefined ? other(previous) : indexOfSeat(decided);
}

export function projectX01Match(match: X01Match): X01MatchState {
  assertRules(match.rules);
  const active = activeCommands(match.commands);
  let sides: [X01SideState, X01SideState] = [
    initialSide(match.sides[0], match.rules),
    initialSide(match.sides[1], match.rules),
  ];
  let activeIndex: 0 | 1 = indexOfSeat(match.startingSeat);
  let legStartingIndex: 0 | 1 = activeIndex;
  let visitsInLeg: [number, number] = [0, 0];
  let legNumber = 1;
  let setNumber = 1;
  let winnerSeat: 1 | 2 | null = null;
  const visits: AppliedVisit[] = [];

  for (const command of active.submissions) {
    if (winnerSeat !== null) {
      throw new ScoringValidationError("MATCH_ALREADY_COMPLETED", "No visit can be added to a completed match.");
    }
    validateVisit(command);
    const side = sides[activeIndex];
    if (command.seat !== seatOf(activeIndex)) {
      throw new ScoringValidationError("NOT_ACTIVE_SEAT", "The visit does not belong to the active side.");
    }
    const expectedThrower = throwerFor(match.sides[activeIndex], visitsInLeg[activeIndex], legNumber);
    if (command.throwerPlayerId !== expectedThrower) {
      throw new ScoringValidationError("INVALID_THROWER", "The visit does not belong to the person whose turn it is.");
    }
    if (!side.openedInLeg && command.points > 0 && !opensOnDouble(command.points, command.dartsThrown)) {
      throw new ScoringValidationError(
        "DOUBLE_IN_REQUIRED",
        "The first scoring visit of a leg must start on a double.",
      );
    }
    const openedInLeg = side.openedInLeg || command.points > 0;
    const scoreBefore = side.remaining;
    const tentative = scoreBefore - command.points;
    const doubleValue = command.checkoutDouble === undefined ? null : checkoutValue(command.checkoutDouble);
    const validDoubleCheckout =
      doubleValue !== null &&
      command.points >= doubleValue &&
      attainableTotals(command.dartsThrown - 1).has(command.points - doubleValue);
    const validCheckout = tentative === 0 && closesLeg(match.rules.outRule, command, validDoubleCheckout);
    const bust =
      tentative < 0 ||
      (match.rules.outRule !== "SINGLE" && tentative === 1) ||
      (tentative === 0 && !validCheckout);
    let outcome: VisitOutcome = bust ? "BUST" : "SCORED";
    let scoreAfter = bust ? scoreBefore : tentative;

    if (validCheckout) {
      const legsWonInSet = side.legsWonInSet + 1;
      const totalLegsWon = side.totalLegsWon + 1;
      const setWon = legsWonInSet >= match.rules.legsToWinSet;
      const setsWon = side.setsWon + (setWon ? 1 : 0);
      const matchWon = setsWon >= match.rules.setsToWin;
      outcome = matchWon ? "MATCH_WON" : setWon ? "SET_WON" : "LEG_WON";
      sides = replaceSide(sides, activeIndex, {
        ...side,
        remaining: 0,
        legsWonInSet: setWon ? 0 : legsWonInSet,
        totalLegsWon,
        setsWon,
      });
      scoreAfter = 0;
      if (matchWon) {
        winnerSeat = side.seat;
      }
    } else if (bust) {
      sides = replaceSide(sides, activeIndex, { ...side, openedInLeg });
    } else {
      sides = replaceSide(sides, activeIndex, { ...side, remaining: tentative, openedInLeg });
    }

    visits.push({
      commandId: command.commandId,
      seat: command.seat,
      throwerPlayerId: command.throwerPlayerId,
      legNumber,
      points: command.points,
      appliedPoints: bust ? 0 : command.points,
      dartsThrown: command.dartsThrown,
      scoreBefore,
      scoreAfter,
      checkoutDouble: command.checkoutDouble ?? null,
      checkoutAttempts: command.checkoutAttempts ?? (command.checkoutDouble === undefined ? 0 : 1),
      outcome,
    });

    visitsInLeg =
      activeIndex === 0
        ? [visitsInLeg[0] + 1, visitsInLeg[1]]
        : [visitsInLeg[0], visitsInLeg[1] + 1];

    if (validCheckout && winnerSeat === null) {
      legNumber += 1;
      if (outcome === "SET_WON") setNumber += 1;
      legStartingIndex = nextLegStartIndex(active.legStarts, legNumber, legStartingIndex);
      activeIndex = legStartingIndex;
      visitsInLeg = [0, 0];
      sides = [
        { ...sides[0], remaining: match.rules.startingScore, openedInLeg: match.rules.inRule === "STRAIGHT" },
        { ...sides[1], remaining: match.rules.startingScore, openedInLeg: match.rules.inRule === "STRAIGHT" },
      ];
    } else if (!validCheckout) {
      activeIndex = other(activeIndex);
    }
  }

  return {
    status: winnerSeat === null ? "IN_PROGRESS" : "COMPLETED",
    winnerSeat,
    activeSeat: winnerSeat === null ? seatOf(activeIndex) : null,
    activeThrowerPlayerId:
      winnerSeat === null
        ? throwerFor(match.sides[activeIndex], visitsInLeg[activeIndex], legNumber)
        : null,
    legStartingSeat: seatOf(legStartingIndex),
    legNumber,
    setNumber,
    sides,
    visits,
    revertedCommandIds: active.reverted,
  };
}

export function executeX01Command(match: X01Match, command: X01Command): ExecuteX01Result {
  if (match.commands.some((existing) => existing.commandId === command.commandId)) {
    return { match, state: projectX01Match(match), duplicate: true, outcome: null };
  }
  if (command.type === "UNDO_LAST_VISIT") {
    const active = activeCommands(match.commands).submissions;
    const latest = active.at(-1);
    if (latest === undefined) {
      throw new ScoringValidationError("NOTHING_TO_UNDO", "There is no active visit to undo.");
    }
    if (command.targetCommandId !== latest.commandId) {
      throw new ScoringValidationError("UNDO_TARGET_NOT_LATEST", "Only the latest active visit can be undone.");
    }
  }
  if (command.type === "DECIDE_LEG_START") {
    const current = projectX01Match(match);
    if (command.legNumber < current.legNumber) {
      throw new ScoringValidationError("LEG_ALREADY_PLAYED", "That leg is already played.");
    }
    if (
      command.legNumber === current.legNumber &&
      current.visits.some((applied) => applied.legNumber === current.legNumber)
    ) {
      throw new ScoringValidationError("LEG_ALREADY_STARTED", "The leg is already running.");
    }
  }
  const nextMatch: X01Match = { ...match, commands: [...match.commands, command] };
  const state = projectX01Match(nextMatch);
  return {
    match: nextMatch,
    state,
    duplicate: false,
    outcome: commandOutcome(command, state),
  };
}

function commandOutcome(
  command: X01Command,
  state: X01MatchState,
): VisitOutcome | "VISIT_UNDONE" | null {
  switch (command.type) {
    case "UNDO_LAST_VISIT":
      return "VISIT_UNDONE";
    case "DECIDE_LEG_START":
      return null;
    case "SUBMIT_VISIT":
      return state.visits.at(-1)?.outcome ?? null;
  }
}
