import { describe, expect, it } from "vitest";

import { evaluateMatchReadiness } from "./readiness";

const base = {
  participantIds: ["one", "two"] as const,
  activePlayerIds: new Set<string>(),
  availableBoardCount: 1,
  matchStatus: "WAITING" as const,
  tournamentStatus: "GROUP_STAGE" as const,
};

describe("match readiness", () => {
  it("marks a fully available match ready", () => {
    expect(evaluateMatchReadiness(base)).toMatchObject({ ready: true, code: "READY" });
  });

  it("explains every blocking scheduling condition", () => {
    expect(evaluateMatchReadiness({ ...base, participantIds: ["one", null] })).toMatchObject({ code: "BLOCKED_PARTICIPANT_UNDECIDED" });
    expect(evaluateMatchReadiness({ ...base, activePlayerIds: new Set(["two"]) })).toMatchObject({ code: "BLOCKED_PLAYER_BUSY" });
    expect(evaluateMatchReadiness({ ...base, availableBoardCount: 0 })).toMatchObject({ code: "BLOCKED_NO_BOARD" });
    expect(evaluateMatchReadiness({ ...base, tournamentStatus: "COMPLETED" })).toMatchObject({ code: "BLOCKED_STAGE_NOT_OPEN" });
    expect(evaluateMatchReadiness({ ...base, matchStatus: "COMPLETED" })).toMatchObject({ code: "BLOCKED_MATCH_FINISHED" });
  });
});
