import { describe, expect, it } from "vitest";

import { getWalkoverWithdrawnPlayerId } from "./walkover-provenance.js";

describe("walkover provenance", () => {
  it("returns the withdrawn loser rather than the current command player", () => {
    expect(getWalkoverWithdrawnPlayerId({
      participantOneId: "11111111-1111-4111-8111-111111111111",
      participantTwoId: "22222222-2222-4222-8222-222222222222",
      winnerPlayerId: "22222222-2222-4222-8222-222222222222",
    }, new Set(["11111111-1111-4111-8111-111111111111"]))).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it.each([
    new Set<string>(),
    new Set([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]),
  ])("rejects ambiguous withdrawal sets", (withdrawn) => {
    expect(() => getWalkoverWithdrawnPlayerId({
      participantOneId: "11111111-1111-4111-8111-111111111111",
      participantTwoId: "22222222-2222-4222-8222-222222222222",
      winnerPlayerId: "22222222-2222-4222-8222-222222222222",
    }, withdrawn)).toThrow("Walkover withdrawal invariant violated.");
  });
});
