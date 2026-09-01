import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { invitationClaimTokenSchema } from "@darts-platform/schemas";

export const INVITATION_CLAIM_HEADER = "x-dartbase-invitation-claim";

export function generateInvitationClaimToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInvitationClaimToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function invitationClaimMatches(
  token: string | null | undefined,
  expectedHash: string | null,
): boolean {
  const parsed = invitationClaimTokenSchema.safeParse(token);
  if (!parsed.success || expectedHash === null) {
    return false;
  }

  const actual = Buffer.from(hashInvitationClaimToken(parsed.data), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
