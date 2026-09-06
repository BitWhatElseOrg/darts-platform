import { describe, expect, it } from "vitest";

import { ApiClientError } from "./api-error";
import type { OfflineCommand } from "./offline-command-queue";
import { nextReplayable, queueBlocksControl, queuedCommandNotice, replayFailure } from "./offline-replay";

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

/** Antwort der API mit Fehlerformat, wie `apiRequest` sie wirft. */
function apiError(code: string, status: number, message = "egal"): ApiClientError {
  return new ApiClientError(message, code, null, undefined, status);
}

describe("replayFailure", () => {
  it("laesst einen Netzwerkfehler in der Warteschlange", () => {
    expect(replayFailure(new TypeError("Failed to fetch"))).toEqual({ kind: "RETRY" });
  });

  /**
   * Antwortet ein Proxy mit HTML statt JSON, scheitert `response.json()` mit
   * einem `SyntaxError`, bevor irgendein Status gelesen wird. Auch das ist
   * kein Urteil des Servers.
   */
  it("laesst eine nicht lesbare Antwort in der Warteschlange", () => {
    expect(replayFailure(new SyntaxError("Unexpected token < in JSON at position 0"))).toEqual({ kind: "RETRY" });
  });

  it("meldet die Konfliktcodes mit handlungsleitendem Text", () => {
    const versionConflict = replayFailure(apiError("MATCH_VERSION_CONFLICT", 409));
    expect(versionConflict.kind).toBe("CONFLICT");
    expect(versionConflict).toMatchObject({ code: "MATCH_VERSION_CONFLICT" });
    expect(replayFailure(apiError("BOARD_CONTROLLER_CONFLICT", 409)).kind).toBe("CONFLICT");
  });

  /**
   * Der Befund: vor dieser Unterscheidung blieb ein fachlich abgelehntes
   * Kommando dauerhaft `PENDING` und sperrte das Board.
   */
  it("erklaert eine fachliche Ablehnung (4xx mit Code) fuer endgueltig", () => {
    const rejected = replayFailure(
      apiError("DARTS_REQUIRED_FOR_DOUBLE_IN", 400, "Unter Double In wird die Eröffnungsaufnahme Wurf für Wurf erfasst."),
    );
    expect(rejected).toEqual({
      kind: "REJECTED",
      code: "DARTS_REQUIRED_FOR_DOUBLE_IN",
      message: "Unter Double In wird die Eröffnungsaufnahme Wurf für Wurf erfasst.",
    });
    expect(replayFailure(apiError("FORBIDDEN", 403)).kind).toBe("REJECTED");
  });

  /**
   * Befund C1: Der API-Filter vergibt auch fuer 500/502/503 einen Fehlercode
   * (`errorCodes[status] ?? "INTERNAL_ERROR"`). Ohne den Status haette ein
   * Railway-Neustart waehrend der Wiedergabe eine von Hand erfasste Aufnahme
   * als „vom Server abgelehnt" markiert.
   */
  it("wiederholt eine Stoerung des Servers statt sie zu verwerfen", () => {
    for (const status of [500, 502, 503, 504]) {
      expect(replayFailure(apiError("INTERNAL_ERROR", status))).toEqual({ kind: "RETRY" });
    }
  });

  it("wiederholt Zeitablauf und Drosselung", () => {
    expect(replayFailure(apiError("REQUEST_TIMEOUT", 408))).toEqual({ kind: "RETRY" });
    expect(replayFailure(apiError("TOO_MANY_REQUESTS", 429))).toEqual({ kind: "RETRY" });
  });

  it("wiederholt, solange kein Status bekannt ist", () => {
    expect(replayFailure(new ApiClientError("Die API hat nicht geantwortet.")).kind).toBe("RETRY");
  });
});

describe("nextReplayable", () => {
  /**
   * Befund I1: Ein Filter hielt die Reihenfolge nur im laufenden Durchgang.
   * Beim naechsten Auslöser ging der Nachfolger eines abgelehnten Kopfes
   * durch — die zweite Aufnahme stand in der Datenbank, die erste nicht.
   */
  it("liefert nichts, solange der Kopf abgelehnt ist", () => {
    expect(nextReplayable([
      command({ commandId: "c1", status: "REJECTED", error: "abgelehnt" }),
      command({ commandId: "c2", status: "PENDING" }),
    ])).toEqual([]);
  });

  it("bricht beim ersten nicht wartenden Kommando ab", () => {
    const commands = [
      command({ commandId: "c1", status: "PENDING" }),
      command({ commandId: "c2", status: "REJECTED", error: "abgelehnt" }),
      command({ commandId: "c3", status: "PENDING" }),
    ];
    expect(nextReplayable(commands).map((entry) => entry.commandId)).toEqual(["c1"]);
  });

  it("haelt auch ein Konfliktkommando die Warteschlange an", () => {
    expect(nextReplayable([
      command({ commandId: "c1", status: "CONFLICT", error: "Konflikt" }),
      command({ commandId: "c2", status: "PENDING" }),
    ])).toEqual([]);
  });

  it("liefert alle wartenden Kommandos, wenn keines im Weg steht", () => {
    const commands = [command({ commandId: "c1" }), command({ commandId: "c2" })];
    expect(nextReplayable(commands)).toEqual(commands);
    expect(nextReplayable([])).toEqual([]);
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
