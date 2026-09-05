import { describe, expect, it } from "vitest";
import { appendRoundDigit, isRoundEntrySubmittable, removeRoundDigit } from "./round-entry";

describe("appendRoundDigit", () => {
  it("hängt eine Ziffer an", () => {
    expect(appendRoundDigit("1", 8)).toBe("18");
  });

  it("nimmt keinen Wert über 180 an", () => {
    expect(appendRoundDigit("18", 5)).toBe("18");
  });

  it("ersetzt die führende Null", () => {
    expect(appendRoundDigit("0", 6)).toBe("6");
  });
});

describe("removeRoundDigit", () => {
  it("entfernt die letzte Ziffer", () => {
    expect(removeRoundDigit("140")).toBe("14");
  });

  it("bleibt bei leerer Eingabe leer", () => {
    expect(removeRoundDigit("")).toBe("");
  });
});

describe("isRoundEntrySubmittable", () => {
  it("lehnt eine leere Eingabe ab", () => {
    expect(isRoundEntrySubmittable("")).toBe(false);
  });

  it("lehnt eine mit drei Darts unmögliche Summe ab", () => {
    expect(isRoundEntrySubmittable("179")).toBe(false);
  });

  it("nimmt 180 an", () => {
    expect(isRoundEntrySubmittable("180")).toBe(true);
  });

  it("nimmt eine Null an", () => {
    expect(isRoundEntrySubmittable("0")).toBe(true);
  });

  it("nimmt eine Überwerfung an, weil der Bust ein gültiger Ausgang ist", () => {
    expect(isRoundEntrySubmittable("60")).toBe(true);
  });

  it("nimmt einen Rest von eins an, weil auch das ein Bust ist", () => {
    expect(isRoundEntrySubmittable("39")).toBe(true);
  });
});
