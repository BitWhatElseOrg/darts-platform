import { BadRequestException, ConflictException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { ScoringValidationError } from "@darts-platform/scoring-engine";

import { rethrowScoringError } from "./scoring-error.js";

describe("scoring error mapping", () => {
  it.each(["ROUND_LIMIT_NOT_REACHED", "BOARD_NOT_AVAILABLE"])(
    "maps %s to 409",
    (code) => {
      expect(() => rethrowScoringError(new ScoringValidationError(code, "zustand"))).toThrow(
        ConflictException,
      );
    },
  );

  it("maps every other engine code to 400 and keeps code and message", () => {
    try {
      rethrowScoringError(
        new ScoringValidationError("COMMAND_ID_ALREADY_USED", "schon benutzt"),
      );
      expect.unreachable("rethrowScoringError must throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual({
        code: "COMMAND_ID_ALREADY_USED",
        message: "schon benutzt",
      });
    }
  });

  it("hands foreign errors on untouched", () => {
    const foreign = new Error("boom");
    expect(() => rethrowScoringError(foreign)).toThrow(foreign);
  });
});
