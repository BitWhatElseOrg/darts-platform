import { LeagueValidationError } from "./errors.js";
import { otherSide, type Side, type SlotRole } from "./template.js";

export type SlotOutcome =
  | { readonly type: "PENDING" }
  | { readonly type: "CANCELLED" }
  | { readonly type: "WALKOVER"; readonly winner: Side }
  | {
      readonly type: "PLAYED";
      readonly winner: Side;
      readonly homeLegs: number;
      readonly awayLegs: number;
    };

/** Ein Slot der Begegnung, soweit die Wertung ihn braucht. */
export interface ResultSlot {
  readonly sequence: number;
  readonly role: SlotRole;
  readonly legsToWinSet: number;
  readonly setsToWin: number;
  readonly outcome: SlotOutcome;
}

/** Die Wertungsregeln des Wettbewerbs. */
export interface ScoringRules {
  readonly pointsWin: number;
  readonly pointsDraw: number;
  readonly pointsLoss: number;
  readonly pointsDeciderBonus: number;
  readonly deciderRule: "NONE" | "EXTRA_SLOT";
}

export interface ResultInput {
  readonly slots: readonly ResultSlot[];
  readonly scoring: ScoringRules;
  /** Die Seite, die nicht angetreten ist (Reglement 2.1.1, 2.5.1). */
  readonly forfeitSide?: Side | null;
}

export interface EncounterResult {
  readonly homeGames: number;
  readonly awayGames: number;
  readonly homeLegs: number;
  readonly awayLegs: number;
  readonly homePoints: number;
  readonly awayPoints: number;
  readonly result: "HOME_WIN" | "AWAY_WIN" | "DRAW" | null;
  readonly resultType: "PLAYED" | "DECIDER" | "FORFEIT" | null;
  readonly complete: boolean;
}

export interface DeciderDecision {
  readonly status: "REGULAR_SLOTS_PENDING" | "NOT_REQUIRED" | "REQUIRED" | "COMPLETED";
  readonly required: boolean;
  readonly slotSequence: number | null;
}

interface Tally {
  homeGames: number;
  awayGames: number;
  homeLegs: number;
  awayLegs: number;
}

interface Analysis {
  readonly regular: Tally;
  readonly total: Tally;
  readonly regularComplete: boolean;
  readonly decider: ResultSlot | null;
  readonly deciderWinner: Side | null;
}

const winFor = (side: Side): "HOME_WIN" | "AWAY_WIN" =>
  side === "HOME" ? "HOME_WIN" : "AWAY_WIN";

function isTerminal(outcome: SlotOutcome): boolean {
  return outcome.type !== "PENDING";
}

function validateScoringRules(scoring: ScoringRules): void {
  const values = [scoring.pointsWin, scoring.pointsDraw, scoring.pointsLoss, scoring.pointsDeciderBonus];
  if (values.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new LeagueValidationError(
      "INVALID_SCORING_RULES",
      "Punktewerte sind nicht negative ganze Zahlen.",
    );
  }
  if (scoring.pointsWin < scoring.pointsDraw || scoring.pointsDraw < scoring.pointsLoss) {
    throw new LeagueValidationError(
      "INVALID_SCORING_RULES",
      "Ein Sieg bringt mindestens so viele Punkte wie ein Unentschieden und dieses mindestens so viele wie eine Niederlage.",
    );
  }
  if (scoring.pointsDeciderBonus > 0 && scoring.deciderRule !== "EXTRA_SLOT") {
    throw new LeagueValidationError(
      "INVALID_SCORING_RULES",
      "Ein Zusatzpunkt setzt ein Entscheidungsdoppel voraus.",
    );
  }
}

function walkoverLegs(slot: ResultSlot): number {
  if (
    !Number.isInteger(slot.legsToWinSet) ||
    !Number.isInteger(slot.setsToWin) ||
    slot.legsToWinSet <= 0 ||
    slot.setsToWin <= 0
  ) {
    throw new LeagueValidationError(
      "INVALID_SLOT_RESULT",
      `Slot ${slot.sequence} trägt keine gültige Distanz.`,
    );
  }
  return slot.legsToWinSet * slot.setsToWin;
}

function applyOutcome(tally: Tally, slot: ResultSlot): void {
  const { outcome } = slot;
  switch (outcome.type) {
    case "PENDING":
    case "CANCELLED":
      return;
    case "WALKOVER": {
      const legs = walkoverLegs(slot);
      if (outcome.winner === "HOME") {
        tally.homeGames += 1;
        tally.homeLegs += legs;
      } else {
        tally.awayGames += 1;
        tally.awayLegs += legs;
      }
      return;
    }
    case "PLAYED": {
      if (
        !Number.isInteger(outcome.homeLegs) ||
        !Number.isInteger(outcome.awayLegs) ||
        outcome.homeLegs < 0 ||
        outcome.awayLegs < 0
      ) {
        throw new LeagueValidationError(
          "INVALID_SLOT_RESULT",
          `Slot ${slot.sequence} trägt eine unzulässige Legzahl.`,
        );
      }
      tally.homeLegs += outcome.homeLegs;
      tally.awayLegs += outcome.awayLegs;
      if (outcome.winner === "HOME") {
        tally.homeGames += 1;
      } else {
        tally.awayGames += 1;
      }
      return;
    }
  }
}

