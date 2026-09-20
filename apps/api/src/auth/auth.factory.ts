import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { APIError, betterAuth } from "better-auth";
import { and, eq, gt } from "drizzle-orm";

import type { ApplicationEnvironment } from "@darts-platform/config";
import {
  accounts,
  enqueueEmailDelivery,
  organizationInvitations,
  sessions,
  users,
  verifications,
  type Database,
} from "@darts-platform/database";

import type { RateLimitStorage } from "./auth-rate-limit-storage.js";
import { CLIENT_IP_HEADER } from "./client-ip.js";
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
      // Nach einem Reset enden alle bestehenden Sitzungen: wer das Passwort
      // zurueckgesetzt hat, will fremde Sitzungen los sein.
      revokeSessionsOnPasswordReset: true,
      // Kein direkter Versand: der Hook legt nur den Versandauftrag an, der
      // Worker versendet (Spec 2026-09-20-email-versand).
      //
      // Scheitert der Insert, faellt das still aus: Better Auth ruft den Hook
      // ueber `runInBackgroundOrAwait` und faengt die Ausnahme dort ab
      // (`create-context.mjs`), die Route antwortet danach unveraendert mit
      // `200 { status: true }`. Die Person sieht also die neutrale
      // Erfolgsmeldung, obwohl keine Versandzeile existiert und nie eine Mail
      // kommt; die einzige Spur ist eine Fehlerzeile im Better-Auth-Log. Das
      // bereits persistierte Token verfaellt nach einer Stunde, ein erneuter
      // Versuch legt ein neues an.
      sendResetPassword: async ({ user, url }) => {
        try {
          await enqueueEmailDelivery(database, {
            kind: "PASSWORD_RESET",
            recipient: user.email,
            payload: { recipientName: user.name, resetUrl: url },
          });
        } catch (error: unknown) {
          // Nur die Meldung weiterreichen: Better Auth protokolliert das
          // Fehlerobjekt, und postgres-js haengt `query` und `parameters` an —
          // darin staende der Payload samt Reset-Link mit Token.
          throw new Error(
            `Versandauftrag fuer den Passwort-Reset konnte nicht angelegt werden: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      },
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
        "/request-password-reset": {
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
      // Ohne diese Angabe schaltet Better Auth die Ursprungspruefung unter
      // `NODE_ENV=test` selbst ab (`create-context.ts`: `isTest() ? true :
      // false`). In Produktion galt sie ohnehin; explizit gesetzt gilt sie
      // auch in den Tests, sodass ein `redirectTo` auf eine fremde Domain
      // dort tatsaechlich abgelehnt wird statt still durchzugehen.
      disableOriginCheck: false,
      // Nur dieser eine Header gilt als Adressquelle; `X-Forwarded-For`
      // wertet Better Auth damit nicht mehr selbst aus (siehe
      // `client-ip.ts`).
      ipAddress: {
        ipAddressHeaders: [CLIENT_IP_HEADER],
      },
    },
  });
}

export type DartsAuth = ReturnType<typeof createAuth>;
