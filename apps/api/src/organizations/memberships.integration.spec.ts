import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  auditEvents,
  memberships,
  organizationInvitations,
  organizations,
  users,
} from "@darts-platform/database";
import { apiErrorSchema } from "@darts-platform/schemas";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";

import { AuthService } from "../auth/auth.service.js";
import {
  generateInvitationClaimToken,
  hashInvitationClaimToken,
} from "../auth/invitation-claim.js";
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
// Nur fuer den Annahmepfad einer Einladung: die eine Person ist gesperrt,
// die andere aktives MEMBER. Beide werden von keinem anderen Test angefasst.
const suspendedUserId = randomUUID();
const rejoiningUserId = randomUUID();
// Nimmt zwei gleichzeitig gueltige Einladungen an; ohne Mitgliedschaft zu
// Beginn, damit beide Annahmen um denselben `INSERT` konkurrieren.
const newcomerUserId = randomUUID();

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
const suspendedAuth = authFor(suspendedUserId, "suspended");
const rejoiningAuth = authFor(rejoiningUserId, "rejoining");
const newcomerAuth = authFor(newcomerUserId, "newcomer");
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
    { id: suspendedUserId, email: suspendedAuth.user.email, displayName: "Gesperrte Person" },
    { id: rejoiningUserId, email: rejoiningAuth.user.email, displayName: "Bestehendes Mitglied" },
    { id: newcomerUserId, email: newcomerAuth.user.email, displayName: "Neue Person" },
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
    { organizationId, userId: suspendedUserId, role: "MEMBER", status: "SUSPENDED" },
    { organizationId, userId: rejoiningUserId, role: "MEMBER", status: "ACTIVE" },
  ]);
});

afterAll(async () => {
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(organizations).where(eq(organizations.id, foreignOrganizationId));
  for (const userId of [ownerUserId, successorUserId, managerUserId, adminUserId, scorerUserId, viewerUserId, foreignUserId, suspendedUserId, rejoiningUserId, newcomerUserId]) {
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

/**
 * Die Annahme einer Einladung schrieb die Mitgliedschaft per
 * `onConflictDoUpdate` und setzte sie dabei unbesehen auf `ACTIVE` mit der
 * Rolle der Einladung. Eine erneute Einladung hob damit eine Deaktivierung
 * auf und aenderte eine bestehende Rolle — beides gehoert allein in
 * `updateMembership`, das dafuer die Eigentumsregeln und den Audit-Eintrag
 * traegt.
 */
describe("Einladung annehmen", () => {
  it("hebt eine gesperrte Mitgliedschaft nicht auf", async () => {
    const invitation = await service.invite({
      organizationId,
      data: { email: suspendedAuth.user.email, role: "ADMIN" },
      auth: ownerAuth,
      audit,
    });

    await expect(
      service.acceptInvitation({
        invitationId: invitation.id,
        data: { claimToken: invitation.claimToken },
        auth: suspendedAuth,
        audit,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: "MEMBERSHIP_SUSPENDED" },
    });

    expect(await readMembership(suspendedUserId)).toEqual({
      role: "MEMBER",
      status: "SUSPENDED",
    });
    // Die Einladung bleibt offen: nach einer Reaktivierung durch einen OWNER
    // soll sie noch annehmbar sein.
    const [stored] = await databaseService.database
      .select({ status: organizationInvitations.status })
      .from(organizationInvitations)
      .where(eq(organizationInvitations.id, invitation.id));
    expect(stored?.status).toBe("PENDING");
  }, 30_000);

  it("laesst die Rolle eines bestehenden aktiven Mitglieds unveraendert", async () => {
    const invitation = await service.invite({
      organizationId,
      data: { email: rejoiningAuth.user.email, role: "ADMIN" },
      auth: ownerAuth,
      audit,
    });

    expect(
      await service.acceptInvitation({
        invitationId: invitation.id,
        data: { claimToken: invitation.claimToken },
        auth: rejoiningAuth,
        audit,
      }),
    ).toEqual({ accepted: true });

    expect(await readMembership(rejoiningUserId)).toEqual({
      role: "MEMBER",
      status: "ACTIVE",
    });
    const [stored] = await databaseService.database
      .select({ status: organizationInvitations.status })
      .from(organizationInvitations)
      .where(eq(organizationInvitations.id, invitation.id));
    expect(stored?.status).toBe("ACCEPTED");
  }, 30_000);

  /**
   * Auf eine noch fehlende Mitgliedschaft laesst sich keine Zeilensperre
   * nehmen: eine gleichzeitige Transaktion kann sie zwischen dem Lesen und
   * dem `INSERT` anlegen. Die Annahme laeuft dann in `on conflict do nothing`
   * und aendert nichts — der Audit-Eintrag darf trotzdem nicht `created`
   * behaupten. Die Wirkung steht erst nach dem `INSERT` fest.
   *
   * Deterministisch gestellt: eine offene Transaktion schreibt die
   * Mitgliedschaft und haelt sie ungesehen fest. Die Annahme liest sie
   * deshalb als fehlend, blockiert dann aber am Unique-Index, bis die andere
   * Transaktion committet.
   *
   * Die Einladung wird direkt geschrieben, weil `createInvitation` eine
   * offene Einladung derselben Adresse zurueckzieht.
   */
  it("auditiert eine Annahme als unveraendert, wenn die Mitgliedschaft nebenher entsteht", async () => {
    const claimToken = generateInvitationClaimToken();
    const [invitation] = await databaseService.database
      .insert(organizationInvitations)
      .values({
        organizationId,
        email: newcomerAuth.user.email,
        role: "ADMIN",
        status: "PENDING",
        claimTokenHash: hashInvitationClaimToken(claimToken),
        invitedByUserId: ownerUserId,
        expiresAt: new Date(Date.now() + 3_600_000),
      })
      .returning({ id: organizationInvitations.id });

    let membershipWritten!: () => void;
    const written = new Promise<void>((resolve) => {
      membershipWritten = resolve;
    });
    let releaseHolder!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseHolder = resolve;
    });
    const holder = databaseService.database.transaction(async (transaction) => {
      await transaction.insert(memberships).values({
        organizationId,
        userId: newcomerUserId,
        role: "VIEWER",
        status: "ACTIVE",
      });
      membershipWritten();
      await held;
    });

    await written;
    const accepting = service.acceptInvitation({
      invitationId: invitation?.id ?? "",
      data: { claimToken },
      auth: newcomerAuth,
      audit,
    });
    // Zeit, bis die Annahme am Unique-Index haengt. Laeuft sie schneller,
    // sieht sie die Mitgliedschaft nach dem Commit ohnehin als bestehend —
    // die Zusicherung unten gilt in beiden Faellen.
    await new Promise((resolve) => setTimeout(resolve, 250));
    releaseHolder();
    await holder;

    expect(await accepting).toEqual({ accepted: true });
    // Die Rolle der Einladung (ADMIN) bleibt ohne Wirkung.
    expect(await readMembership(newcomerUserId)).toEqual({
      role: "VIEWER",
      status: "ACTIVE",
    });

    const rows = await databaseService.database
      .select({ newValue: auditEvents.newValue })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, organizationId),
          eq(auditEvents.actorUserId, newcomerUserId),
          eq(auditEvents.action, "MEMBER_INVITATION_ACCEPTED"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.newValue).toMatchObject({ membership: "unchanged" });
  }, 30_000);
});

