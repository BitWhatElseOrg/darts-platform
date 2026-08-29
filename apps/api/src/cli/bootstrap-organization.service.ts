import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

import {
  auditEvents,
  organizationInvitations,
  organizations,
  type Database,
} from "@darts-platform/database";
import type { BootstrapOrganizationInput } from "@darts-platform/schemas";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;

/**
 * Arbitrary, fixed advisory lock key scoped to the bootstrap flow. Any two
 * transactions that take this lock are fully serialized against each other
 * for as long as either holds it, regardless of how many rows are already
 * in `organizations`. Cast to bigint explicitly so postgres does not infer
 * an int4 parameter type for the literal.
 *
 * Exported only so integration tests can take the exact same lock from a
 * second session to prove `createBootstrapOrganization` actually contends
 * on it; production code never needs to reference this outside this file.
 */
export const BOOTSTRAP_ADVISORY_LOCK_KEY = 8_179_302_441;

export class OrganizationAlreadyExistsError extends Error {
  public readonly count: number;

  public constructor(count: number) {
    super(
      `Refusing to bootstrap: the database already contains ${String(count)} organization(s).`,
    );
    this.name = "OrganizationAlreadyExistsError";
    this.count = count;
  }
}

export interface BootstrapOrganizationResult {
  readonly organizationId: string;
  readonly name: string;
  readonly slug: string;
  readonly invitationId: string;
  readonly email: string;
  readonly role: "ADMIN";
  readonly expiresAt: Date;
}

export async function assertNoExistingOrganization(
  database: Database,
): Promise<void> {
  const [row] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(organizations);

  const count = row?.count ?? 0;

  if (count > 0) {
    throw new OrganizationAlreadyExistsError(count);
  }
}

export interface CreateBootstrapOrganizationOptions {
  /**
   * When true (the default), the check for "no organization exists yet"
   * is repeated inside the same transaction as the insert, guarded by a
   * Postgres advisory lock. This closes the check-then-act race that
   * exists when `assertNoExistingOrganization` and this function are
   * called as two separate, unsynchronized statements: two concurrent
   * bootstrap runs can both pass the earlier check before either has
   * committed. With this option enabled, only one concurrent transaction
   * can hold the lock at a time, and the loser observes the winner's
   * committed row and throws `OrganizationAlreadyExistsError` instead of
   * inserting a second organization.
   *
   * Defaults to true: safe-by-default, so a caller that forgets to pass
   * this option still gets the race-safe path. Set explicitly to false
   * only where that is truly intended, e.g. integration tests that run
   * against a shared database already containing organizations from
   * other suites and want the pre-existing, unsynchronized behaviour.
   */
  readonly enforceExclusivity?: boolean;
}

export async function createBootstrapOrganization(
  database: Database,
  input: BootstrapOrganizationInput,
  options: CreateBootstrapOrganizationOptions = {},
): Promise<BootstrapOrganizationResult> {
  const enforceExclusivity = options.enforceExclusivity ?? true;

  return database.transaction(async (transaction) => {
    if (enforceExclusivity) {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(${BOOTSTRAP_ADVISORY_LOCK_KEY}::bigint)`,
      );

      const [existing] = await transaction
        .select({ count: sql<number>`count(*)::int` })
        .from(organizations);

      const existingCount = existing?.count ?? 0;

      if (existingCount > 0) {
        throw new OrganizationAlreadyExistsError(existingCount);
      }
    }

    const [organization] = await transaction
      .insert(organizations)
      .values({
        name: input.name,
        slug: input.slug,
        timezone: input.timezone,
        locale: input.locale,
      })
      .returning();

    if (organization === undefined) {
      throw new Error("Organization insert did not return a row.");
    }

    const [invitation] = await transaction
      .insert(organizationInvitations)
      .values({
        organizationId: organization.id,
        email: input.email,
        role: "ADMIN",
        invitedByUserId: null,
        expiresAt: new Date(
          Date.now() + input.expiresInDays * MILLISECONDS_PER_DAY,
        ),
      })
      .returning();

    if (invitation === undefined) {
      throw new Error("Invitation insert did not return a row.");
    }

    await transaction.insert(auditEvents).values({
      organizationId: organization.id,
      actorUserId: null,
      action: "ORGANIZATION_BOOTSTRAPPED",
      entityType: "Organization",
      entityId: organization.id,
      newValue: {
        name: organization.name,
        slug: organization.slug,
        invitedEmail: invitation.email,
        invitedRole: invitation.role,
      },
      correlationId: randomUUID(),
    });

    return {
      organizationId: organization.id,
      name: organization.name,
      slug: organization.slug,
      invitationId: invitation.id,
      email: invitation.email,
      role: "ADMIN",
      expiresAt: invitation.expiresAt,
    };
  });
}
