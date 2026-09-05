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
  /** Die fremde Partie, die diesen Slot blockiert — dorthin führt der Weg. */
  readonly blockingMatchId: string | null;
}

function lineupOf(encounter: EncounterDetail, side: EncounterSide): EncounterSideLineup {
  return side === "HOME" ? encounter.home : encounter.away;
}

export function slotAvailability(
  encounter: EncounterDetail,
  slot: EncounterSlotView,
): SlotAvailability {
  if (slot.status === "IN_PROGRESS") {
    return { assignable: false, reason: "Das Spiel läuft bereits.", blockingMatchId: null };
  }
  if (slot.status === "COMPLETED" || slot.status === "WALKOVER") {
    return { assignable: false, reason: "Das Spiel ist entschieden.", blockingMatchId: null };
  }
  if (slot.status === "CANCELLED") {
    return { assignable: false, reason: "Das Spiel entfällt.", blockingMatchId: null };
  }
  if (encounter.status !== "RUNNING") {
    return {
      assignable: false,
      reason: "Die Begegnung ist noch nicht gestartet.",
      blockingMatchId: null,
    };
  }
  if (slot.role === "DECIDER" && !encounter.decider.required) {
    return {
      assignable: false,
      reason: "Das Entscheidungsdoppel wird erst bei Gleichstand gebraucht.",
      blockingMatchId: null,
    };
  }
  for (const side of ["HOME", "AWAY"] as const) {
    const occupancy = side === "HOME" ? slot.home : slot.away;
    if (occupancy.complete) continue;
    const what =
      slot.discipline === "DOUBLES"
        ? "hat die Doppelpaarung noch nicht gemeldet"
        : "hat diese Aufstellungsposition nicht besetzt";
    return { assignable: false, reason: `${sideLabel(side)} ${what}.`, blockingMatchId: null };
  }
  // Der Server weist eine belegte Person mit 409 ab. Diese Auskunft zeigt den
  // Konflikt schon vorher, damit niemand ins Leere klickt.
  const involved = [...slot.home.players, ...slot.away.players];
  const blocked = involved
    .map((entry) => ({
      entry,
      busy: encounter.busyPlayers.find((candidate) => candidate.playerId === entry.playerId),
    }))
    .find((candidate) => candidate.busy !== undefined);
  if (blocked !== undefined && blocked.busy !== undefined) {
    const here = runningSlotOf(encounter, blocked.busy.matchId);
    return here === null
      ? {
          assignable: false,
          reason: `${blocked.entry.displayName} spielt gerade eine andere Partie. Das Spiel startet, sobald sie beendet ist.`,
          blockingMatchId: blocked.busy.matchId,
        }
      : {
          assignable: false,
          reason: `${blocked.entry.displayName} spielt gerade Spiel ${here} dieser Begegnung.`,
          // Kein Sprung: die Partie läuft in dieser Begegnung, sie steht daneben.
          blockingMatchId: null,
        };
  }
  return { assignable: true, reason: null, blockingMatchId: null };
}

/** Die Nummer des Spiels dieser Begegnung, das zu dieser Partie gehört. */
function runningSlotOf(encounter: EncounterDetail, matchId: string): number | null {
  return encounter.slots.find((candidate) => candidate.matchId === matchId)?.sequence ?? null;
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

/**
 * Der Satz über der Schaltfläche „Begegnung starten". Er nennt die fehlende
 * Meldung oder die Ausnahmemeldung dieses Wettbewerbs — die Zahl stand früher
 * fest im Text und widersprach jeder anderen Aufstellungsgrösse.
 */
export function preStartHint(encounter: EncounterDetail): string {
  if (encounter.status === "RUNNING") {
    return "Die Begegnung läuft. Weise Spiele einem Board zu, sobald beide Seiten besetzt sind.";
  }
  const missing =
    !encounter.home.submitted && !encounter.away.submitted
      ? "beider Mannschaften"
      : !encounter.home.submitted
        ? "der Heimmannschaft"
        : !encounter.away.submitted
          ? "der Gastmannschaft"
          : null;
  if (missing !== null) return `Es fehlt noch die Meldung ${missing}.`;
  return `Meldet eine Seite weniger als ${encounter.lineupPositions} Positionen, gelten deren Einzel und ein Doppel beim Start sofort als kampflos verloren.`;
}

/**
 * `PLAYER_BUSY` trägt die betroffenen Personen mit. Ohne Namen sucht die
 * Spielleitung den Grund am falschen Ende — die Absage nennt sie deshalb.
 */
export function busyPlayersMessage(details: unknown): string | null {
  if (typeof details !== "object" || details === null) return null;
  const busy = (details as { readonly busyPlayers?: unknown }).busyPlayers;
  if (!Array.isArray(busy)) return null;
  const names = busy
    .map((entry) =>
      typeof entry === "object" && entry !== null
        ? (entry as { readonly displayName?: unknown }).displayName
        : null,
    )
    .filter((name): name is string => typeof name === "string" && name.length > 0);
  if (names.length === 0) return null;
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} und ${names[names.length - 1]}`;
  const verb = names.length === 1 ? "spielt" : "spielen";
  return `${list} ${verb} bereits an einem anderen Board. Das Spiel startet, sobald die andere Partie beendet ist.`;
}

/**
 * Nach dem Start ist die Meldung gesperrt. Steht eine gemeldete Person zu
 * diesem Zeitpunkt an einer fremden Scheibe, läuft die Begegnung in eine
 * Sackgasse — die Warnung kommt deshalb davor.
 */
export interface CommitmentWarning {
  readonly message: string;
  readonly blocked: readonly {
    readonly playerId: string;
    readonly displayName: string;
    readonly matchId: string;
  }[];
}

export function commitmentWarning(encounter: EncounterDetail): CommitmentWarning | null {
  if (encounter.status === "RUNNING" || encounter.status === "COMPLETED") return null;
  if (encounter.status === "CANCELLED") return null;
  const nominated = [...encounter.home.nominations, ...encounter.away.nominations];
  const blocked = nominated.flatMap((entry) => {
    const busy = encounter.busyPlayers.find((candidate) => candidate.playerId === entry.playerId);
    return busy === undefined
      ? []
      : [{ playerId: entry.playerId, displayName: entry.displayName, matchId: busy.matchId }];
  });
  if (blocked.length === 0) return null;
  const names = blocked.map((entry) => entry.displayName);
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} und ${names[names.length - 1]}`;
  const verb = names.length === 1 ? "spielt" : "spielen";
  return {
    message: `${list} ${verb} gerade eine andere Partie. Nach dem Start lässt sich die Meldung nicht mehr ändern — warte ab oder melde jemand anderen.`,
    blocked,
  };
}
