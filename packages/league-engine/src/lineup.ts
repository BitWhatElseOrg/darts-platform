import { LeagueValidationError } from "./errors.js";
import type { Discipline, Side } from "./template.js";

export type NominationOrigin = "SQUAD" | "GUEST";

/** Eine Zeile aus `encounter_nominations`. `position === null` heisst Ersatz. */
export interface NominationEntry {
  readonly playerId: string;
  readonly position: number | null;
  readonly origin: NominationOrigin;
}

/** Die Aufstellungsregeln des Wettbewerbs. */
export interface LineupRules {
  readonly lineupPositions: number;
  readonly minNominations: number;
  readonly minNominationsShorthanded: number;
}

export interface NominationInput {
  readonly side: Side;
  readonly nominations: readonly NominationEntry[];
  /** Der zum Ansetzungszeitpunkt gültige Kader des Teams dieser Seite. */
  readonly squadPlayerIds: readonly string[];
  readonly rules: LineupRules;
}

/** Die Meldung einer Seite für einen Doppelslot. */
export interface DoublesPairing {
  readonly slotSequence: number;
  readonly role: "REGULAR" | "DECIDER";
  readonly playerIds: readonly string[];
}

export interface DoublesInput {
  readonly side: Side;
  readonly pairings: readonly DoublesPairing[];
  readonly nominatedPlayerIds: readonly string[];
  readonly maxDoublesPerPlayer: number;
}

/** Eine Zeile aus `encounter_substitutions`. */
export interface SubstitutionRecord {
  readonly side: Side;
  readonly position: number;
  readonly outPlayerId: string;
  readonly inPlayerId: string;
  readonly effectiveFromSequence: number;
}

export interface SubstitutionInput {
  readonly substitution: SubstitutionRecord;
  /** Die Meldung der Seite, auf der gewechselt wird. */
  readonly nominations: readonly NominationEntry[];
  readonly existingSubstitutions: readonly SubstitutionRecord[];
  /** Sequenzen aller Slots, die bereits laufen oder abgeschlossen sind. */
  readonly startedSlotSequences: readonly number[];
  readonly lineupPositions: number;
  readonly maxSubstitutionsPerEncounter: number;
}

export interface SideLineup {
  readonly nominations: readonly NominationEntry[];
  readonly substitutions: readonly SubstitutionRecord[];
  /** Nur für Doppelslots: die für diesen Slot gemeldete Paarung der Seite. */
  readonly doublesPlayerIds?: readonly string[];
}

export interface OccupancySlot {
  readonly sequence: number;
  readonly discipline: Discipline;
  readonly homePosition: number | null;
  readonly awayPosition: number | null;
}

export interface OccupancyInput {
  readonly slot: OccupancySlot;
  readonly home: SideLineup;
  readonly away: SideLineup;
}

export interface SideOccupancy {
  readonly side: Side;
  readonly playerIds: readonly string[];
  readonly complete: boolean;
}

