import { ConflictException, UnprocessableEntityException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { LeagueValidationError } from "@darts-platform/league-engine";

import { mapLeagueErrorCode, rethrowLeagueError } from "./league-error.js";

const expected: readonly (readonly [string, string, 409 | 422])[] = [
  ["NOT_ENOUGH_NOMINATIONS", "NOMINATION_INCOMPLETE", 422],
  ["INVALID_NOMINATION", "NOMINATION_INCOMPLETE", 422],
  ["INVALID_LINEUP_POSITION", "NOMINATION_INCOMPLETE", 422],
  ["DUPLICATE_LINEUP_POSITION", "NOMINATION_INCOMPLETE", 422],
  ["DUPLICATE_NOMINATION", "NOMINATION_DUPLICATE_PLAYER", 422],
  ["PLAYER_NOT_IN_SQUAD", "NOMINATION_PLAYER_NOT_IN_SQUAD", 422],
  ["INVALID_DOUBLES_SIZE", "DOUBLES_PAIRING_INCOMPLETE", 422],
  ["DUPLICATE_DOUBLES_SLOT", "DOUBLES_PAIRING_INCOMPLETE", 422],
  ["PLAYER_NOT_NOMINATED", "DOUBLES_PAIRING_INCOMPLETE", 422],
  ["DUPLICATE_DOUBLES_PLAYER", "DOUBLES_PAIRING_INCOMPLETE", 422],
  ["DOUBLES_LIMIT_EXCEEDED", "DOUBLES_PLAYER_LIMIT_EXCEEDED", 422],
  ["SUBSTITUTION_LIMIT_EXCEEDED", "SUBSTITUTION_LIMIT_EXCEEDED", 422],
  ["PLAYER_SUBSTITUTED_OUT", "SUBSTITUTION_PLAYER_BLOCKED", 422],
  ["PLAYER_ALREADY_IN_LINEUP", "SUBSTITUTION_PLAYER_BLOCKED", 422],
  ["SUBSTITUTION_DURING_RUNNING_SLOT", "SUBSTITUTION_SLOT_RUNNING", 409],
  ["INCOMPLETE_ROUND_ROBIN", "TEMPLATE_ROUND_ROBIN_INCOMPLETE", 422],
  ["DUPLICATE_SINGLES_PAIRING", "TEMPLATE_ROUND_ROBIN_INCOMPLETE", 422],
  ["MISSING_SINGLES_SLOTS", "TEMPLATE_ROUND_ROBIN_INCOMPLETE", 422],
  ["MULTIPLE_DECIDER_SLOTS", "TEMPLATE_INVALID", 422],
  ["NON_CONTIGUOUS_SLOT_SEQUENCE", "TEMPLATE_INVALID", 422],
  ["INVALID_LEG_DISTANCE", "TEMPLATE_INVALID", 422],
  ["INVALID_ROUND_ORDER", "TEMPLATE_INVALID", 422],
  ["MISSING_DOUBLES_SLOTS", "TEMPLATE_INVALID", 422],
];

describe("league error mapping", () => {
  it.each(expected)("maps %s to %s", (engineCode, apiCode, status) => {
    expect(mapLeagueErrorCode(engineCode)).toEqual({ code: apiCode, status });
  });

  it("falls back for an unknown engine code", () => {
    expect(mapLeagueErrorCode("SOMETHING_NEW")).toEqual({
      code: "LEAGUE_VALIDATION_ERROR",
      status: 422,
    });
  });

  it("throws 422 for a validation error and 409 for a running slot", () => {
    expect(() =>
      rethrowLeagueError(new LeagueValidationError("PLAYER_NOT_IN_SQUAD", "not in squad")),
    ).toThrow(UnprocessableEntityException);
    expect(() =>
      rethrowLeagueError(
        new LeagueValidationError("SUBSTITUTION_DURING_RUNNING_SLOT", "slot running"),
      ),
    ).toThrow(ConflictException);
  });

  it("keeps the engine message and hands foreign errors on untouched", () => {
    try {
      rethrowLeagueError(new LeagueValidationError("DOUBLES_LIMIT_EXCEEDED", "zwei Doppel"));
      expect.unreachable("rethrowLeagueError must throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toEqual({
        code: "DOUBLES_PLAYER_LIMIT_EXCEEDED",
        message: "zwei Doppel",
      });
    }
    const foreign = new Error("boom");
    expect(() => rethrowLeagueError(foreign)).toThrow(foreign);
  });
});
