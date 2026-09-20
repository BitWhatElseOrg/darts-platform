import { describe, expect, it } from "vitest";

import { isUndefinedTableError } from "./undefined-table.js";

describe("isUndefinedTableError", () => {
  it("findet 42P01 in der cause-Kette, die Drizzle um den Treiberfehler legt", () => {
    const driverError = {
      code: "42P01",
      message: 'relation "email_deliveries" does not exist',
    };
    const wrapped = new Error("Failed query", { cause: new Error("query", { cause: driverError }) });

    expect(isUndefinedTableError(wrapped)).toBe(true);
  });

  it("erkennt den Code auch direkt am Fehlerobjekt", () => {
    expect(isUndefinedTableError({ code: "42P01" })).toBe(true);
  });

  it("verwechselt eine abgerissene Verbindung nicht mit einer fehlenden Tabelle", () => {
    expect(isUndefinedTableError(new Error("Failed query", { cause: { code: "57P01" } }))).toBe(false);
  });

  it("bleibt bei fremden Werten stumm", () => {
    expect(isUndefinedTableError(null)).toBe(false);
    expect(isUndefinedTableError(undefined)).toBe(false);
    expect(isUndefinedTableError("42P01")).toBe(false);
    expect(isUndefinedTableError(new Error("relation does not exist"))).toBe(false);
  });
});
