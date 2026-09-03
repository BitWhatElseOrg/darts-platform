import { ConflictException, UnprocessableEntityException } from "@nestjs/common";

import { LeagueValidationError } from "@darts-platform/league-engine";

/**
 * Die League-Engine spricht ihr eigenes Vokabular; die Spec schreibt der API
 * ein anderes vor. Diese Tabelle ist die einzige Stelle, an der beide
 * aufeinandertreffen — der Vertrag nach aussen sind die Codes rechts.
 */
const apiErrors: Readonly<
  Record<string, { readonly code: string; readonly status: 409 | 422 }>
> = {
  NOT_ENOUGH_NOMINATIONS: { code: "NOMINATION_INCOMPLETE", status: 422 },
  INVALID_NOMINATION: { code: "NOMINATION_INCOMPLETE", status: 422 },
  INVALID_LINEUP_POSITION: { code: "NOMINATION_INCOMPLETE", status: 422 },
  DUPLICATE_LINEUP_POSITION: { code: "NOMINATION_INCOMPLETE", status: 422 },
  DUPLICATE_NOMINATION: { code: "NOMINATION_DUPLICATE_PLAYER", status: 422 },
  PLAYER_NOT_IN_SQUAD: { code: "NOMINATION_PLAYER_NOT_IN_SQUAD", status: 422 },
  INVALID_DOUBLES_SIZE: { code: "DOUBLES_PAIRING_INCOMPLETE", status: 422 },
  DUPLICATE_DOUBLES_SLOT: { code: "DOUBLES_PAIRING_INCOMPLETE", status: 422 },
  PLAYER_NOT_NOMINATED: { code: "DOUBLES_PAIRING_INCOMPLETE", status: 422 },
  DUPLICATE_DOUBLES_PLAYER: { code: "DOUBLES_PAIRING_INCOMPLETE", status: 422 },
  DOUBLES_LIMIT_EXCEEDED: { code: "DOUBLES_PLAYER_LIMIT_EXCEEDED", status: 422 },
  SUBSTITUTION_LIMIT_EXCEEDED: { code: "SUBSTITUTION_LIMIT_EXCEEDED", status: 422 },
  PLAYER_SUBSTITUTED_OUT: { code: "SUBSTITUTION_PLAYER_BLOCKED", status: 422 },
  PLAYER_ALREADY_IN_LINEUP: { code: "SUBSTITUTION_PLAYER_BLOCKED", status: 422 },
  INVALID_SUBSTITUTION: { code: "SUBSTITUTION_PLAYER_BLOCKED", status: 422 },
  SUBSTITUTION_OUT_PLAYER_MISMATCH: { code: "SUBSTITUTION_PLAYER_BLOCKED", status: 422 },
  DUPLICATE_SUBSTITUTION: { code: "SUBSTITUTION_PLAYER_BLOCKED", status: 422 },
  SUBSTITUTION_DURING_RUNNING_SLOT: { code: "SUBSTITUTION_SLOT_RUNNING", status: 409 },
  INCOMPLETE_ROUND_ROBIN: { code: "TEMPLATE_ROUND_ROBIN_INCOMPLETE", status: 422 },
  DUPLICATE_SINGLES_PAIRING: { code: "TEMPLATE_ROUND_ROBIN_INCOMPLETE", status: 422 },
  MISSING_SINGLES_SLOTS: { code: "TEMPLATE_ROUND_ROBIN_INCOMPLETE", status: 422 },
  EMPTY_TEMPLATE: { code: "TEMPLATE_INVALID", status: 422 },
  EMPTY_SLOT_LABEL: { code: "TEMPLATE_INVALID", status: 422 },
  DUPLICATE_SLOT_SEQUENCE: { code: "TEMPLATE_INVALID", status: 422 },
  NON_CONTIGUOUS_SLOT_SEQUENCE: { code: "TEMPLATE_INVALID", status: 422 },
  MULTIPLE_DECIDER_SLOTS: { code: "TEMPLATE_INVALID", status: 422 },
  MISSING_DECIDER_SLOT: { code: "TEMPLATE_INVALID", status: 422 },
  DECIDER_NOT_DOUBLES: { code: "TEMPLATE_INVALID", status: 422 },
  DECIDER_NOT_LAST: { code: "TEMPLATE_INVALID", status: 422 },
  INVALID_SLOT_POSITIONS: { code: "TEMPLATE_INVALID", status: 422 },
  INVALID_STARTING_SCORE: { code: "TEMPLATE_INVALID", status: 422 },
  INVALID_LEG_DISTANCE: { code: "TEMPLATE_INVALID", status: 422 },
  INCONSISTENT_LEG_DISTANCE: { code: "TEMPLATE_INVALID", status: 422 },
  INVALID_MAX_ROUNDS: { code: "TEMPLATE_INVALID", status: 422 },
};

export interface LeagueApiError {
  readonly code: string;
  readonly status: 409 | 422;
}

export function mapLeagueErrorCode(engineCode: string): LeagueApiError {
  return apiErrors[engineCode] ?? { code: "LEAGUE_VALIDATION_ERROR", status: 422 };
}

/** Übersetzt einen Engine-Fehler in die HTTP-Antwort; alles andere fliegt weiter. */
export function rethrowLeagueError(error: unknown): never {
  if (error instanceof LeagueValidationError) {
    const mapped = mapLeagueErrorCode(error.code);
    const body = { code: mapped.code, message: error.message };
    throw mapped.status === 409
      ? new ConflictException(body)
      : new UnprocessableEntityException(body);
  }
  throw error;
}
