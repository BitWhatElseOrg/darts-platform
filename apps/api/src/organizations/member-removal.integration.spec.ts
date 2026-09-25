import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  auditEvents,
  memberships,
  organizations,
  players,
  users,
} from "@darts-platform/database";

import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { OrganizationAccessService } from "./organization-access.service.js";
import { OrganizationsRepository } from "./organizations.repository.js";
import { OrganizationsService } from "./organizations.service.js";

const environment = parseApplicationEnvironment(process.env);
const databaseService = new DatabaseService(environment);
const repository = new OrganizationsRepository(databaseService);
const access = new OrganizationAccessService(repository);
const service = new OrganizationsService(repository, access, environment);

const organizationId = randomUUID();
const foreignOrganizationId = randomUUID();
const ownerUserId = randomUUID();
const memberUserId = randomUUID();
const adminUserId = randomUUID();
const directorUserId = randomUUID();
const foreignUserId = randomUUID();

let linkedPlayerId = "";

function authFor(userId: string, name: string): AuthContext {
  return {
    user: { id: userId, email: `${name}-${userId}@example.test`, name },
    session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
  };
}

const ownerAuth = authFor(ownerUserId, "owner");
const memberAuth = authFor(memberUserId, "member");
const adminAuth = authFor(adminUserId, "admin");
const directorAuth = authFor(directorUserId, "director");

const audit = {
  correlationId: randomUUID(),
  ip: "127.0.0.1",
  userAgent: "vitest",
} as const;

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
    .select({ action: auditEvents.action, oldValue: auditEvents.oldValue, newValue: auditEvents.newValue })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organizationId, organizationId),
        eq(auditEvents.actorUserId, actorUserId),
      ),
    );
}

beforeAll(async () => {
  await databaseService.database.insert(users).values([
    { id: ownerUserId, email: ownerAuth.user.email, displayName: "Owner" },
    { id: memberUserId, email: memberAuth.user.email, displayName: "Mitglied" },
    { id: adminUserId, email: adminAuth.user.email, displayName: "Admin" },
    { id: directorUserId, email: directorAuth.user.email, displayName: "Turnierleitung" },
    { id: foreignUserId, email: `foreign-${foreignUserId}@example.test`, displayName: "Fremde Person" },
  ]);
  await databaseService.database.insert(organizations).values([
    { id: organizationId, name: "Entfernungs-Club", slug: `removal-${organizationId}`, timezone: "Europe/Zurich", locale: "de-CH" },
    { id: foreignOrganizationId, name: "Fremder Club", slug: `foreign-removal-${foreignOrganizationId}`, timezone: "Europe/Zurich", locale: "de-CH" },
  ]);
  await databaseService.database.insert(memberships).values([
    { organizationId, userId: ownerUserId, role: "OWNER", status: "ACTIVE" },
    { organizationId, userId: memberUserId, role: "MEMBER", status: "ACTIVE" },
    { organizationId, userId: adminUserId, role: "ADMIN", status: "ACTIVE" },
    { organizationId, userId: directorUserId, role: "TOURNAMENT_DIRECTOR", status: "ACTIVE" },
    { organizationId: foreignOrganizationId, userId: foreignUserId, role: "ADMIN", status: "ACTIVE" },
  ]);
  const [player] = await databaseService.database
    .insert(players)
    .values({
      organizationId,
      displayName: "Verknuepftes Profil",
      status: "ACTIVE",
      userId: memberUserId,
    })
    .returning({ id: players.id });
  linkedPlayerId = player?.id ?? "";
});

afterAll(async () => {
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(organizations).where(eq(organizations.id, foreignOrganizationId));
  for (const userId of [ownerUserId, memberUserId, adminUserId, directorUserId, foreignUserId]) {
    await databaseService.database.delete(users).where(eq(users.id, userId));
  }
  await databaseService.onApplicationShutdown();
});