/**
 * Die Mitgliederverwaltung braucht eine Liste: `PATCH` allein liess sich nur
 * bedienen, wenn die Ziel-`userId` schon bekannt war — eine Oberflaeche gab
 * es deshalb nicht.
 */
describe("Mitglieder auflisten", () => {
  it("listet die Mitgliedschaften der eigenen Organisation nach Namen", async () => {
    const members = await service.listMembers({ organizationId, auth: ownerAuth });

    expect(members.map((member) => member.userId)).toContain(ownerUserId);
    expect(members.map((member) => member.userId)).not.toContain(foreignUserId);
    expect([...members].sort((left, right) => left.displayName.localeCompare(right.displayName))).toEqual(members);
    expect(members.find((member) => member.userId === suspendedUserId)).toMatchObject({
      role: "MEMBER",
      status: "SUSPENDED",
      email: suspendedAuth.user.email,
    });
  }, 30_000);

  it("weist eine Rolle ohne Mitgliederverwaltung ab", async () => {
    await expect(
      service.listMembers({ organizationId, auth: viewerAuth }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  }, 30_000);

  it("weist eine fremde Organisation ab", async () => {
    await expect(
      service.listMembers({ organizationId: foreignOrganizationId, auth: ownerAuth }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  }, 30_000);
});

/**
 * Eine offene Einladung liess sich bisher nur durch eine neue Einladung
 * derselben Adresse verdraengen. Zuruecknehmen ist der fehlende Gegenweg —
 * mit Audit-Eintrag und entwertetem Claim-Token.
 */
describe("Einladung zuruecknehmen", () => {
  it("setzt sie auf CANCELLED und entwertet den Claim-Token", async () => {
    const invitation = await service.invite({
      organizationId,
      data: { email: `zurueckgezogen-${randomUUID()}@example.test`, role: "MEMBER" },
      auth: ownerAuth,
      audit,
    });

    await service.cancelInvitation({ organizationId, invitationId: invitation.id, auth: ownerAuth, audit });

    const [stored] = await databaseService.database
      .select({ status: organizationInvitations.status, claimTokenHash: organizationInvitations.claimTokenHash })
      .from(organizationInvitations)
      .where(eq(organizationInvitations.id, invitation.id));
    expect(stored).toEqual({ status: "CANCELLED", claimTokenHash: null });

    const events = await databaseService.database
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, organizationId),
          eq(auditEvents.entityId, invitation.id),
          eq(auditEvents.action, "MEMBER_INVITATION_CANCELLED"),
        ),
      );
    expect(events).toHaveLength(1);
  }, 30_000);

  it("meldet eine bereits zurueckgezogene Einladung als nicht gefunden", async () => {
    const invitation = await service.invite({
      organizationId,
      data: { email: `doppelt-${randomUUID()}@example.test`, role: "MEMBER" },
      auth: ownerAuth,
      audit,
    });
    await service.cancelInvitation({ organizationId, invitationId: invitation.id, auth: ownerAuth, audit });

    await expect(
      service.cancelInvitation({ organizationId, invitationId: invitation.id, auth: ownerAuth, audit }),
    ).rejects.toBeInstanceOf(NotFoundException);
  }, 30_000);

  it("erreicht eine Einladung der eigenen Organisation nicht ueber eine fremde", async () => {
    const invitation = await service.invite({
      organizationId,
      data: { email: `fremd-${randomUUID()}@example.test`, role: "MEMBER" },
      auth: ownerAuth,
      audit,
    });

    // Die handelnde Person ist in der fremden Organisation kein Mitglied: die
    // Berechtigungspruefung greift vor der Zeile.
    await expect(
      service.cancelInvitation({ organizationId: foreignOrganizationId, invitationId: invitation.id, auth: ownerAuth, audit }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const [stored] = await databaseService.database
      .select({ status: organizationInvitations.status })
      .from(organizationInvitations)
      .where(eq(organizationInvitations.id, invitation.id));
    expect(stored?.status).toBe("PENDING");
  }, 30_000);

  it("listet die offenen Einladungen der Organisation", async () => {
    const email = `offen-${randomUUID()}@example.test`;
    const invitation = await service.invite({ organizationId, data: { email, role: "SCORER" }, auth: ownerAuth, audit });

    const open = await service.listOrganizationInvitations({ organizationId, auth: ownerAuth });
    expect(open.find((entry) => entry.id === invitation.id)).toMatchObject({ email, role: "SCORER", status: "PENDING" });

    await service.cancelInvitation({ organizationId, invitationId: invitation.id, auth: ownerAuth, audit });
    const afterCancel = await service.listOrganizationInvitations({ organizationId, auth: ownerAuth });
    expect(afterCancel.find((entry) => entry.id === invitation.id)).toBeUndefined();
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

  it("verlangt eine Anmeldung auch fuer Liste und Rueckzug", async () => {
    for (const request of [
      { method: "GET" as const, url: `/api/v1/organizations/${organizationId}/members` },
      { method: "GET" as const, url: `/api/v1/organizations/${organizationId}/invitations` },
      { method: "DELETE" as const, url: `/api/v1/organizations/${organizationId}/invitations/${randomUUID()}` },
    ]) {
      const response = await app.inject(request);
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ error: { code: "AUTHENTICATION_REQUIRED" } });
    }
  }, 30_000);

  it("liefert den einheitlichen Fehlerkoerper, wenn die handelnde Person die eigene Mitgliedschaft aendern will", async () => {
    // Kein eigener Session-Seam im Harness: die Anfrage wird ueber `app.get`
    // wie in `createApiTestApplication` selbst authentifiziert, indem
    // `AuthService.getSession` fuer diesen einen Test auf `managerAuth`
    // gestellt wird — dieselbe handelnde Person wie im gleichnamigen
    // Unit-Test oben, jetzt aber ueber die echte HTTP-Pipeline inklusive
    // globalem Fehlerfilter.
    const authService = app.get(AuthService);
    const sessionSpy = vi
      .spyOn(authService, "getSession")
      .mockResolvedValue(managerAuth);

    try {
      const response = await app.inject({
        method: "PATCH",
        url: `/api/v1/organizations/${organizationId}/members/${managerUserId}`,
        payload: { role: "MEMBER" },
      });

      expect(response.statusCode).toBe(403);
      const parsed = apiErrorSchema.parse(response.json());
      expect(parsed.error.code).toBe("SELF_MEMBERSHIP_CHANGE_FORBIDDEN");
      expect(parsed.error.message.length).toBeGreaterThan(0);
    } finally {
      sessionSpy.mockRestore();
    }
  }, 30_000);
});
