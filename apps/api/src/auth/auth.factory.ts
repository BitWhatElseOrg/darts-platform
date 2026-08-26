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

export function createAuth(
  database: Database,
  environment: ApplicationEnvironment,
) {
  return betterAuth({
    appName: "Dart Ost - Plattform",
    baseURL: environment.BETTER_AUTH_URL,
    basePath: "/api/v1/auth",
    secret: environment.BETTER_AUTH_SECRET,
    trustedOrigins: [environment.WEB_ORIGIN],
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
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const [invitation] = await database
              .select({ id: organizationInvitations.id })
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
              )
              .limit(1);

            if (invitation === undefined) {
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
