import { describe, expect, it } from "vitest";
import { migrateDatabase } from "./index.js";

describe("database migration API", () => {
  it("exports the isolated migration runner", () => {
    expect(migrateDatabase).toBeTypeOf("function");
  });
});
