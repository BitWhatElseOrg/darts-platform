import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";

import type { ApplicationEnvironment } from "@darts-platform/config";
import {
  accounts,
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
    appName: "Darts Platform",
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
