import { describe, expect, it } from "vitest";

import type { OfflineCommand } from "./offline-command-queue";
import { assignmentQueueEntries, tournamentQueueScope, unsentAssignments } from "./tournament-assignment-queue";

const matchId = "11111111-1111-4111-8111-111111111111";
const boardId = "22222222-2222-4222-8222-222222222222";
const commandId = "33333333-3333-4333-8333-333333333333";

function command(overrides: Partial<OfflineCommand> = {}): OfflineCommand {
  return {
    commandId,
    scope: tournamentQueueScope("org", "tournament"),
    path: "/organizations/org/tournaments/tournament/assignments",
    body: { commandId, expectedVersion: 7, matchId, boardId },
    label: "Eins – Zwei auf Board 1",
    createdAt: "2026-09-06T10:00:00.000Z",
    status: "PENDING",
    error: null,
    ...overrides,
  };
}

describe("tournamentQueueScope", () => {
  it("trennt Turniere und Organisationen", () => {
    expect(tournamentQueueScope("org", "tournament")).toBe("tournament:org:tournament");
    expect(tournamentQueueScope("org", "andere")).not.toBe(tournamentQueueScope("org", "tournament"));
  });
});

describe("assignmentQueueEntries", () => {
  it("liest Match, Board und erwartete Version aus der Nutzlast", () => {
    expect(assignmentQueueEntries([command()])).toEqual([
      { command: command(), matchId, boardId, expectedVersion: 7 },
    ]);
  });

  it("uebergeht eine fremde oder beschaedigte Nutzlast", () => {
    expect(assignmentQueueEntries([command({ body: { points: 60 } })])).toEqual([]);
  });
});

describe("unsentAssignments", () => {
  it("zaehlt wartende und konfliktbehaftete Zuweisungen", () => {
    const entries = assignmentQueueEntries([
      command({ commandId: "a", status: "PENDING" }),
      command({ commandId: "b", status: "CONFLICT", error: "Konflikt" }),
    ]);
    expect(unsentAssignments(entries)).toHaveLength(2);
  });

  it("gibt Board und Match einer abgelehnten Zuweisung wieder frei", () => {
    const entries = assignmentQueueEntries([command({ status: "REJECTED", error: "Board belegt." })]);
    expect(unsentAssignments(entries)).toEqual([]);
  });
});
