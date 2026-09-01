import { describe, expect, it } from "vitest";

import {
  generateInvitationClaimToken,
  hashInvitationClaimToken,
  invitationClaimMatches,
} from "./invitation-claim.js";

describe("invitation claims", () => {
  it("generates a 256-bit base64url token and verifies only its exact hash", () => {
    const token = generateInvitationClaimToken();
    const hash = hashInvitationClaimToken(token);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(invitationClaimMatches(token, hash)).toBe(true);
    const invalidToken = `${token.startsWith("A") ? "B" : "A"}${token.slice(1)}`;
    expect(invitationClaimMatches(invalidToken, hash)).toBe(false);
    expect(invitationClaimMatches(undefined, hash)).toBe(false);
    expect(invitationClaimMatches(token, null)).toBe(false);
  });
});
