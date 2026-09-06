import { describe, expect, it } from "vitest";

import { ApiClientError } from "./api-error";
import type { OfflineCommand } from "./offline-command-queue";
import { queueBlocksControl, queuedCommandNotice, replayFailure } from "./offline-replay";

function command(overrides: Partial<OfflineCommand> = {}): OfflineCommand {
  return {
    commandId: "c1",
    scope: "match:org:match",
    path: "/organizations/org/matches/match/visits",
    body: {},
    label: "60 Punkte",
    createdAt: "2026-09-06T10:00:00.000Z",
    status: "PENDING",
    error: null,
    ...overrides,
  };
}

describe("replayFailure", () => {
  it("laesst einen Netzwerkfehler in der Warteschlange", () => {
    expect(replayFailure(new TypeError("Failed to fetch"))).toEqual({ kind: "RETRY" });
  });

  it("meldet die beiden Konfliktcodes mit handlungsleitendem Text", () => {
    const versionConflict = replayFailure(new ApiClientError("egal", "MATCH_VERSION_CONFLICT"));
    expect(versionConflict.kind).toBe("CONFLICT");
    expect(versionConflict).toMatchObject({ code: "MATCH_VERSION_CONFLICT" });
    expect(replayFailure(new ApiClientError("egal", "BOARD_CONTROLLER_CONFLICT")).kind).toBe("CONFLICT");
  });

  /**
   * Der Befund: vor dieser Unterscheidung blieb ein fachlich abgelehntes
   * Kommando dauerhaft `PENDING` und sperrte das Board.
   */
  it("erklaert jede andere Serverablehnung fuer endgueltig", () => {
    const rejected = replayFailure(
      new ApiClientError("Unter Double In wird die Eröffnungsaufnahme Wurf für Wurf erfasst.", "DARTS_REQUIRED_FOR_DOUBLE_IN"),
    );
    expect(rejected).toEqual({
      kind: "REJECTED",
      code: "DARTS_REQUIRED_FOR_DOUBLE_IN",
      message: "Unter Double In wird die Eröffnungsaufnahme Wurf für Wurf erfasst.",
    });
  });
});

describe("queueBlocksControl", () => {
  it("sperrt bei wartenden und bei konfliktbehafteten Kommandos", () => {
    expect(queueBlocksControl([command({ status: "PENDING" })])).toBe(true);
    expect(queueBlocksControl([command({ status: "CONFLICT", error: "Konflikt" })])).toBe(true);
  });

  it("sperrt nicht, wenn nur abgelehnte Kommandos uebrig sind", () => {
    expect(queueBlocksControl([command({ status: "REJECTED", error: "abgelehnt", code: "X" })])).toBe(false);
    expect(queueBlocksControl([])).toBe(false);
  });

  it("sperrt weiterhin, wenn hinter einem abgelehnten noch ein wartendes steht", () => {
    expect(queueBlocksControl([
      command({ commandId: "c1", status: "REJECTED", error: "abgelehnt", code: "X" }),
      command({ commandId: "c2", status: "PENDING" }),
    ])).toBe(true);
  });
});

describe("queuedCommandNotice", () => {
  it("bietet bei Konflikt und Ablehnung das Verwerfen an", () => {
    expect(queuedCommandNotice(command({ status: "CONFLICT", error: "Serverzustand geändert." }), true))
      .toEqual({ text: "60 Punkte · Serverzustand geändert.", action: "DISCARD" });
    expect(queuedCommandNotice(command({ status: "REJECTED", error: "Nicht erlaubt." }), true))
      .toEqual({ text: "60 Punkte · Vom Server abgelehnt: Nicht erlaubt.", action: "DISCARD" });
  });

  it("unterscheidet wartende Kommandos nach Verbindung", () => {
    expect(queuedCommandNotice(command(), true).text).toBe("60 Punkte · Wiederholung läuft");
    expect(queuedCommandNotice(command(), false).text).toBe("60 Punkte · Offline");
    expect(queuedCommandNotice(command(), false).action).toBe("RETRY");
  });
});
