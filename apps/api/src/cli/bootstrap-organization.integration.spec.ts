import { afterAll, afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
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

    const result = await createBootstrapOrganization(connection.database, {
      name: "Bootstrap Test Organization",
      slug,
      email,
      timezone: "Europe/Zurich",
      locale: "de-CH",
      expiresInDays: 7,
    });
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

    const result = await createBootstrapOrganization(
      connection.database,
      parsed,
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
