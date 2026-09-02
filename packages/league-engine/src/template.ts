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
 * und Distanz, sowie das vollständige Rundenturnier der Einzel.
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

  validateRoundRobin(slots);
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
 * Gastposition genau einmal an. Die Zahl der Aufstellungspositionen wird aus
 * der Vorlage abgeleitet, damit sie nicht als zweite Quelle danebensteht.
 */
function validateRoundRobin(slots: readonly TemplateSlot[]): void {
  const singles = slots.filter((slot) => slot.role === "REGULAR" && slot.discipline === "SINGLES");
  if (singles.length === 0) {
    throw new LeagueValidationError(
      "MISSING_SINGLES_SLOTS",
      "Eine Vorlage braucht mindestens einen Einzelslot.",
    );
  }

  let positions = 0;
  for (const slot of singles) {
    positions = Math.max(positions, slot.homePosition ?? 0, slot.awayPosition ?? 0);
  }

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
