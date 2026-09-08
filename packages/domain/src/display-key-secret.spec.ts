import { describe, expect, it } from "vitest";

import { createDisplayKeySecret, hashDisplayKeySecret } from "./display-key-secret";

describe("createDisplayKeySecret", () => {
  it("liefert jedes Mal einen anderen Wert", () => {
    const secrets = new Set(Array.from({ length: 50 }, () => createDisplayKeySecret()));

    expect(secrets.size).toBe(50);
  });

  it("ist lang genug, dass Raten aussichtslos ist", () => {
    // 32 Bytes base64url — dieselbe Groessenordnung wie ein Sitzungstoken.
    expect(createDisplayKeySecret()).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });
});

describe("hashDisplayKeySecret", () => {
  it("bildet denselben Klartext auf denselben Hash ab", () => {
    expect(hashDisplayKeySecret("abc")).toBe(hashDisplayKeySecret("abc"));
  });

  it("liefert 64 Hex-Zeichen", () => {
    expect(hashDisplayKeySecret("abc")).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("gibt den Klartext nicht preis", () => {
    expect(hashDisplayKeySecret("abc")).not.toContain("abc");
  });
});
