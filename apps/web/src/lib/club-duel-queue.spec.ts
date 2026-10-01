import type { QueueReadiness } from "@darts-platform/schemas";
import { describe, expect, it } from "vitest";

import { visibleQueue } from "./club-duel-queue";

const entry = (matchId: string, readiness: QueueReadiness) => ({ matchId, readiness });

const queue = [
  entry("m-1", "READY"),
  entry("m-2", "BLOCKED_PARTICIPANT_UNDECIDED"),
  entry("m-3", "BLOCKED_PLAYER_BUSY"),
  entry("m-4", "BLOCKED_NO_BOARD"),
  entry("m-5", "BLOCKED_STAGE_NOT_OPEN"),
];

describe("visibleQueue", () => {
  it("blendet im Vereinsduell die Platzhalter mit unbestimmten Teilnehmern aus", () => {
    expect(visibleQueue(queue, "CLUB_DUEL").map((candidate) => candidate.matchId)).toEqual(["m-1", "m-3", "m-4", "m-5"]);
  });

  it("laesst die uebrigen Formate unveraendert, als dieselbe Referenz", () => {
    expect(visibleQueue(queue, "SINGLE_ELIMINATION")).toBe(queue);
    expect(visibleQueue(queue, "ROUND_ROBIN")).toBe(queue);
    expect(visibleQueue(queue, "GROUPS_THEN_KNOCKOUT")).toBe(queue);
  });

  it("gibt im Vereinsduell eine leere Liste zurueck, wenn nur Platzhalter warten", () => {
    expect(visibleQueue([entry("m-2", "BLOCKED_PARTICIPANT_UNDECIDED")], "CLUB_DUEL")).toEqual([]);
  });
});
