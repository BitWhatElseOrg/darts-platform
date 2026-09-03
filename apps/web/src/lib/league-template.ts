import type { CompetitionSlotInput, InRule, OutRule } from "@darts-platform/schemas";

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
 * die beiden Doppel 701 nach Runde 2, bei Gleichstand ein
 * Entscheidungsdoppel. Jedes Spiel geht auf zwei Gewinnsätze (A1.2).
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
 * Die Einzel sind ein vollständiges Rundenturnier: in Runde `r` trifft
 * Heimposition `i` auf Gastposition `((i + r - 2) mod n) + 1`. Über `n`
 * Runden tritt damit jede Heimposition genau einmal gegen jede Gastposition
 * an — die Bedingung, die `validateEncounterTemplate` der League-Engine
 * prüft. Die Doppel folgen nach der Hälfte der Runden, wie es der Modus
 * vorsieht.
 */
export function buildEncounterTemplate(options: TemplateOptions): readonly CompetitionSlotInput[] {
  const positions = options.lineupPositions;
  const doublesAfterRound = Math.ceil(positions / 2);
  const legsToWinSet = Math.ceil(options.bestOfLegs / 2);
  const slots: CompetitionSlotInput[] = [];
  let sequence = 1;
  let singlesNumber = 1;
  let doublesNumber = 1;

  const singles = (homePosition: number, awayPosition: number): CompetitionSlotInput => ({
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

  const doubles = (role: "REGULAR" | "DECIDER"): CompetitionSlotInput => ({
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

const slugReplacements: Readonly<Record<string, string>> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  Ä: "ae",
  Ö: "oe",
  Ü: "ue",
  ß: "ss",
};

/**
 * Der Vertrag verlangt `^[a-z0-9]+(?:-[a-z0-9]+)*$`. Umlaute werden
 * ausgeschrieben statt entfernt, damit „Gruppe Süd" nicht zu „gruppe-sd" wird.
 */
export function slugFromName(name: string): string {
  return name
    .replace(/[äöüÄÖÜß]/gu, (character) => slugReplacements[character] ?? character)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}
