import { describe, expect, it } from "vitest";

import { liveDotClass } from "./live-status";

describe("liveDotClass", () => {
  it("ist gruen, wenn der Socket steht", () => {
    expect(liveDotClass({ isError: false, connection: "verbunden" })).toBe("bg-ring-green");
  });

  it("ist grau, solange nur im Intervall nachgeladen wird", () => {
    for (const connection of ["verbindet", "getrennt", "abgewiesen"] as const) {
      expect(liveDotClass({ isError: false, connection })).toBe("bg-sisal-400");
    }
  });

  it("ist rot, wenn der Nachlauf scheitert – unabhaengig von der Verbindung", () => {
    expect(liveDotClass({ isError: true, connection: "verbunden" })).toBe("bg-ring-red");
    expect(liveDotClass({ isError: true, connection: "getrennt" })).toBe("bg-ring-red");
  });
});
