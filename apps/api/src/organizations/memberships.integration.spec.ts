import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
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
import {
  OrganizationsRepository,
  type UpdateMembershipResult,
} from "./organizations.repository.js";
import { OrganizationsService } from "./organizations.service.js";
import { createApiTestApplication } from "../testing/api-harness.js";

const environment = parseApplicationEnvironment(process.env);
const databaseService = new DatabaseService(environment);
const repository = new OrganizationsRepository(databaseService);
const access = new OrganizationAccessService(repository);
const service = new OrganizationsService(repository, access, environment);

/**
 * Erzwingt genau ein Ergebnis des Repositories. Der Wettlauf, der
 * `actor-not-active` in der Produktion ausloest — die Mitgliedschaft der
 * handelnden Person wird zwischen `requirePermission` und der
 * Organisationssperre entzogen — laesst sich in einem Test nicht stellen;
 * geprueft wird deshalb die Abbildung des Ergebnisses auf die Antwort.
 */
class ActorNotActiveRepository extends OrganizationsRepository {
  public override async updateMembership(): Promise<UpdateMembershipResult> {
    return { outcome: "actor-not-active" };
  }
}

const serviceWithInactiveActor = new OrganizationsService(
  new ActorNotActiveRepository(databaseService),
  access,
  environment,
);

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

/** Rolle und Status einer Mitgliedschaft, direkt aus der Datenbank. */
async function readMembership(userId: string, inOrganizationId = organizationId) {
  const [row] = await databaseService.database
    .select({ role: memberships.role, status: memberships.status })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, inOrganizationId),
        eq(memberships.userId, userId),
      ),
    );
  return row;
}

