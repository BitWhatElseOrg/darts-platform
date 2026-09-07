import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { APIError, betterAuth } from "better-auth";
import { and, eq, gt } from "drizzle-orm";

import type { ApplicationEnvironment } from "@darts-platform/config";
import {
  accounts,
  organizationInvitations,
  sessions,
  users,
  verifications,
  type Database,
} from "@darts-platform/database";

import type { RateLimitStorage } from "./auth-rate-limit-storage.js";
import {
  INVITATION_CLAIM_HEADER,
  invitationClaimMatches,
} from "./invitation-claim.js";

export function createAuth(
  database: Database,
  environment: ApplicationEnvironment,
  rateLimitStorage?: RateLimitStorage,
) {
  return betterAuth({
    appName: "DartBase - Plattform",
    baseURL: environment.BETTER_AUTH_URL,
    basePath: "/api/v1/auth",
    secret: environment.BETTER_AUTH_SECRET,
    trustedOrigins: [
      environment.WEB_ORIGIN,
      ...environment.WEB_ADDITIONAL_ORIGINS,
    ],
    database: drizzleAdapter(database, {
      provider: "pg",
      transaction: true,
      schema: {
        account: accounts,
        session: sessions,
        user: users,
        verification: verifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
    },
    // Ohne Zaehler skaliert Passwort-Raten mit der Zahl der Instanzen
    // (Audit B, I-6). `customStorage` legt den Zaehler nach Redis, ohne
    // Sessions dorthin zu verschieben — ADR 0002 bleibt gewahrt.
    rateLimit: {
      enabled: true,
      window: 60,
      max: environment.RATE_LIMIT_MAX_PER_MINUTE,
      customRules: {
        "/sign-in/email": {
          window: 60,
          max: environment.RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE,
        },
        "/sign-up/email": {
          window: 60,
          max: environment.RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE,
        },
      },
      ...(rateLimitStorage === undefined
        ? {}
        : { customStorage: rateLimitStorage }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => {
            const invitationClaim =
              context?.headers?.get(INVITATION_CLAIM_HEADER) ?? null;
            const invitations = await database
              .select({ claimTokenHash: organizationInvitations.claimTokenHash })
              .from(organizationInvitations)
              .where(
                and(
                  eq(
                    organizationInvitations.email,
                    user.email.trim().toLowerCase(),
                  ),
                  eq(organizationInvitations.status, "PENDING"),
                  gt(organizationInvitations.expiresAt, new Date()),
                ),
              );

            if (
              !invitations.some((invitation) =>
                invitationClaimMatches(
                  invitationClaim,
                  invitation.claimTokenHash,
                ),
              )
            ) {
              throw new APIError("FORBIDDEN", {
                message: "Registration requires a valid invitation.",
              });
            }
          },
        },
      },
    },
    user: {
      fields: {
        name: "displayName",
      },
    },
    advanced: {
      database: {
        generateId: "uuid",
      },
    },
  });
}

export type DartsAuth = ReturnType<typeof createAuth>;
