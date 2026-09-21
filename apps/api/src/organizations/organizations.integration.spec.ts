import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import {
  parseApplicationEnvironment,
  type ApplicationEnvironment,
} from "@darts-platform/config";
import { auditEvents, memberships, organizations, users } from "@darts-platform/database";

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

describe("Faehigkeiten der Mandantenanlage", () => {
  it("meldet den offenen Weg, wenn das Flag gesetzt ist", () => {
    expect(serviceWithFlag(true).capabilities()).toEqual({
      selfServiceEnabled: true,
    });
  });

  it("meldet den gesperrten Weg, solange das Flag aus ist", () => {
    expect(serviceWithFlag(false).capabilities()).toEqual({
      selfServiceEnabled: false,
    });
  });
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

describe("Stammdaten der Organisation", () => {
  const memberId = randomUUID();
  const memberAuth: AuthContext = {
    user: { id: memberId, email: `member-${memberId}@example.test`, name: "Mitglied" },
    session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
  };
  const strangerId = randomUUID();
  const strangerAuth: AuthContext = {
    user: { id: strangerId, email: `stranger-${strangerId}@example.test`, name: "Fremd" },
    session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
  };
  let organizationId: string;

  beforeAll(async () => {
    await databaseService.database.insert(users).values([
      { id: memberId, email: memberAuth.user.email, displayName: "Mitglied" },
      { id: strangerId, email: strangerAuth.user.email, displayName: "Fremd" },
    ]);
    const organization = await serviceWithFlag(true).create({
      data: { name: "Stammdaten-Verein", slug: `stamm-${randomUUID()}`, timezone: "Europe/Zurich", locale: "de-CH" },
      auth,
      audit,
    });
    organizationId = organization.id;
    createdOrganizationIds.push(organizationId);
    await databaseService.database.insert(memberships).values({
      organizationId,
      userId: memberId,
      role: "MEMBER",
      status: "ACTIVE",
    });
  });

  afterAll(async () => {
    await databaseService.database.delete(users).where(eq(users.id, memberId));
    await databaseService.database.delete(users).where(eq(users.id, strangerId));
  });

  it("liefert die Organisation jedem aktiven Mitglied mit seiner Rolle", async () => {
    const service = serviceWithFlag(true);
    const asOwner = await service.get({ organizationId, auth });
    const asMember = await service.get({ organizationId, auth: memberAuth });
    expect(asOwner).toMatchObject({ id: organizationId, name: "Stammdaten-Verein", role: "OWNER" });
    expect(asMember).toMatchObject({ id: organizationId, role: "MEMBER", playerId: null });
  }, 30_000);

  it("verweigert Nichtmitgliedern das Lesen (organization:read)", async () => {
    await expect(
      serviceWithFlag(true).get({ organizationId, auth: strangerAuth }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  }, 30_000);

  it("aendert Name, Zeitzone und Sprache und schreibt das Audit (organization:update)", async () => {
    const updated = await serviceWithFlag(true).update({
      organizationId,
      data: { name: "Umbenannter Verein", locale: "fr-CH" },
      auth,
      audit,
    });
    expect(updated).toMatchObject({
      id: organizationId,
      name: "Umbenannter Verein",
      locale: "fr-CH",
      timezone: "Europe/Zurich",
      role: "OWNER",
    });

    const [row] = await databaseService.database
      .select({ name: organizations.name, locale: organizations.locale })
      .from(organizations)
      .where(eq(organizations.id, organizationId));
    expect(row).toEqual({ name: "Umbenannter Verein", locale: "fr-CH" });

    const events = await databaseService.database
      .select({ oldValue: auditEvents.oldValue, newValue: auditEvents.newValue, actorUserId: auditEvents.actorUserId })
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, organizationId), eq(auditEvents.action, "ORGANIZATION_UPDATED")));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorUserId: userId,
      oldValue: { name: "Stammdaten-Verein", locale: "de-CH", timezone: "Europe/Zurich" },
      newValue: { name: "Umbenannter Verein", locale: "fr-CH", timezone: "Europe/Zurich" },
    });
  }, 30_000);

  it("laesst ein MEMBER die Stammdaten nicht aendern", async () => {
    await expect(
      serviceWithFlag(true).update({
        organizationId,
        data: { name: "Hijack" },
        auth: memberAuth,
        audit,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const [row] = await databaseService.database
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, organizationId));
    expect(row?.name).not.toBe("Hijack");
  }, 30_000);
});
