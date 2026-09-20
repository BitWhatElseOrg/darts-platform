import { describe, expect, it } from "vitest";

import { buildInvitationUrl } from "./invitation-link.js";

describe("buildInvitationUrl", () => {
  it("setzt den Code ins Fragment, nicht in den Query-String", () => {
    const url = buildInvitationUrl(
      "https://dartbase.ch",
      "11111111-1111-4111-8111-111111111111",
      "abc_DEF-123",
    );
    expect(url).toBe(
      "https://dartbase.ch/einladung/11111111-1111-4111-8111-111111111111#code=abc_DEF-123",
    );
    expect(new URL(url).search).toBe("");
  });

  it("verwirft Pfad und Query des Ursprungs", () => {
    expect(buildInvitationUrl("http://localhost:3000/irgendwo?x=1", "id", "c")).toBe(
      "http://localhost:3000/einladung/id#code=c",
    );
  });
});
