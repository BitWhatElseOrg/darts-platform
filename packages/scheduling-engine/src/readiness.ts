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
