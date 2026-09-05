import { describe, expect, it } from "vitest";
import {
  appendRoundDigit,
  checkoutDoubleFromField,
  checkoutFieldOptions,
  checkoutMissLabel,
  checkoutOutRuleFor,
  decodeCheckoutField,
  encodeCheckoutField,
  isRoundEntrySubmittable,
  onlyPossibleDouble,
  removeRoundDigit,
} from "./round-entry";

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

describe("onlyPossibleDouble", () => {
  it("erkennt Bull als einzige Möglichkeit bei 50", () => {
    expect(onlyPossibleDouble(50)).toBe(25);
  });

  it("erkennt Doppel 20 als einzige Möglichkeit bei 40", () => {
    expect(onlyPossibleDouble(40)).toBe(20);
  });

  it("erkennt Doppel 1 als einzige Möglichkeit bei 2", () => {
    expect(onlyPossibleDouble(2)).toBe(1);
  });

  it("lehnt einen ungeraden Rest ab, weil dort mehrere Doppel infrage kämen", () => {
    expect(onlyPossibleDouble(39)).toBeNull();
  });

  it("lehnt einen geraden Rest über 40 ab, weil mehr als ein Doppel möglich ist", () => {
    expect(onlyPossibleDouble(42)).toBeNull();
  });

  it("erkennt Doppel 16 als einzige Möglichkeit bei 32", () => {
    expect(onlyPossibleDouble(32)).toBe(16);
  });
});

describe("encodeCheckoutField / decodeCheckoutField", () => {
  it("kodiert ein Doppel als reine Segmentzahl", () => {
    expect(encodeCheckoutField("DOUBLE", 16)).toBe("16");
  });

  it("kodiert Bull als Segment 25", () => {
    expect(encodeCheckoutField("DOUBLE", 25)).toBe("25");
  });

  it("kodiert ein Triple mit dem Präfix T", () => {
    expect(encodeCheckoutField("TRIPLE", 20)).toBe("T20");
  });

  it("dekodiert eine reine Segmentzahl als Doppel", () => {
    expect(decodeCheckoutField("16")).toEqual({ kind: "DOUBLE", segment: 16 });
  });

  it("dekodiert Bull als Doppel-Segment 25", () => {
    expect(decodeCheckoutField("25")).toEqual({ kind: "DOUBLE", segment: 25 });
  });

  it("dekodiert das T-Präfix als Triple", () => {
    expect(decodeCheckoutField("T20")).toEqual({ kind: "TRIPLE", segment: 20 });
  });

  it("dekodiert eine leere Eingabe als null", () => {
    expect(decodeCheckoutField("")).toBeNull();
  });

  it("dekodiert eine unlesbare Segmentzahl als null", () => {
    expect(decodeCheckoutField("Tabc")).toBeNull();
  });

  it("bleibt ein Rundtrip für jedes Doppel und Triple", () => {
    expect(decodeCheckoutField(encodeCheckoutField("DOUBLE", 12))).toEqual({ kind: "DOUBLE", segment: 12 });
    expect(decodeCheckoutField(encodeCheckoutField("TRIPLE", 12))).toEqual({ kind: "TRIPLE", segment: 12 });
  });
});

describe("checkoutFieldOptions", () => {
  it("bietet unter DOUBLE nur die 20 Doppel und Bull, keine Triple", () => {
    const { doubles, triples } = checkoutFieldOptions("DOUBLE");
    expect(doubles).toHaveLength(21);
    expect(doubles[0]).toEqual({ value: "1", label: "D1" });
    expect(doubles[19]).toEqual({ value: "20", label: "D20" });
    expect(doubles.at(-1)).toEqual({ value: "25", label: "Bull (Double 25)" });
    expect(triples).toHaveLength(0);
  });

  it("bietet unter MASTER zusätzlich alle 20 Triple, Doppel unverändert", () => {
    const { doubles, triples } = checkoutFieldOptions("MASTER");
    expect(doubles).toEqual(checkoutFieldOptions("DOUBLE").doubles);
    expect(triples).toHaveLength(20);
    expect(triples[0]).toEqual({ value: "T1", label: "T1" });
    expect(triples.at(-1)).toEqual({ value: "T20", label: "T20" });
  });
});

describe("checkoutMissLabel", () => {
  it("nennt unter DOUBLE nur das Doppel", () => {
    expect(checkoutMissLabel("DOUBLE")).toBe("Kein Doppel getroffen (Bust)");
  });

  it("nennt unter MASTER Doppel und Triple", () => {
    expect(checkoutMissLabel("MASTER")).toBe("Kein Doppel oder Triple getroffen (Bust)");
  });
});

describe("checkoutOutRuleFor", () => {
  it("bleibt DOUBLE unter der Ausgangsregel DOUBLE", () => {
    expect(checkoutOutRuleFor("DOUBLE")).toBe("DOUBLE");
  });

  it("wird MASTER unter der Ausgangsregel MASTER", () => {
    expect(checkoutOutRuleFor("MASTER")).toBe("MASTER");
  });

  it("faellt unter SINGLE auf DOUBLE zurueck (der Checkout-Dialog oeffnet dort ohnehin nie)", () => {
    expect(checkoutOutRuleFor("SINGLE")).toBe("DOUBLE");
  });
});

describe("checkoutDoubleFromField", () => {
  it("liefert das Segment bei einem Doppel", () => {
    expect(checkoutDoubleFromField("20")).toBe(20);
  });

  it("liefert Bull als Segment 25", () => {
    expect(checkoutDoubleFromField("25")).toBe(25);
  });

  it("liefert undefined bei einem Triple", () => {
    expect(checkoutDoubleFromField("T20")).toBeUndefined();
  });

  it("liefert undefined bei leerem Feld", () => {
    expect(checkoutDoubleFromField("")).toBeUndefined();
  });
});
