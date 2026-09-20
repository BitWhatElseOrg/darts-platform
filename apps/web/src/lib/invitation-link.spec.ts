import { describe, expect, it } from "vitest";

import { buildInvitationLink, readInvitationCode } from "./invitation-link";

describe("readInvitationCode", () => {
  it("liest den Code aus dem Fragment", () => {
    expect(readInvitationCode("#code=abc_DEF-123")).toBe("abc_DEF-123");
  });

  it("liefert null ohne Fragment oder ohne code-Parameter", () => {
    expect(readInvitationCode("")).toBeNull();
    expect(readInvitationCode("#")).toBeNull();
    expect(readInvitationCode("#foo=bar")).toBeNull();
  });

  it("liefert null fuer einen leeren Code", () => {
    expect(readInvitationCode("#code=")).toBeNull();
  });
});

describe("buildInvitationLink", () => {
  it("baut denselben Link wie der Server", () => {
    expect(buildInvitationLink("https://dartbase.ch", "11111111-1111-4111-8111-111111111111", "abc")).toBe(
      "https://dartbase.ch/einladung/11111111-1111-4111-8111-111111111111#code=abc",
    );
  });
});