describe("Mitglied entfernen", () => {
  it("entfernt ein Mitglied, loest die Spielerzuordnung und auditiert beides", async () => {
    await service.removeMember({
      organizationId,
      targetUserId: memberUserId,
      auth: ownerAuth,
      audit,
    });

    expect(await readMembership(memberUserId)).toBeUndefined();

    const [player] = await databaseService.database
      .select({ userId: players.userId })
      .from(players)
      .where(eq(players.id, linkedPlayerId));
    expect(player?.userId).toBeNull();

    const [userRow] = await databaseService.database
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, memberUserId));
    expect(userRow).toBeDefined();

    const events = await auditRowsOf(ownerUserId);
    const memberRemoved = events.find((event) => event.action === "MEMBER_REMOVED");
    expect(memberRemoved?.oldValue).toMatchObject({
      userId: memberUserId,
      role: "MEMBER",
      status: "ACTIVE",
      email: memberAuth.user.email,
    });
    expect(events.some((event) => event.action === "PLAYER_UNLINKED")).toBe(true);
  }, 30_000);

  it("verweigert das Entfernen der eigenen Mitgliedschaft", async () => {
    await expect(
      service.removeMember({
        organizationId,
        targetUserId: ownerUserId,
        auth: ownerAuth,
        audit,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    try {
      await service.removeMember({
        organizationId,
        targetUserId: ownerUserId,
        auth: ownerAuth,
        audit,
      });
    } catch (error: unknown) {
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: "SELF_MEMBERSHIP_CHANGE_FORBIDDEN",
      });
    }

    expect(await readMembership(ownerUserId)).toEqual({ role: "OWNER", status: "ACTIVE" });
  }, 30_000);

  it("verlangt einen OWNER, um eine OWNER-Mitgliedschaft zu entfernen", async () => {
    try {
      await service.removeMember({
        organizationId,
        targetUserId: ownerUserId,
        auth: adminAuth,
        audit,
      });
      throw new Error("Das Entfernen haette abgewiesen werden muessen.");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: "OWNER_CHANGE_REQUIRES_OWNER",
      });
    }

    expect(await readMembership(ownerUserId)).toEqual({ role: "OWNER", status: "ACTIVE" });
    expect(await auditRowsOf(adminUserId)).toHaveLength(0);
  }, 30_000);

  it("weist TOURNAMENT_DIRECTOR ohne organization:manage_members ab", async () => {
    try {
      await service.removeMember({
        organizationId,
        targetUserId: adminUserId,
        auth: directorAuth,
        audit,
      });
      throw new Error("Das Entfernen haette abgewiesen werden muessen.");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ForbiddenException);
      // Ohne eigenen Code vergibt der globale Fehlerfilter `PERMISSION_DENIED`
      // — genau wie bei `requirePermission`.
      expect((error as ForbiddenException).getResponse()).not.toHaveProperty("code");
    }

    expect(await readMembership(adminUserId)).toEqual({ role: "ADMIN", status: "ACTIVE" });
    expect(await auditRowsOf(directorUserId)).toHaveLength(0);
  }, 30_000);

  it("weist einen unbekannten Benutzer mit 404 ab", async () => {
    await expect(
      service.removeMember({
        organizationId,
        targetUserId: randomUUID(),
        auth: ownerAuth,
        audit,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  }, 30_000);

  it("weist ein Mitglied einer fremden Organisation mit 404 ab", async () => {
    await expect(
      service.removeMember({
        organizationId,
        targetUserId: foreignUserId,
        auth: ownerAuth,
        audit,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(await readMembership(foreignUserId, foreignOrganizationId)).toEqual({
      role: "ADMIN",
      status: "ACTIVE",
    });
  }, 30_000);

  it("erlaubt nach dem Entfernen eine neue Einladung an dieselbe E-Mail", async () => {
    const invitation = await service.invite({
      organizationId,
      data: { email: memberAuth.user.email, role: "MEMBER" },
      auth: ownerAuth,
      audit,
    });

    await service.acceptInvitation({
      invitationId: invitation.id,
      data: { claimToken: invitation.claimToken },
      auth: memberAuth,
      audit,
    });

    expect(await readMembership(memberUserId)).toEqual({ role: "MEMBER", status: "ACTIVE" });
  }, 30_000);
});
