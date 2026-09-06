import { LeagueValidationError } from "./errors.js";

export type Side = "HOME" | "AWAY";
export type SlotRole = "REGULAR" | "DECIDER";
export type Discipline = "SINGLES" | "DOUBLES";
export type InRule = "STRAIGHT" | "DOUBLE";
export type OutRule = "SINGLE" | "DOUBLE" | "MASTER";

const STARTING_SCORES: readonly number[] = [301, 501, 701];

/**
 * Eine Position der Begegnungsvorlage. Die Felder spiegeln `competition_slots`
 * und die daraus kopierten `encounter_slots`.
 */
export interface TemplateSlot {
  readonly sequence: number;
  readonly role: SlotRole;
  readonly discipline: Discipline;
  readonly label: string;
  readonly homePosition: number | null;
  readonly awayPosition: number | null;
  readonly startingScore: number;
  readonly inRule: InRule;
  readonly outRule: OutRule;
  readonly maxRounds: number | null;
  readonly bestOfLegs: number;
  readonly legsToWinSet: number;
  readonly setsToWin: number;
}

export function otherSide(side: Side): Side {
  return side === "HOME" ? "AWAY" : "HOME";
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/**
 * Prüft eine Begegnungsvorlage: lückenlose Sequenz ab 1, höchstens ein
 * Entscheidungsslot als letzter Doppelslot, konsistente Disziplin, Startscore
 * und Distanz, sowie das vollständige Rundenturnier der Einzel und die
 * Rundenfolge nach Reglement 2.2.8.
 */
export function validateEncounterTemplate(slots: readonly TemplateSlot[]): void {
  if (slots.length === 0) {
    throw new LeagueValidationError("EMPTY_TEMPLATE", "Eine Vorlage braucht mindestens einen Slot.");
  }

  const sequences = new Set<number>();
  for (const slot of slots) {
    if (!isPositiveInteger(slot.sequence)) {
      throw new LeagueValidationError(
        "NON_CONTIGUOUS_SLOT_SEQUENCE",
        "Jede Slotsequenz muss eine positive ganze Zahl sein.",
      );
    }
    if (sequences.has(slot.sequence)) {
      throw new LeagueValidationError(
        "DUPLICATE_SLOT_SEQUENCE",
        `Die Slotsequenz ${slot.sequence} kommt mehrfach vor.`,
      );
    }
    sequences.add(slot.sequence);
  }
  for (let sequence = 1; sequence <= slots.length; sequence += 1) {
    if (!sequences.has(sequence)) {
      throw new LeagueValidationError(
        "NON_CONTIGUOUS_SLOT_SEQUENCE",
        `Die Slotsequenz ${sequence} fehlt; die Vorlage muss lückenlos ab 1 nummeriert sein.`,
      );
    }
  }

  for (const slot of slots) {
    validateSlotShape(slot);
  }

  const deciderSlots = slots.filter((slot) => slot.role === "DECIDER");
  if (deciderSlots.length > 1) {
    throw new LeagueValidationError(
      "MULTIPLE_DECIDER_SLOTS",
      "Eine Vorlage trägt höchstens einen Entscheidungsslot.",
    );
  }
  const decider = deciderSlots[0];
  if (decider !== undefined) {
    if (decider.sequence !== slots.length) {
      throw new LeagueValidationError(
        "DECIDER_NOT_LAST",
        "Der Entscheidungsslot trägt die höchste Sequenz der Vorlage.",
      );
    }
    if (decider.discipline !== "DOUBLES") {
      throw new LeagueValidationError(
        "DECIDER_NOT_DOUBLES",
        "Der Entscheidungsslot ist ein Doppel.",
      );
    }
  }

  const singles = slots.filter((slot) => slot.role === "REGULAR" && slot.discipline === "SINGLES");
  if (singles.length === 0) {
    throw new LeagueValidationError(
      "MISSING_SINGLES_SLOTS",
      "Eine Vorlage braucht mindestens einen Einzelslot.",
    );
  }
  const positions = lineupPositions(singles);
  validateRoundRobin(singles, positions);
  validateRoundOrder(slots, positions);
}

/** Die Zahl der Aufstellungspositionen steht in der Vorlage selbst, nicht daneben. */
function lineupPositions(singles: readonly TemplateSlot[]): number {
  let positions = 0;
  for (const slot of singles) {
    positions = Math.max(positions, slot.homePosition ?? 0, slot.awayPosition ?? 0);
  }
  return positions;
}

function validateSlotShape(slot: TemplateSlot): void {
  if (slot.label.trim().length === 0) {
    throw new LeagueValidationError(
      "EMPTY_SLOT_LABEL",
      `Slot ${slot.sequence} braucht eine Bezeichnung.`,
    );
  }
  if (!STARTING_SCORES.includes(slot.startingScore)) {
    throw new LeagueValidationError(
      "INVALID_STARTING_SCORE",
      `Slot ${slot.sequence} trägt einen unzulässigen Startscore.`,
    );
  }
  if (!isPositiveInteger(slot.bestOfLegs) || slot.bestOfLegs % 2 === 0) {
    throw new LeagueValidationError(
      "INVALID_LEG_DISTANCE",
      `Slot ${slot.sequence} braucht eine ungerade Anzahl Legs.`,
    );
  }
  if (!isPositiveInteger(slot.legsToWinSet) || !isPositiveInteger(slot.setsToWin)) {
    throw new LeagueValidationError(
      "INVALID_LEG_DISTANCE",
      `Slot ${slot.sequence} braucht eine positive Satz- und Legdistanz.`,
    );
  }
  if (slot.bestOfLegs !== slot.legsToWinSet * 2 - 1) {
    throw new LeagueValidationError(
      "INCONSISTENT_LEG_DISTANCE",
      `Slot ${slot.sequence}: ${slot.bestOfLegs} Legs passen nicht zu ${slot.legsToWinSet} Gewinnlegs.`,
    );
  }
  if (slot.maxRounds !== null && !isPositiveInteger(slot.maxRounds)) {
    throw new LeagueValidationError(
      "INVALID_MAX_ROUNDS",
      `Slot ${slot.sequence}: die Rundenbegrenzung ist leer oder positiv.`,
    );
  }
  if ((slot.discipline === "SINGLES") !== (slot.homePosition !== null)) {
    throw new LeagueValidationError(
      "INVALID_SLOT_POSITIONS",
      `Slot ${slot.sequence}: nur Einzelslots tragen Aufstellungspositionen.`,
    );
  }
  if ((slot.homePosition === null) !== (slot.awayPosition === null)) {
    throw new LeagueValidationError(
      "INVALID_SLOT_POSITIONS",
      `Slot ${slot.sequence}: beide Aufstellungspositionen sind gesetzt oder beide leer.`,
    );
  }
  if (slot.homePosition !== null && !isPositiveInteger(slot.homePosition)) {
    throw new LeagueValidationError(
      "INVALID_SLOT_POSITIONS",
      `Slot ${slot.sequence}: die Heimposition muss positiv sein.`,
    );
  }
  if (slot.awayPosition !== null && !isPositiveInteger(slot.awayPosition)) {
    throw new LeagueValidationError(
      "INVALID_SLOT_POSITIONS",
      `Slot ${slot.sequence}: die Gastposition muss positiv sein.`,
    );
  }
}

/**
 * Über alle regulären Einzelslots tritt jede Heimposition gegen jede
 * Gastposition genau einmal an.
 */
function validateRoundRobin(singles: readonly TemplateSlot[], positions: number): void {
  const pairings = new Set<string>();
  for (const slot of singles) {
    const key = `${slot.homePosition}:${slot.awayPosition}`;
    if (pairings.has(key)) {
      throw new LeagueValidationError(
        "DUPLICATE_SINGLES_PAIRING",
        `Die Einzelpaarung ${key} kommt mehrfach vor.`,
      );
    }
    pairings.add(key);
  }

  if (singles.length !== positions * positions) {
    throw new LeagueValidationError(
      "INCOMPLETE_ROUND_ROBIN",
      `Bei ${positions} Aufstellungspositionen braucht die Vorlage ${positions * positions} Einzelslots.`,
    );
  }
  for (let home = 1; home <= positions; home += 1) {
    for (let away = 1; away <= positions; away += 1) {
      if (!pairings.has(`${home}:${away}`)) {
        throw new LeagueValidationError(
          "INCOMPLETE_ROUND_ROBIN",
          `Die Einzelpaarung ${home}:${away} fehlt in der Vorlage.`,
        );
      }
    }
  }
}

/**
 * Reglement 2.2.8: „Runde 1: 4 Einzel, Runde 2: 4 Einzel, 2 Doppel, Runde 3:
 * 4 Einzel, Runde 4: 4 Einzel, evtl. sudden death." Verallgemeinert auf `n`
 * Aufstellungspositionen: `n` Runden zu `n` Einzeln, die regulären Doppel nach
 * Runde `ceil(n / 2)`, das Entscheidungsdoppel zuletzt (dessen Position prüft
 * bereits `DECIDER_NOT_LAST`). Innerhalb einer Runde tritt jede Heim- und jede
 * Gastposition genau einmal an — das ist der Zweck der Reihenfolge, niemand
 * steht zweimal hintereinander an der Scheibe.
 *
 * Reglement 2.2.1 und A1.1 verlangen ausserdem Doppelbegegnungen neben den
 * Einzeln. Ohne reguläres Doppel kann ein 9:9 nach 2.2.2 nie entstehen, und ein
 * Nichtantritt nach 2.5.1 wäre 0:16 statt 0:18. Die Ligavorlage setzt zwei
 * (`vfcTemplateOptions.regularDoubles`); die Engine verlangt mindestens eins,
 * damit auch kleinere Aufstellungen abbildbar bleiben.
 *
 * Dieses Minimum von eins ist bewusst weiter als das, was das Formular
 * anbietet: eine ungerade Zahl regulärer Doppel bringt zwar mindestens eines
 * mit, entzieht dem 9:9 aus 2.2.2/A1.4 aber den Gleichstand — bei ungerader
 * Gesamtzahl Begegnungen kann kein Unentschieden mehr entstehen, und damit
 * entfällt der Sudden-Death-Pfad ersatzlos. Das ist für generische Vorlagen
 * (z. B. kleinere, nicht-VFC-Aufstellungen) kein Validierungsfehler, für die
 * VFC-Liga aber unerwünscht. `competition-setup.tsx` bietet deshalb nur
 * gerade Werte (2, 4) an; der Validator hier bleibt bewusst permissiver.
 */
function validateRoundOrder(slots: readonly TemplateSlot[], positions: number): void {
  const ordered = [...slots].sort((left, right) => left.sequence - right.sequence);
  const regular = ordered.filter((slot) => slot.role !== "DECIDER");
  const regularDoubles = regular.filter((slot) => slot.discipline === "DOUBLES");
  if (regularDoubles.length === 0) {
    throw new LeagueValidationError(
      "MISSING_DOUBLES_SLOTS",
      "Eine Vorlage braucht mindestens ein reguläres Doppel (Reglement 2.2.1, A1.1).",
    );
  }

  const doublesAfterRound = Math.ceil(positions / 2);
  // `regular.length` ist an dieser Stelle immer `positions * positions +
  // regularDoubles.length`: `validateRoundRobin` hat direkt zuvor bereits
  // erzwungen, dass die Einzel genau `positions * positions` zählen — eine
  // Längenabweichung kann hier also nicht mehr auftreten.
  const expected: readonly Discipline[] = [
    ...Array.from({ length: positions * doublesAfterRound }, (): Discipline => "SINGLES"),
    ...Array.from({ length: regularDoubles.length }, (): Discipline => "DOUBLES"),
    ...Array.from({ length: positions * (positions - doublesAfterRound) }, (): Discipline => "SINGLES"),
  ];
  for (const [index, discipline] of expected.entries()) {
    const slot = regular[index];
    if (slot === undefined || slot.discipline !== discipline) {
      throw new LeagueValidationError(
        "INVALID_ROUND_ORDER",
        `Reglement 2.2.8: an Sequenz ${index + 1} steht ${discipline === "SINGLES" ? "ein Einzel" : "ein Doppel"}.`,
      );
    }
  }

  const singles = regular.filter((slot) => slot.discipline === "SINGLES");
  for (let round = 0; round < positions; round += 1) {
    const inRound = singles.slice(round * positions, (round + 1) * positions);
    const homes = new Set(inRound.map((slot) => slot.homePosition));
    const aways = new Set(inRound.map((slot) => slot.awayPosition));
    if (homes.size !== positions || aways.size !== positions) {
      throw new LeagueValidationError(
        "INVALID_ROUND_ORDER",
        `Reglement 2.2.8: in Runde ${round + 1} tritt jede Aufstellungsposition genau einmal an.`,
      );
    }
  }
}
