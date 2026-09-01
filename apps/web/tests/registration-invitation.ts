import { createHash, randomBytes, randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  createDatabaseConnection,
  organizationInvitations,
  organizations,
  users,
} from "@darts-platform/database";
import type { Invitation } from "@darts-platform/schemas";

export interface RegistrationInvitationSeed {
  readonly claimToken: string;
  cleanup(): Promise<void>;
}

export async function createRegistrationInvitation(
  email: string,
  role: Invitation["role"] = "TOURNAMENT_DIRECTOR",
): Promise<RegistrationInvitationSeed> {
  const environment = parseApplicationEnvironment(process.env);
  const connection = createDatabaseConnection(environment.DATABASE_URL);
  const inviterId = randomUUID();
  const organizationId = randomUUID();
  const claimToken = randomBytes(32).toString("base64url");
  const claimTokenHash = createHash("sha256")
    .update(claimToken, "utf8")
    .digest("hex");

  try {
    await connection.database.transaction(async (transaction) => {
      await transaction.insert(users).values({
        id: inviterId,
        email: `e2e-inviter-${inviterId}@example.test`,
        displayName: "E2E Inviter",
      });
      await transaction.insert(organizations).values({
        id: organizationId,
        name: "E2E Invitation Organization",
        slug: `e2e-invitation-${organizationId}`,
        timezone: "Europe/Zurich",
        locale: "de-CH",
      });
      await transaction.insert(organizationInvitations).values({
        organizationId,
        email: email.trim().toLowerCase(),
        role,
        claimTokenHash,
        invitedByUserId: inviterId,
        expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      });
    });
  } catch (error: unknown) {
    await connection.close();
    throw error;
  }

  let cleanedUp = false;

  return {
    claimToken,
    async cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      await connection.database
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
      await connection.database.delete(users).where(eq(users.id, inviterId));
      await connection.close();
    },
  };
}
