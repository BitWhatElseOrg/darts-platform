import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

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
const now = new Date("2026-08-31T12:00:00.000Z");
const input = {
  ownerEmail: "owner@example.ch",
  organizationName: "Dart Club",
  organizationSlug: "dart-club",
  timezone: "Europe/Zurich",
  locale: "de-CH",
} as const;

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

          await expect(
            bootstrapProductionOwner(database, input, now),
          ).rejects.toThrow(/BOOTSTRAP_STATE_INVALID/u);
          expect(
            await database.select().from(organizationInvitations),
          ).toHaveLength(1);
          expect(await database.select().from(auditEvents)).toHaveLength(1);
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
