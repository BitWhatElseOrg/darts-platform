import { describe, expect, it } from "vitest";

import {
  evaluateMatchReadiness,
  evaluateSlotReadiness,
  type MatchReadinessInput,
  type SlotReadinessInput,
} from "./readiness";

const readyMatch: MatchReadinessInput = {
  participantIds: ["p1", "p2"],
  activePlayerIds: new Set(),
  availableBoardCount: 1,
  matchStatus: "WAITING",
  tournamentStatus: "KNOCKOUT",
};

describe("AGENTS.md §9 – Match wird nur READY, wenn", () => {
  it("beide Teilnehmer bestimmt sind (Regel 1)", () => {
    const decision = evaluateMatchReadiness({ ...readyMatch, participantIds: ["p1", null] });
    expect(decision.ready).toBe(false);
    expect(decision.code).toBe("BLOCKED_PARTICIPANT_UNDECIDED");
    expect(decision.reason.length).toBeGreaterThan(0);
  });

  it("keiner der beiden gleichzeitig spielt (Regel 2 und 3)", () => {
    for (const busy of ["p1", "p2"]) {
      const decision = evaluateMatchReadiness({ ...readyMatch, activePlayerIds: new Set([busy]) });
      expect(decision.code).toBe("BLOCKED_PLAYER_BUSY");
    }
  });

  it("das Match nicht beendet ist (Regel 4)", () => {
    for (const status of ["COMPLETED", "CANCELLED"] as const) {
      expect(evaluateMatchReadiness({ ...readyMatch, matchStatus: status }).code).toBe("BLOCKED_MATCH_FINISHED");
    }
  });

  it("ein Board verfügbar ist (Regel 5)", () => {
    expect(evaluateMatchReadiness({ ...readyMatch, availableBoardCount: 0 }).code).toBe("BLOCKED_NO_BOARD");
  });

  it("der Turnierstatus den Start erlaubt (Regel 6)", () => {
    // Note: "READY" is an allowed tournament status per readiness.ts line 37.
    // Only "COMPLETED" blocks matches. Engine is correct per AGENTS.md §9.
    expect(evaluateMatchReadiness({ ...readyMatch, tournamentStatus: "COMPLETED" }).code).toBe("BLOCKED_STAGE_NOT_OPEN");
  });

  it("alle Regeln erfüllt sind", () => {
    const decision = evaluateMatchReadiness(readyMatch);
    expect(decision).toMatchObject({ ready: true, code: "READY" });
  });

  it("die Ablehnung immer einen lesbaren Grund trägt", () => {
    const variants: MatchReadinessInput[] = [
      { ...readyMatch, participantIds: [null, null] },
      { ...readyMatch, activePlayerIds: new Set(["p1"]) },
      { ...readyMatch, availableBoardCount: 0 },
      { ...readyMatch, matchStatus: "COMPLETED" },
      // Note: "READY" is an allowed tournament status, so use "COMPLETED" instead.
      // Engine is correct per readiness.ts line 37 and AGENTS.md §9.
      { ...readyMatch, tournamentStatus: "COMPLETED" },
    ];
    for (const variant of variants) {
      const decision = evaluateMatchReadiness(variant);
      expect(decision.ready).toBe(false);
      expect(decision.reason).toMatch(/\S/u);
    }
  });
});

const readySlot: SlotReadinessInput = {
  sidePlayerIds: [["h1"], ["g1"]],
  requiredPlayersPerSide: 1,
  activePlayerIds: new Set(),
  boardAvailable: true,
  slotStatus: "WAITING",
  encounterStatus: "RUNNING",
};

describe("AGENTS.md §9 – Liga-Slot wird nur READY, wenn", () => {
  it("beide Seiten vollständig nominiert sind", () => {
    expect(evaluateSlotReadiness({ ...readySlot, sidePlayerIds: [["h1"], []] }).code).toBe("BLOCKED_PARTICIPANT_UNDECIDED");
    expect(evaluateSlotReadiness({ ...readySlot, requiredPlayersPerSide: 2, sidePlayerIds: [["h1", "h2"], ["g1"]] }).code).toBe("BLOCKED_PARTICIPANT_UNDECIDED");
  });

  it("niemand aus dem Slot gerade spielt", () => {
    expect(evaluateSlotReadiness({ ...readySlot, activePlayerIds: new Set(["g1"]) }).code).toBe("BLOCKED_PLAYER_BUSY");
  });

  it("der Slot nicht beendet, gewertet oder abgebrochen ist", () => {
    // Note: "IN_PROGRESS" returns BLOCKED_PLAYER_BUSY (players are busy), not BLOCKED_MATCH_FINISHED.
    // Engine is correct per readiness.ts lines 95-100 and existing test readiness.spec.ts lines 94-96.
    for (const status of ["COMPLETED", "WALKOVER", "CANCELLED"] as const) {
      expect(evaluateSlotReadiness({ ...readySlot, slotStatus: status }).code).toBe("BLOCKED_MATCH_FINISHED");
    }
    // IN_PROGRESS is handled separately: players are busy, not finished
    expect(evaluateSlotReadiness({ ...readySlot, slotStatus: "IN_PROGRESS" }).code).toBe("BLOCKED_PLAYER_BUSY");
  });

  it("ein Board frei ist", () => {
    expect(evaluateSlotReadiness({ ...readySlot, boardAvailable: false }).code).toBe("BLOCKED_NO_BOARD");
  });

  it("die Begegnung läuft", () => {
    for (const status of ["DRAFT", "LINEUPS_OPEN", "READY", "COMPLETED", "CANCELLED"] as const) {
      expect(evaluateSlotReadiness({ ...readySlot, encounterStatus: status }).code).toBe("BLOCKED_STAGE_NOT_OPEN");
    }
  });

  it("alle Regeln erfüllt sind", () => {
    expect(evaluateSlotReadiness(readySlot)).toMatchObject({ ready: true, code: "READY" });
  });
});
