import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parseQuery } from "./parse-query.js";

describe("parseQuery", () => {
  const schema = z.enum(["MEMBER", "GUEST", "ALL"]).default("MEMBER");

  it("liefert den geparsten Wert und den Default", () => {
    expect(parseQuery(schema, "GUEST", "kind")).toBe("GUEST");
    expect(parseQuery(schema, undefined, "kind")).toBe("MEMBER");
  });

  it("wirft 400 mit Code INVALID_QUERY und nennt den Parameter", () => {
    let caught: unknown;
    try {
      parseQuery(schema, "BOGUS", "kind");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as BadRequestException).getResponse()).toMatchObject({ code: "INVALID_QUERY", message: expect.stringMatching(/^kind: /) });
  });
});
