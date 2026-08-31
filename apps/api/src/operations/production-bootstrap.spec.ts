import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import {
  accounts,
  auditEvents,
  memberships,
  organizationInvitations,
  organizations,
  sessions,
  users,
  type Database,
} from "@darts-platform/database";

import {
  PRODUCTION_BOOTSTRAP_USER_EMAIL,
  assertProductionBootstrapAllowed,
  bootstrapProductionOwner,
  parseProductionBootstrapInput,
} from "./production-bootstrap.js";
import { createTemporaryDatabase } from "../testing/temporary-database.js";

const testDatabaseUrl = process.env.DATABASE_URL;
const apiRoot = fileURLToPath(new URL("../../", import.meta.url));
const compiledBootstrapCli = fileURLToPath(
  new URL("../../dist/operations/bootstrap-production.js", import.meta.url),
);
const pnpmExecutable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const now = new Date("2026-08-31T12:00:00.000Z");
const input = {
  ownerEmail: "owner@example.ch",
  organizationName: "Dart Club",
  organizationSlug: "dart-club",
  timezone: "Europe/Zurich",
  locale: "de-CH",
} as const;

interface ChildProcessResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

async function runChildProcess(input: {
  readonly command: string;
  readonly arguments: readonly string[];
  readonly environment: NodeJS.ProcessEnv;
}): Promise<ChildProcessResult> {
  const child = spawn(input.command, input.arguments, {
    cwd: apiRoot,
    env: input.environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  return { exitCode, stdout, stderr };
}

async function runBootstrapCli(
  environment: NodeJS.ProcessEnv,
): Promise<ChildProcessResult> {
  return runChildProcess({
    command: process.execPath,
    arguments: [compiledBootstrapCli],
    environment,
  });
}

beforeAll(async () => {
  const build = await runChildProcess({
    command: pnpmExecutable,
    arguments: ["run", "build"],
    environment: process.env,
  });

  if (build.exitCode !== 0) {
    throw new Error(
      `API build failed before CLI contract tests.\n${build.stdout}${build.stderr}`,
    );
  }
}, 120_000);

async function withTemporaryDatabase<T>(
  run: (database: Database) => Promise<T>,
): Promise<T> {
  if (testDatabaseUrl === undefined || testDatabaseUrl.length === 0) {
    throw new Error("DATABASE_URL is required for bootstrap integration tests.");
  }

  const temporary = await createTemporaryDatabase(testDatabaseUrl);
  try {
    return await run(temporary.connection.database);
  } finally {
    await temporary.cleanup();
  }
}

async function insertUser(
  database: Database,
  email: string,
  displayName: string,
): Promise<{ readonly id: string }> {
  const [user] = await database
    .insert(users)
    .values({ email, displayName })
    .returning({ id: users.id });

  if (user === undefined) {
    throw new Error("Test user insert did not return a row.");
  }
  return user;
}

async function insertOrganization(
  database: Database,
  values: {
    readonly name: string;
    readonly slug: string;
    readonly timezone?: string;
    readonly locale?: string;
  },
): Promise<{ readonly id: string }> {
  const [organization] = await database
    .insert(organizations)
    .values({
      timezone: "Europe/Zurich",
      locale: "de-CH",
      ...values,
    })
    .returning({ id: organizations.id });

  if (organization === undefined) {
    throw new Error("Test organization insert did not return a row.");
  }
  return organization;
}

interface CompletedBootstrapFixture {
  readonly organizationId: string;
  readonly ownerUserId: string;
  readonly systemUserId: string;
}

async function createCompletedBootstrapFixture(
  database: Database,
  options: { readonly withExpiredHistory?: boolean } = {},
): Promise<CompletedBootstrapFixture> {
  const bootstrap = options.withExpiredHistory
    ? await (async () => {
        const staleTime = new Date(now.getTime() - 49 * 60 * 60 * 1_000);
        await bootstrapProductionOwner(database, input, staleTime);
        return bootstrapProductionOwner(database, input, now);
      })()
    : await bootstrapProductionOwner(database, input, now);
  const owner = await insertUser(
    database,
    input.ownerEmail,
    "Production Owner",
  );
  await database
    .update(organizationInvitations)
    .set({ status: "ACCEPTED", updatedAt: now })
    .where(
      and(
        eq(organizationInvitations.email, input.ownerEmail),
        eq(organizationInvitations.status, "PENDING"),
      ),
    );
  await database.insert(memberships).values({
    organizationId: bootstrap.organizationId,
    userId: owner.id,
    role: "OWNER",
    status: "ACTIVE",
  });
  const [systemUser] = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, PRODUCTION_BOOTSTRAP_USER_EMAIL));
  if (systemUser === undefined) {
    throw new Error("Bootstrap system user is missing.");
  }

  return {
    organizationId: bootstrap.organizationId,
    ownerUserId: owner.id,
    systemUserId: systemUser.id,
  };
}

