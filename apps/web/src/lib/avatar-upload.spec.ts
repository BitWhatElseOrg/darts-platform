import { describe, expect, it } from "vitest";

import { squareCrop } from "./avatar-upload";

describe("squareCrop", () => {
  it("schneidet ein Querformat mittig zu", () => {
    expect(squareCrop(900, 600)).toEqual({ x: 150, y: 0, size: 600 });
  });

  it("schneidet ein Hochformat mittig zu", () => {
    expect(squareCrop(600, 900)).toEqual({ x: 0, y: 150, size: 600 });
  });

  it("laesst ein Quadrat unveraendert", () => {
    expect(squareCrop(400, 400)).toEqual({ x: 0, y: 0, size: 400 });
  });
});
