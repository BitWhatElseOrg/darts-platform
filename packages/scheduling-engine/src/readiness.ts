export interface MatchReadinessInput {
  readonly participantIds: readonly [string | null, string | null];
  readonly activePlayerIds: ReadonlySet<string>;
  readonly availableBoardCount: number;
  readonly matchStatus: "WAITING" | "READY" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  readonly tournamentStatus: "READY" | "GROUP_STAGE" | "KNOCKOUT" | "COMPLETED";
}

export type MatchReadinessDecision =
  | { readonly ready: true; readonly code: "READY"; readonly reason: string }
  | {
      readonly ready: false;
      readonly code:
        | "BLOCKED_PARTICIPANT_UNDECIDED"
        | "BLOCKED_PLAYER_BUSY"
        | "BLOCKED_NO_BOARD"
        | "BLOCKED_STAGE_NOT_OPEN"
        | "BLOCKED_MATCH_FINISHED";
      readonly reason: string;
    };

export function evaluateMatchReadiness(input: MatchReadinessInput): MatchReadinessDecision {
  if (input.matchStatus === "COMPLETED" || input.matchStatus === "CANCELLED") {
    return {
      ready: false,
      code: "BLOCKED_MATCH_FINISHED",
      reason: "Das Match ist bereits beendet oder abgebrochen.",
    };
  }
  if (input.matchStatus === "IN_PROGRESS") {
    return {
      ready: false,
      code: "BLOCKED_PLAYER_BUSY",
      reason: "Das Match läuft bereits auf einem Board.",
    };
  }
  if (!["READY", "GROUP_STAGE", "KNOCKOUT"].includes(input.tournamentStatus)) {
    return {
      ready: false,
      code: "BLOCKED_STAGE_NOT_OPEN",
      reason: "Der Turnierstatus erlaubt keinen Matchstart.",
    };
  }
  const [first, second] = input.participantIds;
  if (first === null || second === null) {
    return {
      ready: false,
      code: "BLOCKED_PARTICIPANT_UNDECIDED",
      reason: "Mindestens ein Teilnehmer steht noch nicht fest.",
    };
  }
  if (input.activePlayerIds.has(first) || input.activePlayerIds.has(second)) {
    return {
      ready: false,
      code: "BLOCKED_PLAYER_BUSY",
      reason: "Mindestens ein Teilnehmer spielt bereits.",
    };
  }
  if (input.availableBoardCount < 1) {
    return {
      ready: false,
      code: "BLOCKED_NO_BOARD",
      reason: "Aktuell ist kein Board verfügbar.",
    };
  }
  return { ready: true, code: "READY", reason: "Beide Teilnehmer und ein Board sind verfügbar." };
}

/**
 * Ein Slot einer Team-Begegnung. Anders als ein Turniermatch trägt jede Seite
 * ein bis zwei Personen, weshalb die Zwei-Teilnehmer-Prüfung oben nicht
 * ausreicht: im Doppel müssen alle vier Personen frei sein.
 */
export interface SlotReadinessInput {
  readonly sidePlayerIds: readonly [readonly string[], readonly string[]];
  readonly requiredPlayersPerSide: 1 | 2;
  readonly activePlayerIds: ReadonlySet<string>;
  readonly boardAvailable: boolean;
  readonly slotStatus: "WAITING" | "READY" | "IN_PROGRESS" | "COMPLETED" | "WALKOVER" | "CANCELLED";
  readonly encounterStatus: "DRAFT" | "LINEUPS_OPEN" | "READY" | "RUNNING" | "COMPLETED" | "CANCELLED";
}

export function evaluateSlotReadiness(input: SlotReadinessInput): MatchReadinessDecision {
  if (
    input.slotStatus === "COMPLETED" ||
    input.slotStatus === "WALKOVER" ||
    input.slotStatus === "CANCELLED"
  ) {
    return {
      ready: false,
      code: "BLOCKED_MATCH_FINISHED",
      reason: "Der Slot ist bereits gewertet.",
    };
  }
  if (input.slotStatus === "IN_PROGRESS") {
    return {
      ready: false,
      code: "BLOCKED_PLAYER_BUSY",
      reason: "Der Slot läuft bereits auf einem Board.",
    };
  }
  if (input.encounterStatus !== "RUNNING") {
    return {
      ready: false,
      code: "BLOCKED_STAGE_NOT_OPEN",
      reason: "Der Status der Begegnung erlaubt keinen Slotstart.",
    };
  }

  const [home, away] = input.sidePlayerIds;
  if (home.length !== input.requiredPlayersPerSide || away.length !== input.requiredPlayersPerSide) {
    return {
      ready: false,
      code: "BLOCKED_PARTICIPANT_UNDECIDED",
      reason: "Die Besetzung des Slots steht noch nicht auf beiden Seiten fest.",
    };
  }
  if ([...home, ...away].some((playerId) => input.activePlayerIds.has(playerId))) {
    return {
      ready: false,
      code: "BLOCKED_PLAYER_BUSY",
      reason: "Mindestens eine Person spielt bereits.",
    };
  }
  if (!input.boardAvailable) {
    return {
      ready: false,
      code: "BLOCKED_NO_BOARD",
      reason: "Aktuell ist kein Board verfügbar.",
    };
  }
  return { ready: true, code: "READY", reason: "Beide Seiten und ein Board sind verfügbar." };
}