async function readBootstrapControlState(database: Database) {
  return {
    users: await database.select().from(users).orderBy(users.id),
    organizations: await database
      .select()
      .from(organizations)
      .orderBy(organizations.id),
    memberships: await database
      .select()
      .from(memberships)
      .orderBy(memberships.id),
    invitations: await database
      .select()
      .from(organizationInvitations)
      .orderBy(organizationInvitations.id),
    audits: await database.select().from(auditEvents).orderBy(auditEvents.id),
    accounts: await database.select().from(accounts).orderBy(accounts.id),
    sessions: await database.select().from(sessions).orderBy(sessions.id),
  };
}

async function expectBootstrapStateInvalidWithoutWrites(
  database: Database,
): Promise<void> {
  const before = await readBootstrapControlState(database);
  await expect(
    bootstrapProductionOwner(database, input, now),
  ).rejects.toThrow(/BOOTSTRAP_STATE_INVALID/u);
  expect(await readBootstrapControlState(database)).toEqual(before);
}

const completedStateAnomalies = [
  {
    name: "an extra user",
    mutate: async (database: Database): Promise<void> => {
      await insertUser(database, "unexpected@example.ch", "Unexpected User");
    },
  },
  {
    name: "an extra organization",
    mutate: async (database: Database): Promise<void> => {
      await insertOrganization(database, {
        name: "Unexpected Organization",
        slug: "unexpected-organization",
      });
    },
  },
  {
    name: "an additional human membership",
    mutate: async (
      database: Database,
      fixture: CompletedBootstrapFixture,
    ): Promise<void> => {
      const extraUser = await insertUser(
        database,
        "additional-member@example.ch",
        "Additional Member",
      );
      await database.insert(memberships).values({
        organizationId: fixture.organizationId,
        userId: extraUser.id,
        role: "MEMBER",
        status: "SUSPENDED",
      });
    },
  },
  {
    name: "a foreign owner membership",
    mutate: async (
      database: Database,
      fixture: CompletedBootstrapFixture,
    ): Promise<void> => {
      const foreignOrganization = await insertOrganization(database, {
        name: "Foreign Organization",
        slug: "foreign-organization",
      });
      await database.insert(memberships).values({
        organizationId: foreignOrganization.id,
        userId: fixture.ownerUserId,
        role: "OWNER",
        status: "ACTIVE",
      });
    },
  },
  {
    name: "duplicate accepted invitations",
    mutate: async (
      database: Database,
      fixture: CompletedBootstrapFixture,
    ): Promise<void> => {
      await database.insert(organizationInvitations).values({
        organizationId: fixture.organizationId,
        email: input.ownerEmail,
        role: "OWNER",
        status: "ACCEPTED",
        invitedByUserId: fixture.systemUserId,
        expiresAt: new Date("2026-09-03T12:00:00.000Z"),
      });
    },
  },
  {
    name: "a cancelled invitation",
    mutate: async (database: Database): Promise<void> => {
      await database
        .update(organizationInvitations)
        .set({ status: "CANCELLED", updatedAt: now })
        .where(eq(organizationInvitations.status, "ACCEPTED"));
    },
  },
  {
    name: "mismatched invitation lineage",
    mutate: async (
      database: Database,
      fixture: CompletedBootstrapFixture,
    ): Promise<void> => {
      await database
        .update(organizationInvitations)
        .set({ invitedByUserId: fixture.ownerUserId, updatedAt: now })
        .where(eq(organizationInvitations.status, "ACCEPTED"));
    },
  },
] as const;

