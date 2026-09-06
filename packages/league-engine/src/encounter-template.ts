import type { InRule, OutRule, TemplateSlot } from "./template.js";

export type StartingScore = 301 | 501 | 701;

export interface TemplateOptions {
  readonly lineupPositions: number;
  readonly singlesStartingScore: StartingScore;
  readonly doublesStartingScore: StartingScore;
  readonly inRule: InRule;
  readonly outRule: OutRule;
  readonly bestOfLegs: number;
  readonly maxRounds: number | null;
  readonly regularDoubles: number;
  readonly withDecider: boolean;
}

/**
 * Reglement 2.2.8, Nationalliga (1.1): vier Runden zu vier Einzel 501 DI/DO,
 * die beiden Doppel 701 nach Runde 2, bei Gleichstand ein Entscheidungsdoppel
 * (2.2.2). Jedes Spiel geht auf zwei Gewinnsätze (A1.2), insgesamt 16 Einzel
 * und 2 Doppel (2.2.1, A1.1).
 */
export const vfcTemplateOptions: TemplateOptions = {
  lineupPositions: 4,
  singlesStartingScore: 501,
  doublesStartingScore: 701,
  inRule: "DOUBLE",
  outRule: "DOUBLE",
  bestOfLegs: 3,
  maxRounds: null,
  regularDoubles: 2,
  withDecider: true,
};

/**
 * Baut die Begegnungsvorlage. Die Einzel sind ein vollständiges Rundenturnier:
 * in Runde `r` trifft Heimposition `i` auf Gastposition `((i + r - 2) mod n) + 1`.
 * Über `n` Runden tritt damit jede Heimposition genau einmal gegen jede
 * Gastposition an, und in jeder Runde spielt jede Position genau einmal — der
 * Grund für die Reihenfolge in Reglement 2.2.8 („Zwecks Zeiteinsparung").
 * Die regulären Doppel folgen nach Runde `ceil(n / 2)`, das Entscheidungsdoppel
 * steht zuletzt. `validateEncounterTemplate` prüft genau diese Gestalt.
 */
export function buildEncounterTemplate(options: TemplateOptions): readonly TemplateSlot[] {
  const positions = options.lineupPositions;
  const doublesAfterRound = Math.ceil(positions / 2);
  const legsToWinSet = Math.ceil(options.bestOfLegs / 2);
  const slots: TemplateSlot[] = [];
  let sequence = 1;
  let singlesNumber = 1;
  let doublesNumber = 1;

  const singles = (homePosition: number, awayPosition: number): TemplateSlot => ({
    sequence: sequence++,
    role: "REGULAR",
    discipline: "SINGLES",
    label: `Einzel ${singlesNumber++} · Heim ${homePosition} gegen Gast ${awayPosition}`,
    homePosition,
    awayPosition,
    startingScore: options.singlesStartingScore,
    inRule: options.inRule,
    outRule: options.outRule,
    maxRounds: options.maxRounds,
    bestOfLegs: options.bestOfLegs,
    legsToWinSet,
    setsToWin: 1,
  });

  const doubles = (role: "REGULAR" | "DECIDER"): TemplateSlot => ({
    sequence: sequence++,
    role,
    discipline: "DOUBLES",
    label: role === "DECIDER" ? "Entscheidungsdoppel" : `Doppel ${doublesNumber++}`,
    homePosition: null,
    awayPosition: null,
    startingScore: options.doublesStartingScore,
    inRule: options.inRule,
    outRule: options.outRule,
    maxRounds: options.maxRounds,
    bestOfLegs: options.bestOfLegs,
    legsToWinSet,
    setsToWin: 1,
  });

  for (let round = 1; round <= positions; round += 1) {
    for (let home = 1; home <= positions; home += 1) {
      slots.push(singles(home, ((home + round - 2) % positions) + 1));
    }
    if (round === doublesAfterRound) {
      for (let index = 0; index < options.regularDoubles; index += 1) slots.push(doubles("REGULAR"));
    }
  }
  if (options.withDecider) slots.push(doubles("DECIDER"));
  return slots;
}
