import { describe, expect, it } from "vitest";

import { evaluateMatchReadiness, evaluateSlotReadiness } from "./readiness";

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

describe("evaluateSlotReadiness", () => {
  const base = {
    requiredPlayersPerSide: 2 as const,
    activePlayerIds: new Set<string>(),
    boardAvailable: true,
    slotStatus: "WAITING" as const,
    encounterStatus: "RUNNING" as const,
  };

  it("starts a doubles slot when both sides carry two free people", () => {
    const decision = evaluateSlotReadiness({
      ...base,
      sidePlayerIds: [["home-1", "home-2"], ["away-1", "away-2"]],
    });
    expect(decision.ready).toBe(true);
  });

  it("blocks a doubles slot with an incomplete pairing", () => {
    const decision = evaluateSlotReadiness({
      ...base,
      sidePlayerIds: [["home-1"], ["away-1", "away-2"]],
    });
    expect(decision).toMatchObject({ ready: false, code: "BLOCKED_PARTICIPANT_UNDECIDED" });
  });

  it("blocks a person who is already playing another slot", () => {
    const decision = evaluateSlotReadiness({
      ...base,
      sidePlayerIds: [["home-1", "home-2"], ["away-1", "away-2"]],
      activePlayerIds: new Set(["away-2"]),
    });
    expect(decision).toMatchObject({ ready: false, code: "BLOCKED_PLAYER_BUSY" });
  });

  it("blocks when no board is free", () => {
    const decision = evaluateSlotReadiness({
      ...base,
      sidePlayerIds: [["home-1", "home-2"], ["away-1", "away-2"]],
      boardAvailable: false,
    });
    expect(decision).toMatchObject({ ready: false, code: "BLOCKED_NO_BOARD" });
  });

  it("blocks a singles slot that has no nomination on one side", () => {
    const decision = evaluateSlotReadiness({
      ...base,
      requiredPlayersPerSide: 1,
      sidePlayerIds: [["home-1"], []],
    });
    expect(decision).toMatchObject({ ready: false, code: "BLOCKED_PARTICIPANT_UNDECIDED" });
  });

  it("refuses a slot that is already scored or already running", () => {
    const players: readonly [readonly string[], readonly string[]] = [["home-1"], ["away-1"]];
    expect(
      evaluateSlotReadiness({
        ...base,
        requiredPlayersPerSide: 1,
        sidePlayerIds: players,
        slotStatus: "WALKOVER",
      }),
    ).toMatchObject({ ready: false, code: "BLOCKED_MATCH_FINISHED" });
    expect(
      evaluateSlotReadiness({
        ...base,
        requiredPlayersPerSide: 1,
        sidePlayerIds: players,
        slotStatus: "IN_PROGRESS",
      }),
    ).toMatchObject({ ready: false, code: "BLOCKED_PLAYER_BUSY" });
  });

  it("refuses a slot while the encounter has not started", () => {
    expect(
      evaluateSlotReadiness({
        ...base,
        requiredPlayersPerSide: 1,
        sidePlayerIds: [["home-1"], ["away-1"]],
        encounterStatus: "READY",
      }),
    ).toMatchObject({ ready: false, code: "BLOCKED_STAGE_NOT_OPEN" });
  });
});
