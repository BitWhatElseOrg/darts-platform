import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { createDatabaseConnection, users } from "@darts-platform/database";

import { createAuth } from "./auth.factory.js";

const environment = parseApplicationEnvironment(process.env);
const connection = createDatabaseConnection(environment.DATABASE_URL);
const auth = createAuth(connection.database, environment);
const email = `auth-test-${randomUUID()}@example.test`;

afterAll(async () => {
  await connection.database.delete(users).where(eq(users.email, email));
  await connection.close();
});

describe("Better Auth integration", () => {
  it("creates a user, issues a session cookie, and resolves the session", async () => {
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
});
