import { afterAll, afterEach, describe, expect, it } from "vitest";
import { and, eq, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  auditEvents,
  createDatabaseConnection,
  organizationInvitations,
  organizations,
} from "@darts-platform/database";
import { bootstrapOrganizationSchema } from "@darts-platform/schemas";

import {
  assertNoExistingOrganization,
  BOOTSTRAP_ADVISORY_LOCK_KEY,
  createBootstrapOrganization,
  OrganizationAlreadyExistsError,
} from "./bootstrap-organization.service.js";

const environment = parseApplicationEnvironment(process.env);
const connection = createDatabaseConnection(environment.DATABASE_URL);
const createdOrganizationIds: string[] = [];

afterEach(async () => {
  for (const id of createdOrganizationIds.splice(0)) {
    await connection.database.delete(organizations).where(eq(organizations.id, id));
  }
});

afterAll(async () => {
  await connection.close();
});

describe("createBootstrapOrganization", () => {
  it("creates organization, admin invitation and audit event in one go", async () => {
    const slug = `bootstrap-${randomUUID()}`;
    const email = `bootstrap-${randomUUID()}@example.test`;

    // enforceExclusivity: false — this suite runs against a shared database
    // that already contains organizations from other suites; the default
    // (safe) path would correctly refuse here, which is not what this test
    // is checking. The race-safe default is covered separately below.
    const result = await createBootstrapOrganization(
      connection.database,
      {
        name: "Bootstrap Test Organization",
        slug,
        email,
        timezone: "Europe/Zurich",
        locale: "de-CH",
        expiresInDays: 7,
      },
      { enforceExclusivity: false },
    );
    createdOrganizationIds.push(result.organizationId);

    expect(result.slug).toBe(slug);
    expect(result.email).toBe(email);
    expect(result.role).toBe("ADMIN");

    const [invitation] = await connection.database
      .select()
      .from(organizationInvitations)
      .where(eq(organizationInvitations.id, result.invitationId));

    expect(invitation?.invitedByUserId).toBeNull();
    expect(invitation?.status).toBe("PENDING");
    expect(invitation?.role).toBe("ADMIN");
    expect(invitation?.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const [audit] = await connection.database
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, result.organizationId),
          eq(auditEvents.action, "ORGANIZATION_BOOTSTRAPPED"),
        ),
      );

    expect(audit).toBeDefined();
    expect(audit?.entityType).toBe("Organization");
    expect(audit?.actorUserId).toBeNull();
  });

  it("normalises the invited email and applies schema defaults", async () => {
    const slug = `bootstrap-${randomUUID()}`;
    const local = `bootstrap-${randomUUID()}`;

    const parsed = bootstrapOrganizationSchema.parse({
      name: "Bootstrap Case Organization",
      slug,
      email: `${local}@example.test`.toUpperCase(),
    });

    // enforceExclusivity: false — same reason as the test above.
    const result = await createBootstrapOrganization(
      connection.database,
      parsed,
      { enforceExclusivity: false },
    );
    createdOrganizationIds.push(result.organizationId);

    expect(result.email).toBe(`${local}@example.test`.toLowerCase());

    const [organization] = await connection.database
      .select()
      .from(organizations)
      .where(eq(organizations.id, result.organizationId));

    expect(organization?.timezone).toBe("Europe/Zurich");
    expect(organization?.locale).toBe("de-CH");
  });
});

