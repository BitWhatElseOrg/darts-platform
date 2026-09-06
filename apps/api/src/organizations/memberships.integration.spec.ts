import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  auditEvents,
  memberships,
  organizations,
  users,
} from "@darts-platform/database";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";

import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { OrganizationAccessService } from "./organization-access.service.js";
import { OrganizationsRepository } from "./organizations.repository.js";
import { OrganizationsService } from "./organizations.service.js";
import { createApiTestApplication } from "../testing/api-harness.js";

const environment = parseApplicationEnvironment(process.env);
const databaseService = new DatabaseService(environment);
const repository = new OrganizationsRepository(databaseService);
const access = new OrganizationAccessService(repository);
const service = new OrganizationsService(repository, access, environment);

const organizationId = randomUUID();
const foreignOrganizationId = randomUUID();
const ownerUserId = randomUUID();
// Startet als MEMBER und wird im Test ueber die API zum zweiten OWNER
// ernannt — der Eigentumswechsel laeuft damit ueber denselben Weg wie in der
// Produktion, nicht ueber einen Direkteintrag in der Datenbank.
const successorUserId = randomUUID();
// Handelt in den meisten Faellen: ADMIN mit `organization:manage_roles`,
// bleibt durchgehend aktiv.
const managerUserId = randomUUID();
// Reines Ziel der Deaktivierung; nach Fall 2 ist diese Person gesperrt und
// wird danach nicht mehr als handelnde Person verwendet.
const adminUserId = randomUUID();
const scorerUserId = randomUUID();
const viewerUserId = randomUUID();
const foreignUserId = randomUUID();

function authFor(userId: string, name: string): AuthContext {
  return {
    user: { id: userId, email: `${name}-${userId}@example.test`, name },
    session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
  };
}

const ownerAuth = authFor(ownerUserId, "owner");
const successorAuth = authFor(successorUserId, "successor");
const managerAuth = authFor(managerUserId, "manager");
const adminAuth = authFor(adminUserId, "admin");
const viewerAuth = authFor(viewerUserId, "viewer");
const audit = {
  correlationId: randomUUID(),
  ip: "127.0.0.1",
  userAgent: "vitest",
} as const;

beforeAll(async () => {
  await databaseService.database.insert(users).values([
    { id: ownerUserId, email: ownerAuth.user.email, displayName: "Owner" },
    { id: successorUserId, email: successorAuth.user.email, displayName: "Nachfolge" },
    { id: managerUserId, email: managerAuth.user.email, displayName: "Manager" },
    { id: adminUserId, email: adminAuth.user.email, displayName: "Admin" },
    { id: scorerUserId, email: `scorer-${scorerUserId}@example.test`, displayName: "Scorer" },
    { id: viewerUserId, email: viewerAuth.user.email, displayName: "Viewer" },
    { id: foreignUserId, email: `foreign-${foreignUserId}@example.test`, displayName: "Fremde Person" },
  ]);
  await databaseService.database.insert(organizations).values([
    { id: organizationId, name: "Mitglieder Club", slug: `members-${organizationId}`, timezone: "Europe/Zurich", locale: "de-CH" },
    { id: foreignOrganizationId, name: "Fremder Club", slug: `foreign-members-${foreignOrganizationId}`, timezone: "Europe/Zurich", locale: "de-CH" },
  ]);
  await databaseService.database.insert(memberships).values([
    { organizationId, userId: ownerUserId, role: "OWNER", status: "ACTIVE" },
    { organizationId, userId: successorUserId, role: "MEMBER", status: "ACTIVE" },
    { organizationId, userId: managerUserId, role: "ADMIN", status: "ACTIVE" },
    { organizationId, userId: adminUserId, role: "ADMIN", status: "ACTIVE" },
    { organizationId, userId: scorerUserId, role: "SCORER", status: "ACTIVE" },
    { organizationId, userId: viewerUserId, role: "VIEWER", status: "ACTIVE" },
    { organizationId: foreignOrganizationId, userId: foreignUserId, role: "ADMIN", status: "ACTIVE" },
  ]);
});

afterAll(async () => {
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(organizations).where(eq(organizations.id, foreignOrganizationId));
  for (const userId of [ownerUserId, successorUserId, managerUserId, adminUserId, scorerUserId, viewerUserId, foreignUserId]) {
    await databaseService.database.delete(users).where(eq(users.id, userId));
  }
  await databaseService.onApplicationShutdown();
});

