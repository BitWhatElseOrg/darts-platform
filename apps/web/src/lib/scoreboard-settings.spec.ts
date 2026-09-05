import { describe, expect, it, vi } from "vitest";
import {
  defaultScoreboardSettings,
  parseScoreboardSettings,
  readScoreboardSettings,
  writeScoreboardSettings,
} from "./scoreboard-settings";

/**
 * `apps/web` testet ohne jsdom (kein `vitest.config.*`, keine bestehende Spec
 * nutzt `window`); das Paket bringt `jsdom` nicht mit. Fuer die Faelle, die
 * einen vorhandenen `window` brauchen, wird hier gezielt ein minimaler
 * Speicher untergeschoben – ohne neue Abhaengigkeit und ohne Produktionscode
 * anzufassen.
 */
function withStubbedLocalStorage<T>(run: () => T): T {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    },
  });
  try {
    return run();
  } finally {
    vi.unstubAllGlobals();
  }
}

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

  it("liefert nach dem Schreiben den neuen Stand und eine neue Objektreferenz", () => {
    withStubbedLocalStorage(() => {
      const before = readScoreboardSettings();
      const next = { mode: "ROUND", confirmScore: false, autoConfirm: false, confirmCheckoutDarts: false } as const;
      writeScoreboardSettings(next);
      const after = readScoreboardSettings();
      expect(after).toEqual(next);
      expect(after).not.toBe(before);
    });
  });
});