describe("createBootstrapOrganization race protection (enforceExclusivity)", () => {
  // NOTE on coverage: this test seeds a sentinel organization before racing,
  // so both concurrent attempts see count > 0 as soon as they check — a
  // plain, lock-free count check would refuse here too. It does NOT prove
  // that the advisory lock itself is what prevents the race in the harder
  // case (two attempts starting from zero organizations, exactly one must
  // win). That from-empty case cannot be exercised here: this suite runs
  // against a shared database that other suites also write to and is never
  // actually empty, and deleting their rows to force an empty table is not
  // an option. What this test does verify: with an organization already
  // present, concurrent enforceExclusivity attempts are both rejected and
  // neither inserts a row. The test below this one proves the lock itself
  // is taken, independent of how many organizations already exist.
  it("rejects concurrent attempts when an organization already exists, inserting neither", async () => {
    const sentinel = await createBootstrapOrganization(
      connection.database,
      {
        name: "Sentinel Organization",
        slug: `bootstrap-sentinel-${randomUUID()}`,
        email: `bootstrap-${randomUUID()}@example.test`,
        timezone: "Europe/Zurich",
        locale: "de-CH",
        expiresInDays: 7,
      },
      { enforceExclusivity: false },
    );
    createdOrganizationIds.push(sentinel.organizationId);

    const raceSlugA = `bootstrap-race-a-${randomUUID()}`;
    const raceSlugB = `bootstrap-race-b-${randomUUID()}`;

    const [resultA, resultB] = await Promise.allSettled([
      createBootstrapOrganization(
        connection.database,
        {
          name: "Race Attempt A",
          slug: raceSlugA,
          email: `bootstrap-${randomUUID()}@example.test`,
          timezone: "Europe/Zurich",
          locale: "de-CH",
          expiresInDays: 7,
        },
        { enforceExclusivity: true },
      ),
      createBootstrapOrganization(
        connection.database,
        {
          name: "Race Attempt B",
          slug: raceSlugB,
          email: `bootstrap-${randomUUID()}@example.test`,
          timezone: "Europe/Zurich",
          locale: "de-CH",
          expiresInDays: 7,
        },
        { enforceExclusivity: true },
      ),
    ]);

    expect(resultA.status).toBe("rejected");
    expect(resultB.status).toBe("rejected");
    if (resultA.status === "rejected") {
      expect(resultA.reason).toBeInstanceOf(OrganizationAlreadyExistsError);
    }
    if (resultB.status === "rejected") {
      expect(resultB.reason).toBeInstanceOf(OrganizationAlreadyExistsError);
    }

    const raceRows = await connection.database
      .select()
      .from(organizations)
      .where(
        or(
          eq(organizations.slug, raceSlugA),
          eq(organizations.slug, raceSlugB),
        ),
      );

    expect(raceRows).toHaveLength(0);
  });

  // This test proves the lock mechanism itself, independent of the coverage
  // gap noted above. A first session takes BOOTSTRAP_ADVISORY_LOCK_KEY by
  // hand and holds it open. A second, genuinely separate session (its own
  // postgres connection, not just a concurrent call on the same pool) has
  // its Postgres `lock_timeout` set to 200ms and then calls the real
  // createBootstrapOrganization with enforceExclusivity: true. If that
  // function did not take this exact advisory lock, the call would not
  // contend with the held lock at all and would proceed straight to the
  // count check. Because it does contend, Postgres itself cancels the
  // waiting statement once 200ms of waiting elapses, deterministically —
  // this is a server-enforced timeout, not a client-side race on wall-clock
  // timing, so it is not flaky under load. Removing the pg_advisory_xact_lock
  // call from the implementation would make this test hang and then fail
  // with a different error (or succeed outright), not silently stay green.
  it("blocks a concurrent enforceExclusivity call on the exact advisory lock it takes internally", async () => {
    let markHolderReady: () => void = () => {};
    const holderHasLock = new Promise<void>((resolve) => {
      markHolderReady = resolve;
    });
    let requestRelease: () => void = () => {};
    const releaseRequested = new Promise<void>((resolve) => {
      requestRelease = resolve;
    });

    const holderTransaction = connection.database.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${BOOTSTRAP_ADVISORY_LOCK_KEY}::bigint)`,
      );
      markHolderReady();
      await releaseRequested;
    });

    await holderHasLock;

    const contenderUrl = new URL(environment.DATABASE_URL);
    contenderUrl.searchParams.set("lock_timeout", "200");
    const contender = createDatabaseConnection(contenderUrl.toString());

    try {
      // drizzle wraps the underlying postgres error in a DrizzleQueryError
      // whose own .message is a generic "Failed query: ..."; the specific
      // "canceling statement due to lock timeout" (Postgres code 55P03)
      // lives on .cause, which is what actually proves Postgres cancelled
      // the statement because it was waiting on the held lock.
      await expect(
        createBootstrapOrganization(
          contender.database,
          {
            name: "Should Never Be Created",
            slug: `bootstrap-lock-${randomUUID()}`,
            email: `bootstrap-${randomUUID()}@example.test`,
            timezone: "Europe/Zurich",
            locale: "de-CH",
            expiresInDays: 7,
          },
          { enforceExclusivity: true },
        ),
      ).rejects.toMatchObject({
        cause: { message: expect.stringMatching(/lock timeout/iu) },
      });
    } finally {
      requestRelease();
      await holderTransaction;
      await contender.close();
    }
  });
});

describe("assertNoExistingOrganization", () => {
  it("rejects when at least one organization exists", async () => {
    const [organization] = await connection.database
      .insert(organizations)
      .values({
        name: "Existing Organization",
        slug: `existing-${randomUUID()}`,
        timezone: "Europe/Zurich",
        locale: "de-CH",
      })
      .returning();

    expect(organization).toBeDefined();
    if (organization === undefined) return;
    createdOrganizationIds.push(organization.id);

    await expect(
      assertNoExistingOrganization(connection.database),
    ).rejects.toBeInstanceOf(OrganizationAlreadyExistsError);
  });
});
