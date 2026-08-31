import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  createDatabaseConnection,
  organizationInvitations,
  organizations,
  sessions,
  users,
} from "@darts-platform/database";
import { createInvitationSchema } from "@darts-platform/schemas";

import { createAuth } from "./auth.factory.js";
import type { AuthContext } from "./auth.types.js";
import type { AuditContext } from "../common/audit-context.js";
import { DatabaseService } from "../database/database.service.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { OrganizationsRepository } from "../organizations/organizations.repository.js";
import { OrganizationsService } from "../organizations/organizations.service.js";
import { bootstrapProductionOwner } from "../operations/production-bootstrap.js";
import { createTemporaryDatabase } from "../testing/temporary-database.js";

const environment = parseApplicationEnvironment(process.env);
const connection = createDatabaseConnection(environment.DATABASE_URL);
const auth = createAuth(connection.database, environment);
const email = `auth-test-${randomUUID()}@example.test`;
const uninvitedEmail = `auth-uninvited-${randomUUID()}@example.test`;
const inviterId = randomUUID();
const organizationId = randomUUID();

beforeAll(async () => {
  await connection.database.insert(users).values({
    id: inviterId,
    email: `auth-inviter-${inviterId}@example.test`,
    displayName: "Auth Inviter",
  });
  await connection.database.insert(organizations).values({
    id: organizationId,
    name: "Auth Invitation Organization",
    slug: `auth-invitation-${organizationId}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });
  await connection.database.insert(organizationInvitations).values({
    organizationId,
    email,
    role: "MEMBER",
    invitedByUserId: inviterId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
  });
});

afterAll(async () => {
  await connection.database
    .delete(organizations)
    .where(eq(organizations.id, organizationId));
  await connection.database
    .delete(users)
    .where(inArray(users.email, [email, uninvitedEmail]));
  await connection.database.delete(users).where(eq(users.id, inviterId));
  await connection.close();
});

describe("Better Auth integration", () => {
  it("rejects registration without a valid invitation", async () => {
    const response = await auth.handler(
      new Request(`${environment.BETTER_AUTH_URL}/api/v1/auth/sign-up/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: environment.WEB_ORIGIN,
        },
        body: JSON.stringify({
          name: "Uninvited User",
          email: uninvitedEmail,
          password: "IntegrationTest123!",
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      message: "Registration requires a valid invitation.",
    });
  });

  it("creates an invited user, issues a session cookie, and resolves the session", async () => {
    const signUpResponse = await auth.handler(
      new Request(`${environment.BETTER_AUTH_URL}/api/v1/auth/sign-up/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: environment.WEB_ORIGIN,
        },
        body: JSON.stringify({
          name: "Auth Integration",
          email,
          password: "IntegrationTest123!",
        }),
      }),
    );

    expect(signUpResponse.status).toBe(200);
    const setCookie = signUpResponse.headers.get("set-cookie");
    expect(setCookie).toContain("better-auth.session_token=");

    const sessionResponse = await auth.handler(
      new Request(`${environment.BETTER_AUTH_URL}/api/v1/auth/get-session`, {
        headers: {
          cookie: setCookie?.split(";", 1)[0] ?? "",
          origin: environment.WEB_ORIGIN,
        },
      }),
    );
    const session: unknown = await sessionResponse.json();

    expect(sessionResponse.status).toBe(200);
    expect(session).toMatchObject({
      user: { email, name: "Auth Integration" },
    });
  });

  it(
    "onboards the production bootstrap owner through registration and invitation acceptance",
    { timeout: 120_000 },
    async () => {
      const temporary = await createTemporaryDatabase(environment.DATABASE_URL);
      const isolatedEnvironment = {
        ...environment,
        DATABASE_URL: temporary.databaseUrl,
      };
      const isolatedAuth = createAuth(
        temporary.connection.database,
        isolatedEnvironment,
      );
      const ownerEmail = `production-owner-${randomUUID()}@example.test`;
      const bootstrapInput = {
        ownerEmail,
        organizationName: "Production Darts Club",
        organizationSlug: `production-darts-${randomUUID()}`,
        timezone: "Europe/Zurich",
        locale: "de-CH",
      } as const;
      const audit: AuditContext = {
        ip: "127.0.0.1",
        userAgent: "production-bootstrap-acceptance-test",
        correlationId: randomUUID(),
      };
      let databaseService: DatabaseService | undefined;

      try {
        databaseService = new DatabaseService(isolatedEnvironment);
        const repository = new OrganizationsRepository(databaseService);
        const organizationsService = new OrganizationsService(
          repository,
          new OrganizationAccessService(repository),
        );
        const bootstrap = await bootstrapProductionOwner(
          temporary.connection.database,
          bootstrapInput,
        );
        const signUpResponse = await isolatedAuth.handler(
          new Request(
            `${isolatedEnvironment.BETTER_AUTH_URL}/api/v1/auth/sign-up/email`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                origin: isolatedEnvironment.WEB_ORIGIN,
              },
              body: JSON.stringify({
                name: "Production Owner",
                email: bootstrapInput.ownerEmail,
                password: "IntegrationTest123!",
              }),
            },
          ),
        );

        expect(signUpResponse.status).toBe(200);
        const [registeredUser] = await temporary.connection.database
          .select({
            id: users.id,
            email: users.email,
            name: users.displayName,
          })
          .from(users)
          .where(eq(users.email, bootstrapInput.ownerEmail));
        if (registeredUser === undefined) {
          throw new Error("Better Auth did not create the production owner.");
        }
        const [registeredSession] = await temporary.connection.database
          .select({ id: sessions.id, expiresAt: sessions.expiresAt })
          .from(sessions)
          .where(eq(sessions.userId, registeredUser.id));
        if (registeredSession === undefined) {
          throw new Error("Better Auth did not create an owner session.");
        }
        const authContext: AuthContext = {
          user: registeredUser,
          session: registeredSession,
        };

        const pending = await organizationsService.listInvitations(authContext);
        expect(pending).toHaveLength(1);
        expect(pending[0]).toMatchObject({
          role: "OWNER",
          email: bootstrapInput.ownerEmail,
        });
        const invitation = pending[0];
        if (invitation === undefined) {
          throw new Error("The production owner invitation is missing.");
        }

        await organizationsService.acceptInvitation({
          invitationId: invitation.id,
          auth: authContext,
          audit,
        });

        expect(
          await repository.getActiveMembership({
            organizationId: bootstrap.organizationId,
            userId: authContext.user.id,
          }),
        ).toEqual({ role: "OWNER" });
        expect(
          createInvitationSchema.safeParse({
            email: bootstrapInput.ownerEmail,
            role: "OWNER",
          }).success,
        ).toBe(false);
      } finally {
        try {
          await databaseService?.onApplicationShutdown();
        } finally {
          await temporary.cleanup();
        }
      }
    },
  );
});
