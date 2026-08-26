const dartValues = [
  0,
  ...Array.from({ length: 20 }, (_, index) => index + 1),
  ...Array.from({ length: 20 }, (_, index) => (index + 1) * 2),
  ...Array.from({ length: 20 }, (_, index) => (index + 1) * 3),
  25,
  50,
] as const;

export interface X01Rules {
  readonly startingScore: number;
  readonly doubleOut: boolean;
  readonly legsToWinSet: number;
  readonly setsToWin: number;
}

export interface SubmitVisitCommand {
  readonly type: "SUBMIT_VISIT";
  readonly commandId: string;
  readonly playerId: string;
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

export type X01Command = SubmitVisitCommand | UndoVisitCommand;

export interface X01Match {
  readonly playerIds: readonly [string, string];
  readonly startingPlayerIndex: 0 | 1;
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
  readonly playerId: string;
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

export interface X01PlayerState {
  readonly id: string;
  readonly remaining: number;
  readonly legsWonInSet: number;
  readonly totalLegsWon: number;
  readonly setsWon: number;
}

export interface X01MatchState {
  readonly status: "IN_PROGRESS" | "COMPLETED";
  readonly winnerPlayerId: string | null;
  readonly activePlayerId: string | null;
  readonly legStartingPlayerId: string;
  readonly legNumber: number;
  readonly setNumber: number;
  readonly players: readonly [X01PlayerState, X01PlayerState];
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

function assertRules(rules: X01Rules): void {
  if (!Number.isInteger(rules.startingScore) || rules.startingScore < 2) {
    throw new ScoringValidationError("INVALID_STARTING_SCORE", "Starting score must be an integer of at least 2.");
  }
  if (!Number.isInteger(rules.legsToWinSet) || rules.legsToWinSet < 1) {
    throw new ScoringValidationError("INVALID_LEG_TARGET", "Leg target must be a positive integer.");
  }
  if (!Number.isInteger(rules.setsToWin) || rules.setsToWin < 1) {
    throw new ScoringValidationError("INVALID_SET_TARGET", "Set target must be a positive integer.");
  }
}

export function createX01Match(input: {
  readonly playerIds: readonly [string, string];
  readonly startingPlayerIndex?: 0 | 1;
  readonly rules?: X01Rules;
}): X01Match {
  if (input.playerIds[0] === input.playerIds[1]) {
    throw new ScoringValidationError("DUPLICATE_PLAYER", "A match requires two different players.");
  }
  const rules = input.rules ?? {
    startingScore: 501,
    doubleOut: true,
    legsToWinSet: 1,
    setsToWin: 1,
  };
  assertRules(rules);
  return {
    playerIds: input.playerIds,
    startingPlayerIndex: input.startingPlayerIndex ?? 0,
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

function initialPlayer(id: string, startingScore: number): X01PlayerState {
  return { id, remaining: startingScore, legsWonInSet: 0, totalLegsWon: 0, setsWon: 0 };
}

function replacePlayer(
  players: readonly [X01PlayerState, X01PlayerState],
  index: 0 | 1,
  player: X01PlayerState,
): [X01PlayerState, X01PlayerState] {
  return index === 0 ? [player, players[1]] : [players[0], player];
}

function other(index: 0 | 1): 0 | 1 {
  return index === 0 ? 1 : 0;
}

function activeCommands(commands: readonly X01Command[]): {
  readonly submissions: readonly SubmitVisitCommand[];
  readonly reverted: readonly string[];
} {
  const reverted = new Set(
    commands
      .filter((command): command is UndoVisitCommand => command.type === "UNDO_LAST_VISIT")
      .map((command) => command.targetCommandId),
  );
  return {
    submissions: commands.filter(
      (command): command is SubmitVisitCommand =>
        command.type === "SUBMIT_VISIT" && !reverted.has(command.commandId),
    ),
    reverted: [...reverted],
  };
}

export function projectX01Match(match: X01Match): X01MatchState {
  assertRules(match.rules);
  const active = activeCommands(match.commands);
  let players: [X01PlayerState, X01PlayerState] = [
    initialPlayer(match.playerIds[0], match.rules.startingScore),
    initialPlayer(match.playerIds[1], match.rules.startingScore),
  ];
  let activeIndex: 0 | 1 = match.startingPlayerIndex;
  let legStartingIndex: 0 | 1 = match.startingPlayerIndex;
  let legNumber = 1;
  let setNumber = 1;
  let winnerPlayerId: string | null = null;
  const visits: AppliedVisit[] = [];

  for (const command of active.submissions) {
    if (winnerPlayerId !== null) {
      throw new ScoringValidationError("MATCH_ALREADY_COMPLETED", "No visit can be added to a completed match.");
    }
    validateVisit(command);
    const player = players[activeIndex];
    if (player.id !== command.playerId) {
      throw new ScoringValidationError("NOT_ACTIVE_PLAYER", "The visit does not belong to the active player.");
    }
    const scoreBefore = player.remaining;
    const tentative = scoreBefore - command.points;
    const doubleValue = command.checkoutDouble === undefined ? null : checkoutValue(command.checkoutDouble);
    const validDoubleCheckout =
      doubleValue !== null &&
      command.points >= doubleValue &&
      attainableTotals(command.dartsThrown - 1).has(command.points - doubleValue);
    const validCheckout =
      tentative === 0 && (!match.rules.doubleOut || validDoubleCheckout);
    const bust =
      tentative < 0 ||
      (match.rules.doubleOut && tentative === 1) ||
      (tentative === 0 && !validCheckout);
    let outcome: VisitOutcome = bust ? "BUST" : "SCORED";
    let scoreAfter = bust ? scoreBefore : tentative;

    if (validCheckout) {
      const legsWonInSet = player.legsWonInSet + 1;
      const totalLegsWon = player.totalLegsWon + 1;
      const setWon = legsWonInSet >= match.rules.legsToWinSet;
      const setsWon = player.setsWon + (setWon ? 1 : 0);
      const matchWon = setsWon >= match.rules.setsToWin;
      outcome = matchWon ? "MATCH_WON" : setWon ? "SET_WON" : "LEG_WON";
      players = replacePlayer(players, activeIndex, {
        ...player,
        remaining: 0,
        legsWonInSet: setWon ? 0 : legsWonInSet,
        totalLegsWon,
        setsWon,
      });
      scoreAfter = 0;
      if (matchWon) {
        winnerPlayerId = player.id;
      }
    } else if (!bust) {
      players = replacePlayer(players, activeIndex, { ...player, remaining: tentative });
    }

    visits.push({
      commandId: command.commandId,
      playerId: command.playerId,
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

    if (validCheckout && winnerPlayerId === null) {
      legNumber += 1;
      if (outcome === "SET_WON") setNumber += 1;
      legStartingIndex = other(legStartingIndex);
      activeIndex = legStartingIndex;
      players = [
        { ...players[0], remaining: match.rules.startingScore },
        { ...players[1], remaining: match.rules.startingScore },
      ];
    } else if (!validCheckout) {
      activeIndex = other(activeIndex);
    }
  }

  return {
    status: winnerPlayerId === null ? "IN_PROGRESS" : "COMPLETED",
    winnerPlayerId,
    activePlayerId: winnerPlayerId === null ? players[activeIndex].id : null,
    legStartingPlayerId: players[legStartingIndex].id,
    legNumber,
    setNumber,
    players,
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
  const nextMatch: X01Match = { ...match, commands: [...match.commands, command] };
  const state = projectX01Match(nextMatch);
  return {
    match: nextMatch,
    state,
    duplicate: false,
    outcome: command.type === "UNDO_LAST_VISIT" ? "VISIT_UNDONE" : (state.visits.at(-1)?.outcome ?? null),
  };
}