describe("Mitgliedschaften verwalten", () => {
  it("aendert eine Rolle und auditiert den Wechsel", async () => {
    const member = await service.updateMembership({
      organizationId,
      targetUserId: scorerUserId,
      data: { role: "MEMBER" },
      auth: ownerAuth,
      audit,
    });

    expect(member).toMatchObject({ userId: scorerUserId, role: "MEMBER", status: "ACTIVE" });
    expect(await repository.getActiveMembership({ organizationId, userId: scorerUserId })).toEqual({
      role: "MEMBER",
    });

    const events = await databaseService.database
      .select({ action: auditEvents.action, oldValue: auditEvents.oldValue, newValue: auditEvents.newValue })
      .from(auditEvents)
      .where(and(eq(auditEvents.organizationId, organizationId), eq(auditEvents.action, "USER_ROLE_CHANGED")));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ oldValue: { role: "SCORER" }, newValue: { role: "MEMBER" } });
  }, 30_000);

  it("entzieht den Zugriff und auditiert die Deaktivierung", async () => {
    const member = await service.updateMembership({
      organizationId,
      targetUserId: adminUserId,
      data: { status: "SUSPENDED" },
      auth: ownerAuth,
      audit,
    });

    expect(member.status).toBe("SUSPENDED");
    expect(await repository.getActiveMembership({ organizationId, userId: adminUserId })).toBeNull();

    const events = await databaseService.database
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(and(eq(auditEvents.organizationId, organizationId), eq(auditEvents.action, "MEMBER_DEACTIVATED")));
    expect(events).toHaveLength(1);
  }, 30_000);

  it("schuetzt den letzten aktiven OWNER vor Herabstufung und Deaktivierung", async () => {
    await expect(
      service.updateMembership({
        organizationId,
        targetUserId: ownerUserId,
        data: { role: "ADMIN" },
        auth: managerAuth,
        audit,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      service.updateMembership({
        organizationId,
        targetUserId: ownerUserId,
        data: { status: "SUSPENDED" },
        auth: managerAuth,
        audit,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(await repository.getActiveMembership({ organizationId, userId: ownerUserId })).toEqual({
      role: "OWNER",
    });
  }, 30_000);

  it("laesst ADMIN kein Eigentum vergeben und schreibt dabei nichts", async () => {
    try {
      await service.updateMembership({
        organizationId,
        targetUserId: successorUserId,
        data: { role: "OWNER" },
        auth: managerAuth,
        audit,
      });
      throw new Error("Die Vergabe hätte abgewiesen werden müssen.");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ForbiddenException);
      const response = (error as ForbiddenException).getResponse();
      expect(response).toMatchObject({ code: "OWNER_GRANT_REQUIRES_OWNER" });
    }

    // Keine Schreibwirkung: weder Rolle noch Audit-Eintrag.
    expect(await repository.getActiveMembership({ organizationId, userId: successorUserId })).toEqual({
      role: "MEMBER",
    });
    const events = await databaseService.database
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, organizationId),
          eq(auditEvents.actorUserId, managerUserId),
        ),
      );
    expect(events).toHaveLength(0);
  }, 30_000);

  it("laesst OWNER das Eigentum uebertragen und danach den bisherigen OWNER herabstufen", async () => {
    const successor = await service.updateMembership({
      organizationId,
      targetUserId: successorUserId,
      data: { role: "OWNER" },
      auth: ownerAuth,
      audit,
    });

    expect(successor.role).toBe("OWNER");
    expect(await repository.getActiveMembership({ organizationId, userId: successorUserId })).toEqual({
      role: "OWNER",
    });

    // Erst jetzt greift der Schutz des letzten OWNER nicht mehr.
    const former = await service.updateMembership({
      organizationId,
      targetUserId: ownerUserId,
      data: { role: "ADMIN" },
      auth: successorAuth,
      audit,
    });

    expect(former.role).toBe("ADMIN");

    const roleChanges = await databaseService.database
      .select({ oldValue: auditEvents.oldValue, newValue: auditEvents.newValue })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, organizationId),
          eq(auditEvents.action, "USER_ROLE_CHANGED"),
        ),
      );
    expect(roleChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ oldValue: { role: "MEMBER" }, newValue: { role: "OWNER" } }),
        expect.objectContaining({ oldValue: { role: "OWNER" }, newValue: { role: "ADMIN" } }),
      ]),
    );
  }, 30_000);

  it("weist eine Mitgliedschaft aus einer fremden Organisation ab", async () => {
    await expect(
      service.updateMembership({
        organizationId,
        targetUserId: foreignUserId,
        data: { role: "MEMBER" },
        auth: successorAuth,
        audit,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const untouched = await databaseService.database
      .select({ role: memberships.role })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, foreignOrganizationId),
          eq(memberships.userId, foreignUserId),
        ),
      );
    expect(untouched[0]).toEqual({ role: "ADMIN" });
  }, 30_000);

  it("weist VIEWER ab", async () => {
    await expect(
      service.updateMembership({
        organizationId,
        targetUserId: scorerUserId,
        data: { role: "SCORER" },
        auth: viewerAuth,
        audit,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  }, 30_000);

  it("laesst niemanden die eigene Mitgliedschaft aendern", async () => {
    await expect(
      service.updateMembership({
        organizationId,
        targetUserId: successorUserId,
        data: { role: "ADMIN" },
        auth: successorAuth,
        audit,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  }, 30_000);
});

describe("PATCH /organizations/:organizationId/members/:userId", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApiTestApplication();
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it("verlangt eine Anmeldung", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/organizations/${organizationId}/members/${scorerUserId}`,
      payload: { role: "MEMBER" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
  }, 30_000);
});
