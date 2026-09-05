import { describe, expect, it } from "vitest";
import { dartEntryReducer, emptyDartEntry, isSegmentAvailable, previewDartEntry } from "./dart-entry";

describe("dartEntryReducer", () => {
  it("legt einen Single ab", () => {
    const state = dartEntryReducer(emptyDartEntry, { type: "SEGMENT", segment: 20 });
    expect(state.darts).toEqual([{ segment: 20, multiplier: 1 }]);
  });

  it("wendet den Umschalter auf genau einen Wurf an", () => {
    const withModifier = dartEntryReducer(emptyDartEntry, { type: "MODIFIER", multiplier: 3 });
    const afterFirst = dartEntryReducer(withModifier, { type: "SEGMENT", segment: 20 });
    const afterSecond = dartEntryReducer(afterFirst, { type: "SEGMENT", segment: 20 });
    expect(afterSecond.darts).toEqual([
      { segment: 20, multiplier: 3 },
      { segment: 20, multiplier: 1 },
    ]);
  });

  it("schaltet einen aktiven Umschalter wieder ab", () => {
    const on = dartEntryReducer(emptyDartEntry, { type: "MODIFIER", multiplier: 2 });
    expect(dartEntryReducer(on, { type: "MODIFIER", multiplier: 2 }).modifier).toBe(1);
  });

  it("nimmt mit der Rücktaste den letzten Wurf zurück", () => {
    const one = dartEntryReducer(emptyDartEntry, { type: "SEGMENT", segment: 5 });
    expect(dartEntryReducer(one, { type: "BACKSPACE" }).darts).toEqual([]);
  });

  it("nimmt keinen vierten Wurf an", () => {
    let state = emptyDartEntry;
    for (const segment of [20, 20, 20, 20]) state = dartEntryReducer(state, { type: "SEGMENT", segment });
    expect(state.darts).toHaveLength(3);
  });

  it("bildet die Bullseye-Taste auf Doppel 25 ab", () => {
    expect(dartEntryReducer(emptyDartEntry, { type: "SEGMENT", segment: 50 }).darts).toEqual([
      { segment: 25, multiplier: 2 },
    ]);
  });

  it("sperrt die Bullseye-Taste bei aktivem Umschalter", () => {
    const withTriple = dartEntryReducer(emptyDartEntry, { type: "MODIFIER", multiplier: 3 });
    expect(dartEntryReducer(withTriple, { type: "SEGMENT", segment: 50 }).darts).toEqual([]);
  });

  it("setzt die Aufnahme mit RESET zurück", () => {
    const state = dartEntryReducer(emptyDartEntry, { type: "SEGMENT", segment: 20 });
    expect(dartEntryReducer(state, { type: "RESET" })).toEqual(emptyDartEntry);
  });
});

describe("isSegmentAvailable", () => {
  it("sperrt das Triple auf Bull", () => {
    expect(isSegmentAvailable(25, 3)).toBe(false);
    expect(isSegmentAvailable(25, 2)).toBe(true);
  });

  it("sperrt jeden Multiplikator auf dem Fehlwurf", () => {
    expect(isSegmentAvailable(0, 2)).toBe(false);
    expect(isSegmentAvailable(0, 1)).toBe(true);
  });
});

describe("previewDartEntry", () => {
  it("meldet die Aufnahme als offen, solange Würfe fehlen", () => {
    const preview = previewDartEntry({ darts: [{ segment: 20, multiplier: 1 }], remaining: 501, outRule: "DOUBLE" });
    expect(preview).toMatchObject({ points: 20, remaining: 481, complete: false, outcome: "OPEN" });
  });

  it("erkennt einen Checkout auf dem Doppel", () => {
    const preview = previewDartEntry({ darts: [{ segment: 20, multiplier: 2 }], remaining: 40, outRule: "DOUBLE" });
    expect(preview).toMatchObject({ complete: true, outcome: "CHECKOUT", remaining: 0 });
  });

  it("erkennt den Bust unter null", () => {
    const preview = previewDartEntry({ darts: [{ segment: 20, multiplier: 3 }], remaining: 40, outRule: "DOUBLE" });
    expect(preview).toMatchObject({ complete: true, outcome: "BUST", remaining: 40 });
  });

  it("erkennt den Bust auf Rest eins bei Double Out", () => {
    const preview = previewDartEntry({ darts: [{ segment: 19, multiplier: 1 }], remaining: 20, outRule: "DOUBLE" });
    expect(preview).toMatchObject({ complete: true, outcome: "BUST" });
  });

  it("wertet ein Single-Finish bei Double Out als Bust", () => {
    const preview = previewDartEntry({ darts: [{ segment: 20, multiplier: 1 }], remaining: 20, outRule: "DOUBLE" });
    expect(preview.outcome).toBe("BUST");
  });

  it("schliesst die Aufnahme nach dem dritten Wurf", () => {
    const preview = previewDartEntry({
      darts: [
        { segment: 20, multiplier: 1 },
        { segment: 20, multiplier: 1 },
        { segment: 20, multiplier: 1 },
      ],
      remaining: 501,
      outRule: "DOUBLE",
    });
    expect(preview).toMatchObject({ complete: true, outcome: "SCORED", remaining: 441 });
  });

  /**
   * Reglement/Auflage aus Task 3: Die Aufnahme endet mit dem Checkout, auch
   * wenn erst zwei von drei Würfen erfasst sind. Die Vorschau darf hier nicht
   * auf den dritten Wurf warten – erst dieses Signal erlaubt es der
   * aufrufenden Komponente (Task 9/10), nach dem entscheidenden Doppel keine
   * weiteren Würfe mehr an den Reducer weiterzugeben.
   */
  it("erkennt den Checkout schon nach dem zweiten Wurf, ohne auf den dritten zu warten", () => {
    const preview = previewDartEntry({
      darts: [
        { segment: 20, multiplier: 1 },
        { segment: 20, multiplier: 2 },
      ],
      remaining: 60,
      outRule: "DOUBLE",
    });
    expect(preview).toMatchObject({ complete: true, outcome: "CHECKOUT", remaining: 0 });
  });
});
