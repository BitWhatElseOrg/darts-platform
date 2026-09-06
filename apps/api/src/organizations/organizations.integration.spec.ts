import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import {
  parseApplicationEnvironment,
  type ApplicationEnvironment,
} from "@darts-platform/config";
import { organizations, users } from "@darts-platform/database";

import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { OrganizationAccessService } from "./organization-access.service.js";
import { OrganizationsRepository } from "./organizations.repository.js";
import { OrganizationsService } from "./organizations.service.js";

const baseEnvironment = parseApplicationEnvironment(process.env);
const databaseService = new DatabaseService(baseEnvironment);
const repository = new OrganizationsRepository(databaseService);
const access = new OrganizationAccessService(repository);

function serviceWithFlag(allow: boolean): OrganizationsService {
  const environment: ApplicationEnvironment = {
    ...baseEnvironment,
    ALLOW_SELF_SERVICE_ORGANIZATIONS: allow,
  };
  return new OrganizationsService(repository, access, environment);
}

const userId = randomUUID();
const auth: AuthContext = {
  user: {
    id: userId,
    email: `self-service-${userId}@example.test`,
    name: "Self Service",
  },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const audit = {
  correlationId: randomUUID(),
  ip: "127.0.0.1",
  userAgent: "vitest",
} as const;
const createdOrganizationIds: string[] = [];

beforeAll(async () => {
  await databaseService.database.insert(users).values({
    id: userId,
    email: auth.user.email,
    displayName: auth.user.name,
  });
});

afterAll(async () => {
  for (const organizationId of createdOrganizationIds) {
    await databaseService.database
      .delete(organizations)
      .where(eq(organizations.id, organizationId));
  }
  await databaseService.database.delete(users).where(eq(users.id, userId));
  await databaseService.onApplicationShutdown();
});

describe("Mandantenanlage", () => {
  it("weist die Selbstbedienung ab, solange das Flag aus ist", async () => {
    const slug = `denied-${randomUUID()}`;

    await expect(
      serviceWithFlag(false).create({
        data: {
          name: "Nicht erlaubt",
          slug,
          timezone: "Europe/Zurich",
          locale: "de-CH",
        },
        auth,
        audit,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const rows = await databaseService.database
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, slug));
    expect(rows).toHaveLength(0);
  }, 30_000);

  it("nennt den eigenen Fehlercode", async () => {
    try {
      await serviceWithFlag(false).create({
        data: {
          name: "Nicht erlaubt",
          slug: `denied-${randomUUID()}`,
          timezone: "Europe/Zurich",
          locale: "de-CH",
        },
        auth,
        audit,
      });
      throw new Error("Die Anlage hätte abgewiesen werden müssen.");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ForbiddenException);
      const response = (error as ForbiddenException).getResponse();
      expect(response).toMatchObject({
        code: "SELF_SERVICE_ORGANIZATIONS_DISABLED",
      });
    }
  }, 30_000);

  it("legt den Mandanten an, wenn das Flag gesetzt ist", async () => {
    const organization = await serviceWithFlag(true).create({
      data: {
        name: "Erlaubter Verein",
        slug: `allowed-${randomUUID()}`,
        timezone: "Europe/Zurich",
        locale: "de-CH",
      },
      auth,
      audit,
    });
    createdOrganizationIds.push(organization.id);

    expect(organization.role).toBe("OWNER");
  }, 30_000);
});