/** Audit-Zeilen, die diese handelnde Person in dieser Organisation erzeugt hat. */
async function auditRowsOf(actorUserId: string) {
  return databaseService.database
    .select({ action: auditEvents.action })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organizationId, organizationId),
        eq(auditEvents.actorUserId, actorUserId),
      ),
    );
}

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
    // Auf Repository-Ebene geprueft: seit `OWNER_CHANGE_REQUIRES_OWNER` weist
    // der Service eine ADMIN-Hand an einer OWNER-Zeile schon vorher mit 403 ab,
    // sodass Regel 1 ueber den Service nicht mehr erreichbar waere. Noetig
    // bleibt sie trotzdem: sie sichert den Wettlauf, in dem die eigene
    // OWNER-Zeile der handelnden Person zwischen `requirePermission` und der
    // Organisationssperre herabgestuft wird — dann handelt hier eine Person,
    // die die Sperre als OWNER betreten hat, waehrend sie der letzte ist.
    // Handelt: der OWNER selbst — seit die Rolle der handelnden Person unter
    // der Sperre gelesen wird, ist er hier die einzige aktive OWNER-Zeile.
    const auditBefore = await auditRowsOf(ownerUserId);

    await expect(
      repository.updateMembership({
        organizationId,
        targetUserId: ownerUserId,
        role: "ADMIN",
        actorUserId: ownerUserId,
        audit,
      }),
    ).resolves.toEqual({ outcome: "last-owner" });

    await expect(
      repository.updateMembership({
        organizationId,
        targetUserId: ownerUserId,
        status: "SUSPENDED",
        actorUserId: ownerUserId,
        audit,
      }),
    ).resolves.toEqual({ outcome: "last-owner" });

    expect(await readMembership(ownerUserId)).toEqual({ role: "OWNER", status: "ACTIVE" });
    expect(await auditRowsOf(ownerUserId)).toHaveLength(auditBefore.length);
  }, 30_000);

  it("liest die Rolle der handelnden Person unter der Sperre statt sie zu glauben", async () => {
    // `adminUserId` ist seit dem vorigen Fall SUSPENDED. Der Aufruf traegt
    // keine Rollenangabe mehr — massgeblich ist allein die Zeile in der
    // Datenbank, und die traegt keinen aktiven Zugriff mehr.
    await expect(
      repository.updateMembership({
        organizationId,
        targetUserId: scorerUserId,
        role: "VIEWER",
        actorUserId: adminUserId,
        audit,
      }),
    ).resolves.toEqual({ outcome: "actor-not-active" });

    // Und eine aktive, aber nicht eigentumsberechtigte Hand kommt an einer
    // OWNER-Zeile ebenfalls nicht vorbei — die Rolle stammt aus der Datenbank.
    await expect(
      repository.updateMembership({
        organizationId,
        targetUserId: ownerUserId,
        role: "ADMIN",
        actorUserId: managerUserId,
        audit,
      }),
    ).resolves.toEqual({ outcome: "owner-change-requires-owner" });

    expect(await readMembership(scorerUserId)).toEqual({ role: "MEMBER", status: "ACTIVE" });
    expect(await readMembership(ownerUserId)).toEqual({ role: "OWNER", status: "ACTIVE" });
    expect(await auditRowsOf(adminUserId)).toHaveLength(0);
    expect(await auditRowsOf(managerUserId)).toHaveLength(0);
  }, 30_000);

  it("beantwortet eine entzogene Mitgliedschaft der handelnden Person mit 403", async () => {
    try {
      await serviceWithInactiveActor.updateMembership({
        organizationId,
        targetUserId: scorerUserId,
        data: { role: "VIEWER" },
        auth: ownerAuth,
        audit,
      });
      throw new Error("Die Aenderung haette abgewiesen werden muessen.");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ForbiddenException);
      const forbidden = error as ForbiddenException;
      expect(forbidden.getStatus()).toBe(403);
      // Ohne eigenen Code vergibt der globale Fehlerfilter `PERMISSION_DENIED`
      // — genau wie bei `requirePermission`.
      expect(forbidden.getResponse()).not.toHaveProperty("code");
    }

    expect(await readMembership(scorerUserId)).toEqual({ role: "MEMBER", status: "ACTIVE" });
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
    expect(await readMembership(successorUserId)).toEqual({ role: "MEMBER", status: "ACTIVE" });
    expect(await auditRowsOf(managerUserId)).toHaveLength(0);
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

  it("laesst ADMIN eine OWNER-Mitgliedschaft nicht anfassen", async () => {
    // Zuerst einen zweiten aktiven OWNER herstellen, damit die Abweisung
    // nachweislich aus `OWNER_CHANGE_REQUIRES_OWNER` stammt und nicht aus dem
    // Schutz des letzten OWNER.
    await service.updateMembership({
      organizationId,
      targetUserId: ownerUserId,
      data: { role: "OWNER" },
      auth: successorAuth,
      audit,
    });

    try {
      await service.updateMembership({
        organizationId,
        targetUserId: ownerUserId,
        data: { role: "ADMIN" },
        auth: managerAuth,
        audit,
      });
      throw new Error("Die Aenderung haette abgewiesen werden muessen.");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: "OWNER_CHANGE_REQUIRES_OWNER",
      });
    }

    expect(await readMembership(ownerUserId)).toEqual({ role: "OWNER", status: "ACTIVE" });
    expect(await auditRowsOf(managerUserId)).toHaveLength(0);
  }, 30_000);

  it("weist eine Mitgliedschaft aus einer fremden Organisation ab", async () => {
    // Den Code `RESOURCE_NOT_FOUND` vergibt der globale Fehlerfilter anhand des
    // Status; auf der Ausnahme selbst steht er nicht. Geprueft wird deshalb der
    // Typ — und vor allem, dass nichts geschrieben wurde.
    await expect(
      service.updateMembership({
        organizationId,
        targetUserId: foreignUserId,
        data: { role: "MEMBER" },
        auth: managerAuth,
        audit,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    // Die fremde Zeile bleibt unberuehrt, und es entsteht kein Audit-Eintrag.
    expect(await readMembership(foreignUserId, foreignOrganizationId)).toEqual({
      role: "ADMIN",
      status: "ACTIVE",
    });
    expect(await auditRowsOf(managerUserId)).toHaveLength(0);
  }, 30_000);

  it("weist VIEWER ab", async () => {
    const before = await readMembership(scorerUserId);

    await expect(
      service.updateMembership({
        organizationId,
        targetUserId: scorerUserId,
        data: { role: "SCORER" },
        auth: viewerAuth,
        audit,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(await readMembership(scorerUserId)).toEqual(before);
    expect(await auditRowsOf(viewerUserId)).toHaveLength(0);
  }, 30_000);

  it("laesst niemanden die eigene Mitgliedschaft aendern", async () => {
    // Handelt: der durchgehend unbeteiligte ADMIN. So bleibt die Zusicherung
    // „keine einzige Audit-Zeile dieser Person" ueber den ganzen Lauf pruefbar.
    try {
      await service.updateMembership({
        organizationId,
        targetUserId: managerUserId,
        data: { role: "MEMBER" },
        auth: managerAuth,
        audit,
      });
      throw new Error("Die Aenderung haette abgewiesen werden muessen.");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: "SELF_MEMBERSHIP_CHANGE_FORBIDDEN",
      });
    }

    expect(await readMembership(managerUserId)).toEqual({ role: "ADMIN", status: "ACTIVE" });
    expect(await auditRowsOf(managerUserId)).toHaveLength(0);
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
