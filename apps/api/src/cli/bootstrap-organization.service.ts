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

export async function createBootstrapOrganization(
  database: Database,
  input: BootstrapOrganizationInput,
): Promise<BootstrapOrganizationResult> {
  return database.transaction(async (transaction) => {
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
