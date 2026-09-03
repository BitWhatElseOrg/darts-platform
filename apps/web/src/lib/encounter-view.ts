import type {
  EncounterDetail,
  EncounterSide,
  EncounterSideLineup,
  EncounterSlotView,
} from "@darts-platform/schemas";

import { sideLabel } from "./league-format";

/**
 * Ableitungen für die Begegnungsleitung. Jede folgt ausschliesslich aus
 * Feldern, die der Server geschickt hat — die Oberfläche entscheidet nichts,
 * sie erklärt. Der Server prüft jede Zuweisung erneut (AGENTS.md §13).
 */

export interface SlotAvailability {
  readonly assignable: boolean;
  readonly reason: string | null;
}

function lineupOf(encounter: EncounterDetail, side: EncounterSide): EncounterSideLineup {
  return side === "HOME" ? encounter.home : encounter.away;
}

export function slotAvailability(
  encounter: EncounterDetail,
  slot: EncounterSlotView,
): SlotAvailability {
  if (slot.status === "IN_PROGRESS") {
    return { assignable: false, reason: "Das Spiel läuft bereits." };
  }
  if (slot.status === "COMPLETED" || slot.status === "WALKOVER") {
    return { assignable: false, reason: "Das Spiel ist entschieden." };
  }
  if (slot.status === "CANCELLED") return { assignable: false, reason: "Das Spiel entfällt." };
  if (encounter.status !== "RUNNING") {
    return { assignable: false, reason: "Die Begegnung ist noch nicht gestartet." };
  }
  if (slot.role === "DECIDER" && !encounter.decider.required) {
    return {
      assignable: false,
      reason: "Das Entscheidungsdoppel wird erst bei Gleichstand gebraucht.",
    };
  }
  for (const side of ["HOME", "AWAY"] as const) {
    const occupancy = side === "HOME" ? slot.home : slot.away;
    if (occupancy.complete) continue;
    const what =
      slot.discipline === "DOUBLES"
        ? "hat die Doppelpaarung noch nicht gemeldet"
        : "hat diese Aufstellungsposition nicht besetzt";
    return { assignable: false, reason: `${sideLabel(side)} ${what}.` };
  }
  return { assignable: true, reason: null };
}

/** Die Doppel, für die diese Seite noch eine Paarung schuldet. */
export function openDoublesSlots(
  encounter: EncounterDetail,
  side: EncounterSide,
): readonly EncounterSlotView[] {
  return encounter.slots.filter((slot) => {
    if (slot.discipline !== "DOUBLES") return false;
    if (slot.status !== "WAITING") return false;
    if (slot.role === "DECIDER" && !encounter.decider.required) return false;
    return !(side === "HOME" ? slot.home : slot.away).complete;
  });
}

export interface SubstitutionPosition {
  readonly position: number;
  readonly playerId: string;
  readonly displayName: string;
}

export interface SubstitutionContext {
  readonly minimumSequence: number;
  readonly used: number;
  readonly remaining: number;
  readonly positions: readonly SubstitutionPosition[];
  readonly available: readonly { readonly playerId: string; readonly displayName: string }[];
}

/**
 * Reglement 2.2.4 und 2.2.10: nie während einer laufenden Paarung, höchstens
 * `maxSubstitutionsPerEncounter` je Begegnung, und die einwechselnde Person
 * muss gemeldet sein.
 */
export function substitutionContext(
  encounter: EncounterDetail,
  side: EncounterSide,
): SubstitutionContext {
  const lineup = lineupOf(encounter, side);
  const startedSequences = encounter.slots
    .filter((slot) => slot.status !== "WAITING" && slot.status !== "READY")
    .map((slot) => slot.sequence);
  const minimumSequence = startedSequences.length === 0 ? 1 : Math.max(...startedSequences) + 1;

  const current = new Map<number, { readonly playerId: string; readonly displayName: string }>();
  for (const nomination of lineup.nominations) {
    if (nomination.position === null) continue;
    current.set(nomination.position, {
      playerId: nomination.playerId,
      displayName: nomination.displayName,
    });
  }
  const ordered = [...lineup.substitutions].sort(
    (first, second) => first.effectiveFromSequence - second.effectiveFromSequence,
  );
  const replaced = new Set<string>();
  for (const substitution of ordered) {
    current.set(substitution.position, {
      playerId: substitution.inPlayerId,
      displayName: substitution.inDisplayName,
    });
    replaced.add(substitution.outPlayerId);
  }

  const inLineup = new Set([...current.values()].map((entry) => entry.playerId));
  const used = lineup.substitutions.length;
  return {
    minimumSequence,
    used,
    remaining: Math.max(0, encounter.maxSubstitutionsPerEncounter - used),
    positions: [...current.entries()]
      .map(([position, entry]) => ({ position, ...entry }))
      .sort((first, second) => first.position - second.position),
    available: lineup.nominations
      .filter((entry) => !inLineup.has(entry.playerId) && !replaced.has(entry.playerId))
      .map((entry) => ({ playerId: entry.playerId, displayName: entry.displayName })),
  };
}

export interface EncounterTally {
  readonly decided: number;
  readonly running: number;
  readonly total: number;
}

/** Ein abbestellter Entscheidungsslot zählt nirgends mit (Reglement A1.4). */
export function encounterTally(encounter: EncounterDetail): EncounterTally {
  const counted = encounter.slots.filter((slot) => slot.status !== "CANCELLED");
  return {
    decided: counted.filter((slot) => slot.status === "COMPLETED" || slot.status === "WALKOVER")
      .length,
    running: counted.filter((slot) => slot.status === "IN_PROGRESS").length,
    total: counted.length,
  };
}

export function deciderNotice(encounter: EncounterDetail): string | null {
  switch (encounter.decider.status) {
    case "REQUIRED":
      return `Gleichstand nach den regulären Spielen. Das Entscheidungsdoppel (Spiel ${encounter.decider.slotSequence}) wird gebraucht; beide Seiten melden dafür eine Paarung.`;
    case "NOT_REQUIRED":
      return "Das Entscheidungsdoppel wird nicht gebraucht.";
    case "COMPLETED":
      return "Das Entscheidungsdoppel ist gespielt.";
    default:
      return null;
  }
}
