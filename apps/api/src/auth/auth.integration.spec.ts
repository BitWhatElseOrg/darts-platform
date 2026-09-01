import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  createDatabaseConnection,
  organizationInvitations,
  organizations,
  users,
} from "@darts-platform/database";
import { createInvitationSchema } from "@darts-platform/schemas";

import { createAuth } from "./auth.factory.js";
import {
  INVITATION_CLAIM_HEADER,
  generateInvitationClaimToken,
  hashInvitationClaimToken,
} from "./invitation-claim.js";
import { AuthService } from "./auth.service.js";
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
const unprovenEmail = `auth-unproven-${randomUUID()}@example.test`;
const uninvitedEmail = `auth-uninvited-${randomUUID()}@example.test`;
const inviterId = randomUUID();
const organizationId = randomUUID();
const invitationClaimToken = generateInvitationClaimToken();
const unprovenClaimToken = generateInvitationClaimToken();

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
    claimTokenHash: hashInvitationClaimToken(invitationClaimToken),
    invitedByUserId: inviterId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
  });
  await connection.database.insert(organizationInvitations).values({
    organizationId,
    email: unprovenEmail,
    role: "OWNER",
    claimTokenHash: hashInvitationClaimToken(unprovenClaimToken),
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
    .where(inArray(users.email, [email, unprovenEmail, uninvitedEmail]));
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

  it("rejects an invited email without possession of its invitation claim", async () => {
    const response = await auth.handler(
      new Request(`${environment.BETTER_AUTH_URL}/api/v1/auth/sign-up/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: environment.WEB_ORIGIN,
        },
        body: JSON.stringify({
          name: "Invitation Claim Attacker",
          email: unprovenEmail,
          password: "IntegrationTest123!",
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
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
          [INVITATION_CLAIM_HEADER]: invitationClaimToken,
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
      const ownerEmail = `production-owner-${randomUUID()}@example.test`;
      const bootstrapInput = {
        ownerEmail,
        invitationClaimToken: generateInvitationClaimToken(),
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
        const authService = new AuthService(
          databaseService,
          isolatedEnvironment,
        );
        const repository = new OrganizationsRepository(databaseService);
        const organizationsService = new OrganizationsService(
          repository,
          new OrganizationAccessService(repository),
        );
        const bootstrap = await bootstrapProductionOwner(
          temporary.connection.database,
          bootstrapInput,
        );
        const signUpResponse = await authService.auth.handler(
          new Request(
            `${isolatedEnvironment.BETTER_AUTH_URL}/api/v1/auth/sign-up/email`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                origin: isolatedEnvironment.WEB_ORIGIN,
                [INVITATION_CLAIM_HEADER]: bootstrapInput.invitationClaimToken,
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
        const setCookie = signUpResponse.headers.get("set-cookie");
        expect(setCookie).toContain("better-auth.session_token=");
        const sessionCookie = setCookie?.split(";", 1)[0];
        if (sessionCookie === undefined) {
          throw new Error("Better Auth did not return an owner session cookie.");
        }
        const authContext: AuthContext | null = await authService.getSession({
          cookie: sessionCookie,
        });
        expect(authContext).toMatchObject({
          user: {
            email: bootstrapInput.ownerEmail,
            name: "Production Owner",
          },
          session: {
            id: expect.any(String),
            expiresAt: expect.any(Date),
          },
        });
        if (authContext === null) {
          throw new Error("Better Auth did not authenticate the owner cookie.");
        }

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
          data: { claimToken: bootstrapInput.invitationClaimToken },
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
