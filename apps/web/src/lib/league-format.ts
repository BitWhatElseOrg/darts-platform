import type {
  CompetitionStatus,
  Discipline,
  EncounterResult,
  EncounterResultType,
  EncounterSide,
  EncounterSlotStatus,
  EncounterStatus,
  InRule,
  NominationOrigin,
  OutRule,
  SlotResultType,
} from "@darts-platform/schemas";
import type { StateTone } from "@darts-platform/ui";

/**
 * Nur Sprache. Nichts hier entscheidet etwas: jeder Wert wurde vom Server
 * entschieden. Die Oberfläche zeigt die Reglementssprache — „Spiel" für einen
 * Slot, „Satz" für ein Leg.
 */

export function encounterStatusLabel(status: EncounterStatus): string {
  switch (status) {
    case "DRAFT":
      return "Entwurf";
    case "LINEUPS_OPEN":
      return "Meldung offen";
    case "READY":
      return "startbereit";
    case "RUNNING":
      return "läuft";
    case "COMPLETED":
      return "beendet";
    case "CANCELLED":
      return "abgesagt";
  }
}

export function slotStatusLabel(status: EncounterSlotStatus): string {
  switch (status) {
    case "WAITING":
      return "wartet";
    case "READY":
      return "bereit";
    case "IN_PROGRESS":
      return "läuft";
    case "COMPLETED":
      return "gespielt";
    case "WALKOVER":
      return "kampflos";
    case "CANCELLED":
      return "entfällt";
  }
}

export function competitionStatusLabel(status: CompetitionStatus): string {
  switch (status) {
    case "DRAFT":
      return "Entwurf";
    case "ACTIVE":
      return "laufend";
    case "COMPLETED":
      return "beendet";
    case "CANCELLED":
      return "abgesagt";
  }
}

export function disciplineLabel(discipline: Discipline): string {
  return discipline === "SINGLES" ? "Einzel" : "Doppel";
}

export function sideLabel(side: EncounterSide): string {
  return side === "HOME" ? "Heim" : "Gast";
}

export function originLabel(origin: NominationOrigin): string {
  return origin === "SQUAD" ? "Kader" : "Aushilfe";
}

export function slotOutcomeLabel(input: {
  readonly winnerSide: EncounterSide | null;
  readonly resultType: SlotResultType | null;
}): string {
  if (input.winnerSide === null) return "offen";
  const winner = sideLabel(input.winnerSide);
  return input.resultType === "WALKOVER" ? `${winner} gewinnt kampflos` : `${winner} gewinnt`;
}

export function encounterOutcomeLabel(input: {
  readonly result: EncounterResult | null;
  readonly resultType: EncounterResultType | null;
}): string {
  if (input.result === null) return "offen";
  if (input.result === "DRAW") return "Unentschieden";
  const winner = input.result === "HOME_WIN" ? "Heim" : "Gast";
  switch (input.resultType) {
    case "DECIDER":
      return `${winner} gewinnt nach Entscheidungsdoppel`;
    case "FORFEIT":
      return `${winner} gewinnt nach Nichtantritt`;
    default:
      return `${winner} gewinnt`;
  }
}

const inRuleWords: Readonly<Record<InRule, string>> = {
  STRAIGHT: "Straight In",
  DOUBLE: "Double In",
};

const outRuleWords: Readonly<Record<OutRule, string>> = {
  SINGLE: "Single Out",
  DOUBLE: "Double Out",
  MASTER: "Master Out",
};

/** Reglement 1.1 kennt vier Ligavarianten; sie werden ausgeschrieben. */
export function variantLabel(input: {
  readonly startingScore: number;
  readonly inRule: InRule;
  readonly outRule: OutRule;
}): string {
  return `${input.startingScore} ${inRuleWords[input.inRule]} / ${outRuleWords[input.outRule]}`;
}

/** Jeder Tonwert bringt in `StateTag` eine gezeichnete Marke und ein Wort mit. */
export function slotTone(status: EncounterSlotStatus): StateTone {
  switch (status) {
    case "WAITING":
      return "waiting";
    case "READY":
      return "free";
    case "IN_PROGRESS":
      return "live";
    case "COMPLETED":
      return "finish";
    case "WALKOVER":
    case "CANCELLED":
      return "blocked";
  }
}

export function encounterTone(status: EncounterStatus): StateTone {
  switch (status) {
    case "DRAFT":
    case "LINEUPS_OPEN":
      return "waiting";
    case "READY":
      return "free";
    case "RUNNING":
      return "live";
    case "COMPLETED":
      return "finish";
    case "CANCELLED":
      return "conflict";
  }
}