describe("production bootstrap guard", () => {
  it.each([
    { nodeEnv: "development", allowProduction: true },
    { nodeEnv: "production", allowProduction: false },
  ])("rejects $nodeEnv / $allowProduction", (input) => {
    expect(() => assertProductionBootstrapAllowed(input)).toThrow();
  });

  it("allows only an explicitly approved production invocation", () => {
    expect(() =>
      assertProductionBootstrapAllowed({
        nodeEnv: "production",
        allowProduction: true,
      }),
    ).not.toThrow();
  });

  it.each([
    { nodeEnv: "development", allowProduction: "true" },
    { nodeEnv: "production", allowProduction: "false" },
  ])(
    "CLI rejects $nodeEnv / $allowProduction before environment parsing without leaking secrets",
    { timeout: 30_000 },
    async ({ nodeEnv, allowProduction }) => {
      const sentinelDatabaseUrl =
        "postgresql://sentinel-user:sentinel-password@sentinel.invalid/sentinel-db";
      const sentinelAuthSecret =
        "SENTINEL_AUTH_SECRET_MUST_NEVER_BE_PRINTED_123456789";
      const result = await runBootstrapCli({
        ...process.env,
        NODE_ENV: nodeEnv,
        ALLOW_PRODUCTION_BOOTSTRAP: allowProduction,
        DATABASE_URL: sentinelDatabaseUrl,
        BETTER_AUTH_SECRET: sentinelAuthSecret,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toEqual({
        event: "production_bootstrap_failed",
        code: "BOOTSTRAP_NOT_ALLOWED",
        message:
          "Production bootstrap requires NODE_ENV=production and ALLOW_PRODUCTION_BOOTSTRAP=true.",
      });
      expect(`${result.stdout}${result.stderr}`).not.toContain(
        sentinelDatabaseUrl,
      );
      expect(`${result.stdout}${result.stderr}`).not.toContain(
        sentinelAuthSecret,
      );
      expect(`${result.stdout}${result.stderr}`).not.toContain(
        "sentinel-password",
      );
      expect(result.stderr).not.toContain("Error:");
      expect(result.stderr.trim().split("\n")).toHaveLength(1);
    },
  );

  it(
    "CLI prints one safe completion event for a successful bootstrap",
    { timeout: 120_000 },
    async () => {
      if (testDatabaseUrl === undefined) {
        throw new Error("DATABASE_URL is required for the CLI integration test.");
      }
      const temporary = await createTemporaryDatabase(testDatabaseUrl);
      const sentinelAuthSecret =
        "SENTINEL_AUTH_SECRET_MUST_NEVER_BE_PRINTED_123456789";

      try {
        const result = await runBootstrapCli({
          ...process.env,
          NODE_ENV: "production",
          ALLOW_PRODUCTION_BOOTSTRAP: "true",
          DATABASE_URL: temporary.databaseUrl,
          BETTER_AUTH_SECRET: sentinelAuthSecret,
          BOOTSTRAP_OWNER_EMAIL: input.ownerEmail,
          BOOTSTRAP_ORGANIZATION_NAME: input.organizationName,
          BOOTSTRAP_ORGANIZATION_SLUG: input.organizationSlug,
          BOOTSTRAP_TIMEZONE: input.timezone,
          BOOTSTRAP_LOCALE: input.locale,
        });

        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout.trim().split("\n")).toHaveLength(1);
        const event: unknown = JSON.parse(result.stdout);
        expect(event).toMatchObject({
          event: "production_bootstrap_completed",
          status: "created",
          organizationSlug: input.organizationSlug,
          ownerEmail: input.ownerEmail,
        });
        expect(
          Object.keys(event as Readonly<Record<string, unknown>>).sort(),
        ).toEqual(
          [
            "event",
            "expiresAt",
            "organizationId",
            "organizationSlug",
            "ownerEmail",
            "status",
          ].sort(),
        );
        expect(result.stdout).not.toContain(temporary.databaseUrl);
        expect(result.stdout).not.toContain(sentinelAuthSecret);
      } finally {
        await temporary.cleanup();
      }
    },
  );
});

describe("production bootstrap input", () => {
  it("normalizes the owner and organization inputs", () => {
    expect(
      parseProductionBootstrapInput({
        BOOTSTRAP_OWNER_EMAIL: " OWNER@EXAMPLE.CH ",
        BOOTSTRAP_ORGANIZATION_NAME: " Dart Club ",
        BOOTSTRAP_ORGANIZATION_SLUG: "dart-club",
      }),
    ).toEqual({
      ownerEmail: "owner@example.ch",
      organizationName: "Dart Club",
      organizationSlug: "dart-club",
      timezone: "Europe/Zurich",
      locale: "de-CH",
    });
  });

  it.each([
    {
      BOOTSTRAP_OWNER_EMAIL: "not-an-email",
      BOOTSTRAP_ORGANIZATION_NAME: "Dart Club",
      BOOTSTRAP_ORGANIZATION_SLUG: "dart-club",
    },
    {
      BOOTSTRAP_OWNER_EMAIL: "owner@example.ch",
      BOOTSTRAP_ORGANIZATION_NAME: "D",
      BOOTSTRAP_ORGANIZATION_SLUG: "dart-club",
    },
    {
      BOOTSTRAP_OWNER_EMAIL: "owner@example.ch",
      BOOTSTRAP_ORGANIZATION_NAME: "Dart Club",
      BOOTSTRAP_ORGANIZATION_SLUG: "Dart Club",
    },
    {
      BOOTSTRAP_OWNER_EMAIL: PRODUCTION_BOOTSTRAP_USER_EMAIL,
      BOOTSTRAP_ORGANIZATION_NAME: "Dart Club",
      BOOTSTRAP_ORGANIZATION_SLUG: "dart-club",
    },
  ])("rejects invalid owner or organization fields", (environment) => {
    expect(() => parseProductionBootstrapInput(environment)).toThrow();
  });
});

describe.skipIf(testDatabaseUrl === undefined)(
  "production owner bootstrap transaction",
  () => {
    it(
      "rejects the reserved system-principal email without mutations",
      { timeout: 120_000 },
      async () => {
        await withTemporaryDatabase(async (database) => {
          await expect(
            bootstrapProductionOwner(
              database,
              { ...input, ownerEmail: PRODUCTION_BOOTSTRAP_USER_EMAIL },
              now,
            ),
          ).rejects.toThrow(/BOOTSTRAP_STATE_INVALID/u);
          expect(await database.select().from(users)).toHaveLength(0);
          expect(await database.select().from(organizations)).toHaveLength(0);
          expect(
            await database.select().from(organizationInvitations),
          ).toHaveLength(0);
        });
      },
    );

    it(
      "creates one non-login system principal, organization, invitation, and audit, then reuses them",
      { timeout: 120_000 },
      async () => {
        await withTemporaryDatabase(async (database) => {
          const first = await bootstrapProductionOwner(database, input, now);
          const second = await bootstrapProductionOwner(database, input, now);

          expect(first).toMatchObject({
            status: "created",
            organizationSlug: input.organizationSlug,
            ownerEmail: input.ownerEmail,
            expiresAt: new Date("2026-09-02T12:00:00.000Z"),
          });
          expect(second).toEqual({ ...first, status: "pending" });
          expect(await database.select().from(organizations)).toHaveLength(1);
          const invitationRows = await database
            .select()
            .from(organizationInvitations);
          const auditRows = await database.select().from(auditEvents);
          expect(invitationRows).toHaveLength(1);
          expect(auditRows).toHaveLength(1);

          const systemUsers = await database
            .select()
            .from(users)
            .where(eq(users.email, PRODUCTION_BOOTSTRAP_USER_EMAIL));
          expect(systemUsers).toHaveLength(1);
          expect(systemUsers[0]).toMatchObject({
            email: PRODUCTION_BOOTSTRAP_USER_EMAIL,
            displayName: "Dartbase Production Bootstrap",
            emailVerified: false,
            image: null,
          });
          const systemUserId = systemUsers[0]?.id;
          if (systemUserId === undefined) {
            throw new Error("Bootstrap system user is missing.");
          }
          expect(auditRows[0]).toMatchObject({
            organizationId: first.organizationId,
            actorUserId: systemUserId,
            action: "PRODUCTION_BOOTSTRAP_INVITATION_CREATED",
            entityType: "OrganizationInvitation",
            entityId: invitationRows[0]?.id,
            newValue: {
              email: input.ownerEmail,
              role: "OWNER",
              expiresAt: "2026-09-02T12:00:00.000Z",
            },
            ip: "127.0.0.1",
            userAgent: "production-bootstrap-cli",
          });
          expect(auditRows[0]?.correlationId).toMatch(
            /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u,
          );
          expect(
            await database
              .select()
              .from(accounts)
              .where(eq(accounts.userId, systemUserId)),
          ).toHaveLength(0);
          expect(
            await database
              .select()
              .from(sessions)
              .where(eq(sessions.userId, systemUserId)),
          ).toHaveLength(0);
          expect(
            await database
              .select()
              .from(memberships)
              .where(eq(memberships.userId, systemUserId)),
          ).toHaveLength(0);
        });
      },
    );

    it.each(["account", "session"] as const)(
      "rejects a system principal with an existing %s without writes",
      { timeout: 120_000 },
      async (credentialKind) => {
        await withTemporaryDatabase(async (database) => {
          await bootstrapProductionOwner(database, input, now);
          const [bootstrapUser] = await database
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, PRODUCTION_BOOTSTRAP_USER_EMAIL));
          if (bootstrapUser === undefined) {
            throw new Error("Bootstrap system user is missing.");
          }

          if (credentialKind === "account") {
            await database.insert(accounts).values({
              accountId: "bootstrap-system",
              providerId: "credential",
              issuer: "bootstrap-test",
              userId: bootstrapUser.id,
            });
          } else {
            await database.insert(sessions).values({
              expiresAt: new Date("2026-09-01T12:00:00.000Z"),
              token: "bootstrap-system-session",
              userId: bootstrapUser.id,
            });
          }

          await expectBootstrapStateInvalidWithoutWrites(database);
        });
      },
    );

    it(
      "rejects a foreign active membership without adding bootstrap rows",
      { timeout: 120_000 },
      async () => {
        await withTemporaryDatabase(async (database) => {
          const organization = await insertOrganization(database, {
            name: "Already Initialized",
            slug: "already-initialized",
          });
          const user = await insertUser(
            database,
            "existing@example.ch",
            "Existing User",
          );
          await database.insert(memberships).values({
            organizationId: organization.id,
            userId: user.id,
            role: "ADMIN",
            status: "ACTIVE",
          });

          await expect(
            bootstrapProductionOwner(database, input, now),
          ).rejects.toThrow(/BOOTSTRAP_ALREADY_INITIALIZED/u);
          expect(await database.select().from(organizations)).toHaveLength(1);
          expect(await database.select().from(users)).toHaveLength(1);
          expect(await database.select().from(memberships)).toHaveLength(1);
          expect(
            await database.select().from(organizationInvitations),
          ).toHaveLength(0);
          expect(await database.select().from(auditEvents)).toHaveLength(0);
        });
      },
    );

    it(
      "rejects a mismatched organization and rolls back every bootstrap mutation",
      { timeout: 120_000 },
      async () => {
        await withTemporaryDatabase(async (database) => {
          await insertOrganization(database, {
            name: "Wrong Organization",
            slug: input.organizationSlug,
          });

          await expect(
            bootstrapProductionOwner(database, input, now),
          ).rejects.toThrow(/BOOTSTRAP_STATE_INVALID/u);
          expect(await database.select().from(organizations)).toHaveLength(1);
          expect(await database.select().from(users)).toHaveLength(0);
          expect(
            await database.select().from(organizationInvitations),
          ).toHaveLength(0);
          expect(await database.select().from(auditEvents)).toHaveLength(0);
        });
      },
    );

    it(
      "expires and replaces an exact stale invitation, then safely reuses the renewal",
      { timeout: 120_000 },
      async () => {
        await withTemporaryDatabase(async (database) => {
          const staleTime = new Date(now.getTime() - 49 * 60 * 60 * 1_000);
          const initial = await bootstrapProductionOwner(
            database,
            input,
            staleTime,
          );
          const renewed = await bootstrapProductionOwner(database, input, now);
          const rerun = await bootstrapProductionOwner(database, input, now);

          expect(initial.status).toBe("created");
          expect(renewed).toMatchObject({
            status: "created",
            expiresAt: new Date("2026-09-02T12:00:00.000Z"),
          });
          expect(rerun).toEqual({ ...renewed, status: "pending" });
          const invitations = await database
            .select()
            .from(organizationInvitations);
          expect(
            invitations.filter((invitation) => invitation.status === "EXPIRED"),
          ).toHaveLength(1);
          expect(
            invitations.filter((invitation) => invitation.status === "PENDING"),
          ).toHaveLength(1);
          expect(await database.select().from(auditEvents)).toHaveLength(2);
        });
      },
    );

    it(
      "returns already-complete for the exact accepted owner without writes",
      { timeout: 120_000 },
      async () => {
        await withTemporaryDatabase(async (database) => {
          const bootstrap = await bootstrapProductionOwner(database, input, now);
          const owner = await insertUser(
            database,
            input.ownerEmail,
            "Production Owner",
          );
          await database
            .update(organizationInvitations)
            .set({ status: "ACCEPTED", updatedAt: now })
            .where(eq(organizationInvitations.email, input.ownerEmail));
          await database.insert(memberships).values({
            organizationId: bootstrap.organizationId,
            userId: owner.id,
            role: "OWNER",
            status: "ACTIVE",
          });
          const before = {
            users: await database.select().from(users),
            organizations: await database.select().from(organizations),
            memberships: await database.select().from(memberships),
            invitations: await database.select().from(organizationInvitations),
            audits: await database.select().from(auditEvents),
          };

          const result = await bootstrapProductionOwner(database, input, now);

          expect(result).toEqual({
            status: "already-complete",
            organizationId: bootstrap.organizationId,
            organizationSlug: input.organizationSlug,
            ownerEmail: input.ownerEmail,
            expiresAt: null,
          });
          expect({
            users: await database.select().from(users),
            organizations: await database.select().from(organizations),
            memberships: await database.select().from(memberships),
            invitations: await database.select().from(organizationInvitations),
            audits: await database.select().from(auditEvents),
          }).toEqual(before);
        });
      },
    );

    it.each(completedStateAnomalies)(
      "rejects completed state containing $name without writes",
      { timeout: 120_000 },
      async ({ mutate }) => {
        await withTemporaryDatabase(async (database) => {
          const fixture = await createCompletedBootstrapFixture(database);
          await mutate(database, fixture);
          await expectBootstrapStateInvalidWithoutWrites(database);
        });
      },
    );

    it(
      "accepts one exact accepted invitation plus exact expired history without writes",
      { timeout: 120_000 },
      async () => {
        await withTemporaryDatabase(async (database) => {
          const fixture = await createCompletedBootstrapFixture(database, {
            withExpiredHistory: true,
          });
          const before = await readBootstrapControlState(database);

          const result = await bootstrapProductionOwner(database, input, now);

          expect(result).toEqual({
            status: "already-complete",
            organizationId: fixture.organizationId,
            organizationSlug: input.organizationSlug,
            ownerEmail: input.ownerEmail,
            expiresAt: null,
          });
          expect(
            before.invitations
              .map((invitation) => invitation.status)
              .sort(),
          ).toEqual(["ACCEPTED", "EXPIRED"]);
          expect(await readBootstrapControlState(database)).toEqual(before);
        });
      },
    );

    it(
      "rejects completed state with only expired invitation history without writes",
      { timeout: 120_000 },
      async () => {
        await withTemporaryDatabase(async (database) => {
          await createCompletedBootstrapFixture(database);
          await database
            .update(organizationInvitations)
            .set({ status: "EXPIRED", updatedAt: now })
            .where(eq(organizationInvitations.status, "ACCEPTED"));

          await expectBootstrapStateInvalidWithoutWrites(database);
        });
      },
    );

    it(
      "rejects an owner membership while its bootstrap invitation is still pending",
      { timeout: 120_000 },
      async () => {
        await withTemporaryDatabase(async (database) => {
          const bootstrap = await bootstrapProductionOwner(database, input, now);
          const owner = await insertUser(
            database,
            input.ownerEmail,
            "Production Owner",
          );
          await database.insert(memberships).values({
            organizationId: bootstrap.organizationId,
            userId: owner.id,
            role: "OWNER",
            status: "ACTIVE",
          });

          await expectBootstrapStateInvalidWithoutWrites(database);
        });
      },
    );

    it.each(["ACCEPTED", "CANCELLED"] as const)(
      "rejects a %s invitation before membership completion",
      { timeout: 120_000 },
      async (status) => {
        await withTemporaryDatabase(async (database) => {
          await bootstrapProductionOwner(database, input, now);
          await database
            .update(organizationInvitations)
            .set({ status, updatedAt: now })
            .where(eq(organizationInvitations.email, input.ownerEmail));

          await expect(
            bootstrapProductionOwner(database, input, now),
          ).rejects.toThrow(/BOOTSTRAP_STATE_INVALID/u);
          expect(await database.select().from(auditEvents)).toHaveLength(1);
          expect(
            await database.select().from(organizationInvitations),
          ).toHaveLength(1);
        });
      },
    );

    it.each(["non-active-owner", "system-membership"] as const)(
      "rejects pre-completion %s without writes",
      { timeout: 120_000 },
      async (membershipKind) => {
        await withTemporaryDatabase(async (database) => {
          const bootstrap = await bootstrapProductionOwner(database, input, now);
          const userId =
            membershipKind === "non-active-owner"
              ? (
                  await insertUser(
                    database,
                    input.ownerEmail,
                    "Production Owner",
                  )
                ).id
              : (
                  await database
                    .select({ id: users.id })
                    .from(users)
                    .where(eq(users.email, PRODUCTION_BOOTSTRAP_USER_EMAIL))
                )[0]?.id;
          if (userId === undefined) {
            throw new Error("Membership test user is missing.");
          }
          await database.insert(memberships).values({
            organizationId: bootstrap.organizationId,
            userId,
            role: membershipKind === "non-active-owner" ? "OWNER" : "VIEWER",
            status: membershipKind === "non-active-owner" ? "SUSPENDED" : "INVITED",
          });

          await expectBootstrapStateInvalidWithoutWrites(database);
        });
      },
    );

    it(
      "rejects a pre-completion invitation with mismatched identity without writes",
      { timeout: 120_000 },
      async () => {
        await withTemporaryDatabase(async (database) => {
          await bootstrapProductionOwner(database, input, now);
          await database
            .update(organizationInvitations)
            .set({ role: "ADMIN", updatedAt: now })
            .where(eq(organizationInvitations.status, "PENDING"));

          await expectBootstrapStateInvalidWithoutWrites(database);
        });
      },
    );

    it(
      "rejects a pre-completion invitation with mismatched inviter lineage without writes",
      { timeout: 120_000 },
      async () => {
        await withTemporaryDatabase(async (database) => {
          await bootstrapProductionOwner(database, input, now);
          const owner = await insertUser(
            database,
            input.ownerEmail,
            "Production Owner",
          );
          await database
            .update(organizationInvitations)
            .set({ invitedByUserId: owner.id, updatedAt: now })
            .where(eq(organizationInvitations.status, "PENDING"));

          await expectBootstrapStateInvalidWithoutWrites(database);
        });
      },
    );

    it(
      "treats an invitation expiring exactly now as expired and replaces it atomically",
      { timeout: 120_000 },
      async () => {
        await withTemporaryDatabase(async (database) => {
          await bootstrapProductionOwner(database, input, now);
          const [expiringInvitation] = await database
            .select({ id: organizationInvitations.id })
            .from(organizationInvitations)
            .where(eq(organizationInvitations.status, "PENDING"));
          if (expiringInvitation === undefined) {
            throw new Error("Expiring invitation is missing.");
          }
          await database
            .update(organizationInvitations)
            .set({ expiresAt: now, updatedAt: now })
            .where(eq(organizationInvitations.id, expiringInvitation.id));

          const result = await bootstrapProductionOwner(database, input, now);

          expect(result).toMatchObject({
            status: "created",
            expiresAt: new Date("2026-09-02T12:00:00.000Z"),
          });
          const invitations = await database
            .select()
            .from(organizationInvitations);
          expect(
            invitations.filter((invitation) => invitation.status === "EXPIRED"),
          ).toHaveLength(1);
          expect(
            invitations.filter((invitation) => invitation.status === "PENDING"),
          ).toHaveLength(1);
          expect(await database.select().from(auditEvents)).toHaveLength(2);
        });
      },
    );

    it(
      "rejects multiple exact pending invitations without further writes",
      { timeout: 120_000 },
      async () => {
        await withTemporaryDatabase(async (database) => {
          const bootstrap = await bootstrapProductionOwner(database, input, now);
          const [bootstrapUser] = await database
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, PRODUCTION_BOOTSTRAP_USER_EMAIL));
          if (bootstrapUser === undefined) {
            throw new Error("Bootstrap system user is missing.");
          }
          await database.insert(organizationInvitations).values({
            organizationId: bootstrap.organizationId,
            email: input.ownerEmail,
            role: "OWNER",
            status: "PENDING",
            invitedByUserId: bootstrapUser.id,
            expiresAt: new Date("2026-09-03T12:00:00.000Z"),
          });

          await expect(
            bootstrapProductionOwner(database, input, now),
          ).rejects.toThrow(/BOOTSTRAP_STATE_INVALID/u);
          expect(
            await database.select().from(organizationInvitations),
          ).toHaveLength(2);
          expect(await database.select().from(auditEvents)).toHaveLength(1);
        });
      },
    );

    it(
      "serializes concurrent calls into one effective pending invitation",
      { timeout: 120_000 },
      async () => {
        await withTemporaryDatabase(async (database) => {
          const results = await Promise.all([
            bootstrapProductionOwner(database, input, now),
            bootstrapProductionOwner(database, input, now),
          ]);

          expect(results.map((result) => result.status).sort()).toEqual([
            "created",
            "pending",
          ]);
          const invitations = await database
            .select()
            .from(organizationInvitations);
          expect(invitations).toHaveLength(1);
          expect(invitations[0]).toMatchObject({
            email: input.ownerEmail,
            role: "OWNER",
            status: "PENDING",
          });
          expect(await database.select().from(auditEvents)).toHaveLength(1);
        });
      },
    );
  },
);
