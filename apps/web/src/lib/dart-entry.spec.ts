import { describe, expect, it } from "vitest";
import { dartEntryReducer, emptyDartEntry, isSegmentAvailable, previewDartEntry, type VisitContext } from "./dart-entry";

/**
 * Regelkontext einer offenen, noch nicht eroeffneten Aufnahme bei Straight In
 * -- Standardfall fuer Tests, denen es nicht um Double In oder Checkout-
 * Gating geht. `startingScore` ist bei Straight In irrelevant, bleibt aber
 * gesetzt, weil `VisitContext` es verlangt.
 */
const straightContext: VisitContext = {
  remaining: 501,
  startingScore: 501,
  inRule: "STRAIGHT",
  outRule: "DOUBLE",
};

describe("dartEntryReducer", () => {
  it("legt einen Single ab", () => {
    const state = dartEntryReducer(emptyDartEntry, { type: "SEGMENT", segment: 20, ...straightContext });
    expect(state.darts).toEqual([{ segment: 20, multiplier: 1 }]);
  });

  it("wendet den Umschalter auf genau einen Wurf an", () => {
    const withModifier = dartEntryReducer(emptyDartEntry, { type: "MODIFIER", multiplier: 3 });
    const afterFirst = dartEntryReducer(withModifier, { type: "SEGMENT", segment: 20, ...straightContext });
    const afterSecond = dartEntryReducer(afterFirst, { type: "SEGMENT", segment: 20, ...straightContext });
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
    const one = dartEntryReducer(emptyDartEntry, { type: "SEGMENT", segment: 5, ...straightContext });
    expect(dartEntryReducer(one, { type: "BACKSPACE" }).darts).toEqual([]);
  });

  it("nimmt keinen vierten Wurf an", () => {
    let state = emptyDartEntry;
    for (const segment of [20, 20, 20, 20]) {
      state = dartEntryReducer(state, { type: "SEGMENT", segment, ...straightContext });
    }
    expect(state.darts).toHaveLength(3);
  });

  it("bildet die Bullseye-Taste auf Doppel 25 ab", () => {
    expect(
      dartEntryReducer(emptyDartEntry, { type: "SEGMENT", segment: 50, ...straightContext }).darts,
    ).toEqual([{ segment: 25, multiplier: 2 }]);
  });

  it("sperrt die Bullseye-Taste bei aktivem Umschalter", () => {
    const withTriple = dartEntryReducer(emptyDartEntry, { type: "MODIFIER", multiplier: 3 });
    expect(
      dartEntryReducer(withTriple, { type: "SEGMENT", segment: 50, ...straightContext }).darts,
    ).toEqual([]);
  });

  it("setzt die Aufnahme mit RESET zurück", () => {
    const state = dartEntryReducer(emptyDartEntry, { type: "SEGMENT", segment: 20, ...straightContext });
    expect(dartEntryReducer(state, { type: "RESET" })).toEqual(emptyDartEntry);
  });

  /**
   * Auflage aus Task 3 (Review-Befund 1): der Reducer selbst muss die
   * Aufnahme nach einem Checkout beenden, nicht erst eine Komponente, die es
   * noch nicht gibt. Rest 40, Doppel 20 schliesst ab -- der naechste
   * SEGMENT-Dispatch mit demselben (unveraenderten) Reststand der Aufnahme
   * darf keinen weiteren Wurf mehr anhaengen.
   */
  it("nimmt nach einem Checkout keinen weiteren Wurf mehr an", () => {
    const context: VisitContext = { remaining: 40, startingScore: 501, inRule: "STRAIGHT", outRule: "DOUBLE" };
    const withModifier = dartEntryReducer(emptyDartEntry, { type: "MODIFIER", multiplier: 2 });
    const afterCheckout = dartEntryReducer(withModifier, { type: "SEGMENT", segment: 20, ...context });
    expect(afterCheckout.darts).toEqual([{ segment: 20, multiplier: 2 }]);

    const afterFollowUp = dartEntryReducer(afterCheckout, { type: "SEGMENT", segment: 5, ...context });
    expect(afterFollowUp.darts).toEqual([{ segment: 20, multiplier: 2 }]);
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
    const preview = previewDartEntry({
      darts: [{ segment: 20, multiplier: 1 }],
      remaining: 501,
      startingScore: 501,
      inRule: "STRAIGHT",
      outRule: "DOUBLE",
    });
    expect(preview).toMatchObject({ points: 20, remaining: 481, complete: false, outcome: "OPEN" });
  });

  it("erkennt einen Checkout auf dem Doppel", () => {
    const preview = previewDartEntry({
      darts: [{ segment: 20, multiplier: 2 }],
      remaining: 40,
      startingScore: 501,
      inRule: "STRAIGHT",
      outRule: "DOUBLE",
    });
    expect(preview).toMatchObject({ complete: true, outcome: "CHECKOUT", remaining: 0 });
  });

  it("erkennt den Bust unter null", () => {
    const preview = previewDartEntry({
      darts: [{ segment: 20, multiplier: 3 }],
      remaining: 40,
      startingScore: 501,
      inRule: "STRAIGHT",
      outRule: "DOUBLE",
    });
    expect(preview).toMatchObject({ complete: true, outcome: "BUST", remaining: 40 });
  });

  it("erkennt den Bust auf Rest eins bei Double Out", () => {
    const preview = previewDartEntry({
      darts: [{ segment: 19, multiplier: 1 }],
      remaining: 20,
      startingScore: 501,
      inRule: "STRAIGHT",
      outRule: "DOUBLE",
    });
    expect(preview).toMatchObject({ complete: true, outcome: "BUST" });
  });

  it("wertet ein Single-Finish bei Double Out als Bust", () => {
    const preview = previewDartEntry({
      darts: [{ segment: 20, multiplier: 1 }],
      remaining: 20,
      startingScore: 501,
      inRule: "STRAIGHT",
      outRule: "DOUBLE",
    });
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
      startingScore: 501,
      inRule: "STRAIGHT",
      outRule: "DOUBLE",
    });
    expect(preview).toMatchObject({ complete: true, outcome: "SCORED", remaining: 441 });
  });

  it("erkennt den Checkout schon nach dem zweiten Wurf, ohne auf den dritten zu warten", () => {
    const preview = previewDartEntry({
      darts: [
        { segment: 20, multiplier: 1 },
        { segment: 20, multiplier: 2 },
      ],
      remaining: 60,
      startingScore: 501,
      inRule: "STRAIGHT",
      outRule: "DOUBLE",
    });
    expect(preview).toMatchObject({ complete: true, outcome: "CHECKOUT", remaining: 0 });
  });

  /**
   * Review-Befund 2: previewDartEntry kannte die In-Regel nicht und zaehlte
   * bei Double In immer die volle Wurfsumme, obwohl die Engine vor dem
   * ersten Doppel nichts anrechnet. T20/T20/D20 bei Rest 501 mit Double In:
   * die Engine zaehlt nur die letzten 40 Punkte (siehe der gleichnamige
   * Fall in packages/scoring-engine/src/x01.spec.ts), nicht 160 -- die
   * Vorschau darf hier nicht um 120 Punkte danebenliegen.
   */
  it("zaehlt bei Double In erst ab dem ersten Doppel, wie die Engine auch", () => {
    const preview = previewDartEntry({
      darts: [
        { segment: 20, multiplier: 3 },
        { segment: 20, multiplier: 3 },
        { segment: 20, multiplier: 2 },
      ],
      remaining: 501,
      startingScore: 501,
      inRule: "DOUBLE",
      outRule: "DOUBLE",
    });
    expect(preview).toMatchObject({ points: 40, remaining: 461, complete: true, outcome: "SCORED" });
  });
});
