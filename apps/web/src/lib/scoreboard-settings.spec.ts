import { describe, expect, it } from "vitest";
import {
  defaultScoreboardSettings,
  parseScoreboardSettings,
  readScoreboardSettings,
  writeScoreboardSettings,
} from "./scoreboard-settings";

describe("parseScoreboardSettings", () => {
  it("liefert die Standardwerte ohne gespeicherten Wert", () => {
    expect(parseScoreboardSettings(null)).toEqual(defaultScoreboardSettings);
  });

  it("liefert die Standardwerte bei kaputtem JSON", () => {
    expect(parseScoreboardSettings("{nicht json")).toEqual(defaultScoreboardSettings);
  });

  it("liefert die Standardwerte bei unbekanntem Modus", () => {
    expect(parseScoreboardSettings(JSON.stringify({ mode: "GEMISCHT", confirmScore: true, autoConfirm: false, confirmCheckoutDarts: true })))
      .toEqual(defaultScoreboardSettings);
  });

  it("liest gültige Einstellungen", () => {
    const stored = { mode: "ROUND", confirmScore: false, autoConfirm: false, confirmCheckoutDarts: false };
    expect(parseScoreboardSettings(JSON.stringify(stored))).toEqual(stored);
  });

  it("startet im Dart-Modus mit Bestätigung und ohne automatisches Absenden", () => {
    expect(defaultScoreboardSettings).toEqual({
      mode: "DART", confirmScore: true, autoConfirm: false, confirmCheckoutDarts: true,
    });
  });
});

describe("readScoreboardSettings", () => {
  it("liefert denselben Schnappschuss, solange nichts geschrieben wurde", () => {
    expect(readScoreboardSettings()).toBe(readScoreboardSettings());
  });

  it("liefert nach dem Schreiben den neuen Stand", () => {
    const next = { mode: "ROUND", confirmScore: false, autoConfirm: false, confirmCheckoutDarts: false } as const;
    writeScoreboardSettings(next);
    expect(readScoreboardSettings()).toEqual(next);
  });
});
