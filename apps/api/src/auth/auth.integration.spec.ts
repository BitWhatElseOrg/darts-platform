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

import { createAuth } from "./auth.factory.js";

const environment = parseApplicationEnvironment(process.env);
const connection = createDatabaseConnection(environment.DATABASE_URL);
const auth = createAuth(connection.database, environment);
const email = `auth-test-${randomUUID()}@example.test`;
const uninvitedEmail = `auth-uninvited-${randomUUID()}@example.test`;
const systemInvitedEmail = `auth-system-${randomUUID()}@example.test`;
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
  await connection.database.insert(organizationInvitations).values({
    organizationId,
    email: systemInvitedEmail,
    role: "ADMIN",
    invitedByUserId: null,
    expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
  });
});

afterAll(async () => {
  await connection.database
    .delete(organizations)
    .where(eq(organizations.id, organizationId));
  await connection.database
    .delete(users)
    .where(inArray(users.email, [email, uninvitedEmail, systemInvitedEmail]));
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

  it("accepts registration against a system invitation without an inviter", async () => {
    const response = await auth.handler(
      new Request(`${environment.BETTER_AUTH_URL}/api/v1/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: systemInvitedEmail,
          password: "bootstrap-password-123",
          name: "System Invited Admin",
        }),
      }),
    );

    expect(response.status).toBe(200);
  });
});