export interface SlotOccupancy {
  readonly home: SideOccupancy;
  readonly away: SideOccupancy;
  readonly playable: boolean;
  /** Die vollständige Seite, wenn genau eine Seite besetzt ist. */
  readonly walkoverWinner: Side | null;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/**
 * Prüft die Meldung einer Seite gegen Kader und Aufstellungsregeln. Eine
 * Meldung mit weniger als `lineupPositions` besetzten Positionen ist nach
 * Reglement 2.2.5 zulässig; die Slots der fehlenden Position gehen beim Start
 * kampflos verloren.
 */
export function validateNominations(input: NominationInput): void {
  const { rules } = input;
  const squad = new Set(input.squadPlayerIds);
  const seenPlayers = new Set<string>();
  const seenPositions = new Set<number>();

  for (const nomination of input.nominations) {
    if (nomination.playerId.trim().length === 0) {
      throw new LeagueValidationError(
        "INVALID_NOMINATION",
        "Eine Meldung braucht eine Person.",
      );
    }
    if (seenPlayers.has(nomination.playerId)) {
      throw new LeagueValidationError(
        "DUPLICATE_NOMINATION",
        `Die Person ${nomination.playerId} ist mehrfach gemeldet.`,
      );
    }
    seenPlayers.add(nomination.playerId);

    if (nomination.position !== null) {
      if (!isPositiveInteger(nomination.position) || nomination.position > rules.lineupPositions) {
        throw new LeagueValidationError(
          "INVALID_LINEUP_POSITION",
          `Die Aufstellungsposition ${nomination.position} liegt ausserhalb von 1 bis ${rules.lineupPositions}.`,
        );
      }
      if (seenPositions.has(nomination.position)) {
        throw new LeagueValidationError(
          "DUPLICATE_LINEUP_POSITION",
          `Die Aufstellungsposition ${nomination.position} ist mehrfach besetzt.`,
        );
      }
      seenPositions.add(nomination.position);
    }

    if (nomination.origin === "SQUAD" && !squad.has(nomination.playerId)) {
      throw new LeagueValidationError(
        "PLAYER_NOT_IN_SQUAD",
        `Die Person ${nomination.playerId} gehört nicht zum Kader und ist nicht als Aushilfe gemeldet.`,
      );
    }
  }

  if (seenPositions.size < rules.minNominationsShorthanded) {
    throw new LeagueValidationError(
      "NOT_ENOUGH_NOMINATIONS",
      `Mindestens ${rules.minNominationsShorthanded} Aufstellungspositionen müssen besetzt sein.`,
    );
  }
  if (
    seenPositions.size >= rules.lineupPositions &&
    input.nominations.length < rules.minNominations
  ) {
    throw new LeagueValidationError(
      "NOT_ENOUGH_NOMINATIONS",
      `Eine vollständige Aufstellung braucht mindestens ${rules.minNominations} gemeldete Personen.`,
    );
  }
}

/**
 * Prüft die Doppelpaarungen einer Seite. Die Grenze `maxDoublesPerPlayer` gilt
 * nur für die regulären Doppel; im Entscheidungsdoppel sind nach Reglement
 * 2.2.1 sämtliche gemeldeten Personen erneut spielberechtigt.
 */
export function validateDoublesPairings(input: DoublesInput): void {
  const nominated = new Set(input.nominatedPlayerIds);
  const seenSlots = new Set<number>();
  const regularAppearances = new Map<string, number>();

  for (const pairing of input.pairings) {
    if (seenSlots.has(pairing.slotSequence)) {
      throw new LeagueValidationError(
        "DUPLICATE_DOUBLES_SLOT",
        `Für Slot ${pairing.slotSequence} liegen mehrere Paarungen vor.`,
      );
    }
    seenSlots.add(pairing.slotSequence);

    if (pairing.playerIds.length !== 2) {
      throw new LeagueValidationError(
        "INVALID_DOUBLES_SIZE",
        `Slot ${pairing.slotSequence} braucht genau zwei Personen je Seite.`,
      );
    }
    if (new Set(pairing.playerIds).size !== pairing.playerIds.length) {
      throw new LeagueValidationError(
        "DUPLICATE_DOUBLES_PLAYER",
        `Slot ${pairing.slotSequence}: dieselbe Person kann nicht beide Plätze belegen.`,
      );
    }

    for (const playerId of pairing.playerIds) {
      if (!nominated.has(playerId)) {
        throw new LeagueValidationError(
          "PLAYER_NOT_NOMINATED",
          `Die Person ${playerId} ist für diese Begegnung nicht gemeldet.`,
        );
      }
      if (pairing.role === "REGULAR") {
        regularAppearances.set(playerId, (regularAppearances.get(playerId) ?? 0) + 1);
      }
    }
  }

  for (const [playerId, appearances] of regularAppearances) {
    if (appearances > input.maxDoublesPerPlayer) {
      throw new LeagueValidationError(
        "DOUBLES_LIMIT_EXCEEDED",
        `Die Person ${playerId} bestreitet mehr als ${input.maxDoublesPerPlayer} reguläre Doppel.`,
      );
    }
  }
}

/**
 * Prüft eine Auswechslung: Kontingent, laufende Paarung, Sperre der
 * ausgewechselten Person für weitere Einzel und Meldung der einwechselnden
 * Person.
 */
export function validateSubstitution(input: SubstitutionInput): void {
  const { substitution } = input;
  const sideSubstitutions = input.existingSubstitutions.filter(
    (entry) => entry.side === substitution.side,
  );

  if (substitution.outPlayerId === substitution.inPlayerId) {
    throw new LeagueValidationError(
      "INVALID_SUBSTITUTION",
      "Eine Person kann sich nicht selbst ersetzen.",
    );
  }
  if (
    !isPositiveInteger(substitution.position) ||
    substitution.position > input.lineupPositions
  ) {
    throw new LeagueValidationError(
      "INVALID_LINEUP_POSITION",
      `Die Aufstellungsposition ${substitution.position} liegt ausserhalb von 1 bis ${input.lineupPositions}.`,
    );
  }
  if (!isPositiveInteger(substitution.effectiveFromSequence)) {
    throw new LeagueValidationError(
      "INVALID_SUBSTITUTION",
      "Eine Auswechslung wirkt ab einer positiven Slotsequenz.",
    );
  }

  const highestStarted = input.startedSlotSequences.reduce(
    (highest, sequence) => Math.max(highest, sequence),
    0,
  );
  if (substitution.effectiveFromSequence <= highestStarted) {
    throw new LeagueValidationError(
      "SUBSTITUTION_DURING_RUNNING_SLOT",
      `Slot ${highestStarted} läuft bereits; eine Auswechslung wirkt frühestens ab Slot ${highestStarted + 1}.`,
    );
  }

  if (
    sideSubstitutions.some(
      (entry) =>
        entry.position === substitution.position &&
        entry.effectiveFromSequence === substitution.effectiveFromSequence,
    )
  ) {
    throw new LeagueValidationError(
      "DUPLICATE_SUBSTITUTION",
      `Für Position ${substitution.position} liegt ab Slot ${substitution.effectiveFromSequence} bereits eine Auswechslung vor.`,
    );
  }

  if (sideSubstitutions.length >= input.maxSubstitutionsPerEncounter) {
    throw new LeagueValidationError(
      "SUBSTITUTION_LIMIT_EXCEEDED",
      `Je Begegnung sind höchstens ${input.maxSubstitutionsPerEncounter} Auswechslungen je Seite zulässig.`,
    );
  }

  if (!input.nominations.some((entry) => entry.playerId === substitution.inPlayerId)) {
    throw new LeagueValidationError(
      "PLAYER_NOT_NOMINATED",
      `Die Person ${substitution.inPlayerId} ist für diese Begegnung nicht gemeldet.`,
    );
  }
  if (sideSubstitutions.some((entry) => entry.outPlayerId === substitution.inPlayerId)) {
    throw new LeagueValidationError(
      "PLAYER_SUBSTITUTED_OUT",
      `Die Person ${substitution.inPlayerId} ist bereits ausgewechselt und für weitere Einzel gesperrt.`,
    );
  }

  const lineup: SideLineup = {
    nominations: input.nominations,
    substitutions: sideSubstitutions,
  };
  const current = resolvePositionPlayer(
    substitution.position,
    substitution.effectiveFromSequence,
    lineup,
  );
  if (current !== substitution.outPlayerId) {
    throw new LeagueValidationError(
      "SUBSTITUTION_OUT_PLAYER_MISMATCH",
      `Position ${substitution.position} ist ab Slot ${substitution.effectiveFromSequence} nicht mit ${substitution.outPlayerId} besetzt.`,
    );
  }

  for (let position = 1; position <= input.lineupPositions; position += 1) {
    if (position === substitution.position) continue;
    if (
      resolvePositionPlayer(position, substitution.effectiveFromSequence, lineup) ===
      substitution.inPlayerId
    ) {
      throw new LeagueValidationError(
        "PLAYER_ALREADY_IN_LINEUP",
        `Die Person ${substitution.inPlayerId} besetzt bereits Position ${position}.`,
      );
    }
  }
}

/**
 * Die Besetzung einer Aufstellungsposition zu einer Slotsequenz: die Meldung
 * an dieser Position, überschrieben durch die jüngste wirksame Auswechslung.
 */
function resolvePositionPlayer(
  position: number,
  sequence: number,
  lineup: SideLineup,
): string | null {
  let playerId =
    lineup.nominations.find((entry) => entry.position === position)?.playerId ?? null;
  let appliedSequence = 0;

  for (const substitution of lineup.substitutions) {
    if (substitution.position !== position) continue;
    if (substitution.effectiveFromSequence > sequence) continue;
    if (substitution.effectiveFromSequence < appliedSequence) continue;
    appliedSequence = substitution.effectiveFromSequence;
    playerId = substitution.inPlayerId;
  }

  return playerId;
}

/**
 * Liefert für einen Slot die Besetzung beider Seiten: bei Einzeln aus Position
 * und Auswechslungshistorie, bei Doppeln aus den gemeldeten Paarungen.
 */
export function resolveSlotOccupancy(input: OccupancyInput): SlotOccupancy {
  const { slot } = input;
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

  const home = resolveSideOccupancy("HOME", slot, slot.homePosition, input.home);
  const away = resolveSideOccupancy("AWAY", slot, slot.awayPosition, input.away);
  const playable = home.complete && away.complete;
  const walkoverWinner: Side | null =
    home.complete === away.complete ? null : home.complete ? "HOME" : "AWAY";

  return { home, away, playable, walkoverWinner };
}

function resolveSideOccupancy(
  side: Side,
  slot: OccupancySlot,
  position: number | null,
  lineup: SideLineup,
): SideOccupancy {
  if (slot.discipline === "SINGLES") {
    const playerId =
      position === null ? null : resolvePositionPlayer(position, slot.sequence, lineup);
    return {
      side,
      playerIds: playerId === null ? [] : [playerId],
      complete: playerId !== null,
    };
  }

  const playerIds = lineup.doublesPlayerIds ?? [];
  return { side, playerIds, complete: playerIds.length === 2 };
}
