import { describe, expect, it } from "vitest";

import { isDeadlockError, isUniqueViolation } from "./postgres-error.js";

describe("isDeadlockError", () => {
  it("findet die Kennung in der cause-Kette, die Drizzle um den Treiberfehler legt", () => {
    const driverError = { code: "40P01", message: "deadlock detected" };
    const wrapped = new Error("Failed query", { cause: new Error("query", { cause: driverError }) });

    expect(isDeadlockError(wrapped)).toBe(true);
  });

  it("verwechselt einen Constraint-Verstoss nicht mit einem Sperrzyklus", () => {
    const driverError = { code: "23505", constraint_name: "matches_board_in_progress_unique" };

    expect(isDeadlockError(new Error("Failed query", { cause: driverError }))).toBe(false);
  });

  it("bleibt bei fremden Werten stumm", () => {
    expect(isDeadlockError(null)).toBe(false);
    expect(isDeadlockError("40P01")).toBe(false);
    expect(isDeadlockError(undefined)).toBe(false);
  });
});

describe("isUniqueViolation", () => {
  const driverError = { code: "23505", constraint_name: "players_guest_command_name_unique" };

  it("findet Kennung und Constraint in der cause-Kette", () => {
    const wrapped = new Error("Failed query", { cause: driverError });

    expect(isUniqueViolation(wrapped, "players_guest_command_name_unique")).toBe(true);
  });

  it("verlangt den genannten Constraint", () => {
    expect(isUniqueViolation(new Error("x", { cause: driverError }), "anderer_index")).toBe(false);
  });

  it("verwechselt andere SQLSTATE-Codes nicht", () => {
    const other = { code: "23503", constraint_name: "players_guest_command_name_unique" };

    expect(isUniqueViolation(new Error("x", { cause: other }), "players_guest_command_name_unique")).toBe(false);
  });

  it("bleibt bei fremden Werten stumm", () => {
    expect(isUniqueViolation(null, "x")).toBe(false);
    expect(isUniqueViolation("23505", "x")).toBe(false);
  });
});