function analyse(input: ResultInput): Analysis {
  const deciderSlots = input.slots.filter((slot) => slot.role === "DECIDER");
  if (deciderSlots.length > 1) {
    throw new LeagueValidationError(
      "MULTIPLE_DECIDER_SLOTS",
      "Eine Begegnung trägt höchstens einen Entscheidungsslot.",
    );
  }
  const decider = deciderSlots[0] ?? null;

  const regular: Tally = { homeGames: 0, awayGames: 0, homeLegs: 0, awayLegs: 0 };
  const total: Tally = { homeGames: 0, awayGames: 0, homeLegs: 0, awayLegs: 0 };
  let regularComplete = true;

  for (const slot of input.slots) {
    applyOutcome(total, slot);
    if (slot.role === "DECIDER") continue;
    applyOutcome(regular, slot);
    if (!isTerminal(slot.outcome)) {
      regularComplete = false;
    }
  }

  const deciderWinner =
    decider !== null && (decider.outcome.type === "PLAYED" || decider.outcome.type === "WALKOVER")
      ? decider.outcome.winner
      : null;

  return { regular, total, regularComplete, decider, deciderWinner };
}

/** Das festgeschriebene Reglementsergebnis eines Nichtantritts. */
function forfeitResult(input: ResultInput, forfeitSide: Side): EncounterResult {
  const winner = otherSide(forfeitSide);
  let games = 0;
  let legs = 0;
  for (const slot of input.slots) {
    if (slot.role === "DECIDER") continue;
    games += 1;
    legs += walkoverLegs(slot);
  }

  return {
    homeGames: winner === "HOME" ? games : 0,
    awayGames: winner === "AWAY" ? games : 0,
    homeLegs: winner === "HOME" ? legs : 0,
    awayLegs: winner === "AWAY" ? legs : 0,
    homePoints: winner === "HOME" ? input.scoring.pointsWin : input.scoring.pointsLoss,
    awayPoints: winner === "AWAY" ? input.scoring.pointsWin : input.scoring.pointsLoss,
    result: winFor(winner),
    resultType: "FORFEIT",
    complete: true,
  };
}

function requireDeciderSlot(analysis: Analysis): ResultSlot {
  if (analysis.decider === null) {
    throw new LeagueValidationError(
      "MISSING_DECIDER_SLOT",
      "Bei Gleichstand verlangt die Wertungsregel ein Entscheidungsdoppel, die Vorlage trägt aber keines.",
    );
  }
  return analysis.decider;
}

/**
 * Ermittelt je Seite gewonnene Spiele, gewonnene Legs und Punkte. Punkte
 * entstehen erst mit dem Abschluss der Begegnung; bis dahin liefert die
 * Funktion den Zwischenstand in Spielen und Legs.
 */
export function calculateEncounterResult(input: ResultInput): EncounterResult {
  validateScoringRules(input.scoring);

  const forfeitSide = input.forfeitSide ?? null;
  if (forfeitSide !== null) {
    return forfeitResult(input, forfeitSide);
  }

  const analysis = analyse(input);
  const { total, regular } = analysis;
  const pending: EncounterResult = {
    homeGames: total.homeGames,
    awayGames: total.awayGames,
    homeLegs: total.homeLegs,
    awayLegs: total.awayLegs,
    homePoints: 0,
    awayPoints: 0,
    result: null,
    resultType: null,
    complete: false,
  };

  if (!analysis.regularComplete) {
    return pending;
  }

  if (regular.homeGames !== regular.awayGames) {
    const winner: Side = regular.homeGames > regular.awayGames ? "HOME" : "AWAY";
    return {
      ...pending,
      homePoints: winner === "HOME" ? input.scoring.pointsWin : input.scoring.pointsLoss,
      awayPoints: winner === "AWAY" ? input.scoring.pointsWin : input.scoring.pointsLoss,
      result: winFor(winner),
      resultType: "PLAYED",
      complete: true,
    };
  }

  if (input.scoring.deciderRule === "NONE") {
    return {
      ...pending,
      homePoints: input.scoring.pointsDraw,
      awayPoints: input.scoring.pointsDraw,
      result: "DRAW",
      resultType: "PLAYED",
      complete: true,
    };
  }

  requireDeciderSlot(analysis);
  const deciderWinner = analysis.deciderWinner;
  if (deciderWinner === null) {
    return pending;
  }

  return {
    ...pending,
    homePoints:
      input.scoring.pointsDraw + (deciderWinner === "HOME" ? input.scoring.pointsDeciderBonus : 0),
    awayPoints:
      input.scoring.pointsDraw + (deciderWinner === "AWAY" ? input.scoring.pointsDeciderBonus : 0),
    result: winFor(deciderWinner),
    resultType: "DECIDER",
    complete: true,
  };
}

/**
 * Beantwortet, ob nach den regulären Spielen ein Entscheidungsdoppel nötig
 * ist. Die Antwort steuert, ob die Begegnung auf die Doppelmeldung wartet oder
 * abgeschlossen werden kann.
 */
export function resolveDeciderRequirement(input: ResultInput): DeciderDecision {
  validateScoringRules(input.scoring);

  if ((input.forfeitSide ?? null) !== null) {
    return { status: "NOT_REQUIRED", required: false, slotSequence: null };
  }

  const analysis = analyse(input);
  const sequence = analysis.decider?.sequence ?? null;

  if (!analysis.regularComplete) {
    return { status: "REGULAR_SLOTS_PENDING", required: false, slotSequence: sequence };
  }
  if (
    analysis.regular.homeGames !== analysis.regular.awayGames ||
    input.scoring.deciderRule === "NONE"
  ) {
    return { status: "NOT_REQUIRED", required: false, slotSequence: sequence };
  }

  const decider = requireDeciderSlot(analysis);
  if (analysis.deciderWinner !== null) {
    return { status: "COMPLETED", required: true, slotSequence: decider.sequence };
  }
  return { status: "REQUIRED", required: true, slotSequence: decider.sequence };
}
