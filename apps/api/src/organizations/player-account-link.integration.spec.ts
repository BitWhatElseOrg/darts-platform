import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  auditEvents,
  memberships,
  organizationInvitations,
  organizations,
  players,
  users,
} from "@darts-platform/database";

import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { PlayersRepository } from "../players/players.repository.js";
import { PlayersService } from "../players/players.service.js";
import { OrganizationAccessService } from "./organization-access.service.js";
import { OrganizationsRepository } from "./organizations.repository.js";
import { OrganizationsService } from "./organizations.service.js";

const environment = parseApplicationEnvironment(process.env);
const databaseService = new DatabaseService(environment);
const organizationsRepository = new OrganizationsRepository(databaseService);
const accessService = new OrganizationAccessService(organizationsRepository);
const organizationsService = new OrganizationsService(
  organizationsRepository,
  accessService,
  environment,
);
const playersRepository = new PlayersRepository(databaseService);
const playersService = new PlayersService(playersRepository, accessService);

const organizationId = randomUUID();
const foreignOrganizationId = randomUUID();
const ownerUserId = randomUUID();
const memberUserId = randomUUID();

function authFor(userId: string, name: string): AuthContext {
  return {
    user: { id: userId, email: `${name}-${userId}@example.test`, name },
    session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
  };
}

const ownerAuth = authFor(ownerUserId, "owner");
const memberAuth = authFor(memberUserId, "member");
const audit = {
  correlationId: randomUUID(),
  ip: "127.0.0.1",
  userAgent: "vitest",
} as const;

/** Der Spieler, der im ganzen File mit `memberUserId` verknuepft ist. */
let linkedPlayerId = "";
/** Ein Spieler derselben Organisation ohne Konto. */
let unlinkedPlayerId = "";

beforeAll(async () => {
  await databaseService.database.insert(users).values([
    { id: ownerUserId, email: ownerAuth.user.email, displayName: "Owner" },
    { id: memberUserId, email: memberAuth.user.email, displayName: "Mitglied" },
  ]);
  await databaseService.database.insert(organizations).values([
    {
      id: organizationId,
      name: "Verknuepfungs Club",
      slug: `link-${organizationId}`,
      timezone: "Europe/Zurich",
      locale: "de-CH",
    },
    {
      id: foreignOrganizationId,
      name: "Fremder Club",
      slug: `link-foreign-${foreignOrganizationId}`,
      timezone: "Europe/Zurich",
      locale: "de-CH",
    },
  ]);
  await databaseService.database.insert(memberships).values([
    { organizationId, userId: ownerUserId, role: "OWNER", status: "ACTIVE" },
    { organizationId, userId: memberUserId, role: "MEMBER", status: "ACTIVE" },
  ]);

  const [linked] = await databaseService.database
    .insert(players)
    .values({
      organizationId,
      displayName: "V. Erknuepft",
      email: "kontoadresse-darf-nicht-abfliessen@example.test",
      status: "ACTIVE",
      userId: memberUserId,
    })
    .returning({ id: players.id });
  const [unlinked] = await databaseService.database
    .insert(players)
    .values({ organizationId, displayName: "O. Hnekonto", status: "ACTIVE" })
    .returning({ id: players.id });

  linkedPlayerId = linked?.id ?? "";
  unlinkedPlayerId = unlinked?.id ?? "";
});

afterAll(async () => {
  await databaseService.database
    .delete(organizations)
    .where(eq(organizations.id, organizationId));
  await databaseService.database
    .delete(organizations)
    .where(eq(organizations.id, foreignOrganizationId));
  for (const userId of [ownerUserId, memberUserId]) {
    await databaseService.database.delete(users).where(eq(users.id, userId));
  }
  await databaseService.onApplicationShutdown();
});

describe("Lesemodelle der Verknuepfung", () => {
  it("meldet je Spieler, ob ein Konto zugeordnet ist", async () => {
    const list = await playersService.list({ organizationId, auth: ownerAuth });

    expect(list.find((player) => player.id === linkedPlayerId)).toMatchObject({
      hasAccount: true,
    });
    expect(list.find((player) => player.id === unlinkedPlayerId)).toMatchObject({
      hasAccount: false,
    });
  }, 30_000);

  it("gibt ueber die Spielerliste keine Kontokennung preis", async () => {
    const list = await playersService.list({ organizationId, auth: ownerAuth });
    const linked = list.find((player) => player.id === linkedPlayerId);

    // `player:read` haben auch MEMBER und VIEWER. Die Kontokennung gehoert
    // hinter `organization:manage_members` und darf hier nicht auftauchen.
    expect(linked).not.toHaveProperty("userId");
    expect(JSON.stringify(linked)).not.toContain(memberUserId);
  }, 30_000);

  it("nennt der verknuepften Person ihr eigenes Spielerprofil", async () => {
    const [summary] = await organizationsService.list(memberAuth);

    expect(summary).toMatchObject({ id: organizationId, playerId: linkedPlayerId });
  }, 30_000);

  it("laesst playerId null, solange kein Profil verknuepft ist", async () => {
    const [summary] = await organizationsService.list(ownerAuth);

    expect(summary).toMatchObject({ id: organizationId, playerId: null });
  }, 30_000);

  it("zeigt in der Mitgliederliste das zugeordnete Profil", async () => {
    const members = await organizationsService.listMembers({
      organizationId,
      auth: ownerAuth,
    });

    expect(members.find((member) => member.userId === memberUserId)).toMatchObject({
      player: { id: linkedPlayerId, displayName: "V. Erknuepft" },
    });
    expect(members.find((member) => member.userId === ownerUserId)).toMatchObject({
      player: null,
    });
  }, 30_000);

  it("zieht die Verknuepfung nicht in eine andere Organisation", async () => {
    // Dasselbe Konto, ein eigenes Profil im fremden Verein: die Zusammenfassung
    // jeder Organisation nennt nur ihr eigenes (AGENTS.md §14).
    await databaseService.database.insert(memberships).values({
      organizationId: foreignOrganizationId,
      userId: memberUserId,
      role: "MEMBER",
      status: "ACTIVE",
    });
    const [foreignPlayer] = await databaseService.database
      .insert(players)
      .values({
        organizationId: foreignOrganizationId,
        displayName: "Dieselbe Person anderswo",
        status: "ACTIVE",
        userId: memberUserId,
      })
      .returning({ id: players.id });

    const summaries = await organizationsService.list(memberAuth);

    expect(
      summaries.find((summary) => summary.id === organizationId)?.playerId,
    ).toBe(linkedPlayerId);
    expect(
      summaries.find((summary) => summary.id === foreignOrganizationId)?.playerId,
    ).toBe(foreignPlayer?.id);

    await databaseService.database
      .delete(players)
      .where(
        and(
          eq(players.organizationId, foreignOrganizationId),
          eq(players.userId, memberUserId),
        ),
      );
    await databaseService.database
      .delete(memberships)
      .where(
        and(
          eq(memberships.organizationId, foreignOrganizationId),
          eq(memberships.userId, memberUserId),
        ),
      );
  }, 30_000);
});

describe("Einladung mit Spielerbezug", () => {
  /** Legt Konto und Spieler an, die nur dieser eine Test benutzt. */
  async function freshCandidate(label: string) {
    const userId = randomUUID();
    const auth = authFor(userId, label);
    await databaseService.database
      .insert(users)
      .values({ id: userId, email: auth.user.email, displayName: label });
    const [player] = await databaseService.database
      .insert(players)
      .values({ organizationId, displayName: `Profil ${label}`, status: "ACTIVE" })
      .returning({ id: players.id });
    return { userId, auth, playerId: player?.id ?? "" };
  }

  async function invitationStatus(invitationId: string) {
    const [row] = await databaseService.database
      .select({ status: organizationInvitations.status })
      .from(organizationInvitations)
      .where(eq(organizationInvitations.id, invitationId));
    return row?.status;
  }

  it("verknuepft Konto und Profil beim Annehmen", async () => {
    const candidate = await freshCandidate("annahme");
    const invitation = await organizationsService.invite({
      organizationId,
      data: {
        email: candidate.auth.user.email,
        role: "MEMBER",
        playerId: candidate.playerId,
      },
      auth: ownerAuth,
      audit,
    });

    await organizationsService.acceptInvitation({
      invitationId: invitation.id,
      data: { claimToken: invitation.claimToken },
      auth: candidate.auth,
      audit,
    });

    const [player] = await databaseService.database
      .select({ userId: players.userId })
      .from(players)
      .where(eq(players.id, candidate.playerId));
    expect(player?.userId).toBe(candidate.userId);

    const [summary] = await organizationsService.list(candidate.auth);
    expect(summary?.playerId).toBe(candidate.playerId);

    const linkEvents = await databaseService.database
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, organizationId),
          eq(auditEvents.entityId, candidate.playerId),
          eq(auditEvents.action, "PLAYER_LINKED"),
        ),
      );
    expect(linkEvents).toHaveLength(1);
  }, 30_000);

  it("weist eine Einladung auf ein organisationsfremdes Profil ab", async () => {
    const [foreignPlayer] = await databaseService.database
      .insert(players)
      .values({
        organizationId: foreignOrganizationId,
        displayName: "Fremdes Profil",
        status: "ACTIVE",
      })
      .returning({ id: players.id });

    await expect(
      organizationsService.invite({
        organizationId,
        data: {
          email: `fremd-${randomUUID()}@example.test`,
          role: "MEMBER",
          playerId: foreignPlayer?.id ?? "",
        },
        auth: ownerAuth,
        audit,
      }),
    ).rejects.toMatchObject({
      response: { code: "PLAYER_NOT_ASSIGNABLE" },
    });
  }, 30_000);

  it("weist eine Einladung auf ein bereits vergebenes Profil ab", async () => {
    await expect(
      organizationsService.invite({
        organizationId,
        data: {
          email: `vergeben-${randomUUID()}@example.test`,
          role: "MEMBER",
          playerId: linkedPlayerId,
        },
        auth: ownerAuth,
        audit,
      }),
    ).rejects.toMatchObject({ response: { code: "PLAYER_NOT_ASSIGNABLE" } });
  }, 30_000);

  it("laesst die Einladung offen, wenn das Profil inzwischen fremd vergeben ist", async () => {
    const candidate = await freshCandidate("konflikt");
    const invitation = await organizationsService.invite({
      organizationId,
      data: {
        email: candidate.auth.user.email,
        role: "MEMBER",
        playerId: candidate.playerId,
      },
      auth: ownerAuth,
      audit,
    });

    // Zwischen Einladen und Annehmen: jemand anderes bekommt das Profil.
    const otherUserId = randomUUID();
    await databaseService.database.insert(users).values({
      id: otherUserId,
      email: `andere-${otherUserId}@example.test`,
      displayName: "Andere Person",
    });
    await databaseService.database
      .update(players)
      .set({ userId: otherUserId })
      .where(eq(players.id, candidate.playerId));

    await expect(
      organizationsService.acceptInvitation({
        invitationId: invitation.id,
        data: { claimToken: invitation.claimToken },
        auth: candidate.auth,
        audit,
      }),
    ).rejects.toMatchObject({ response: { code: "PLAYER_ALREADY_LINKED" } });

    // Die Einladung gilt weiter, damit sie nach dem Aufraeumen noch wirkt.
    expect(await invitationStatus(invitation.id)).toBe("PENDING");
    const [membership] = await databaseService.database
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.userId, candidate.userId),
        ),
      );
    expect(membership).toBeUndefined();

    await databaseService.database
      .update(players)
      .set({ userId: null })
      .where(eq(players.id, candidate.playerId));
    await databaseService.database.delete(users).where(eq(users.id, otherUserId));
  }, 30_000);

  it("laesst die Einladung offen, wenn das Profil inzwischen archiviert ist", async () => {
    const candidate = await freshCandidate("archiviert");
    const invitation = await organizationsService.invite({
      organizationId,
      data: {
        email: candidate.auth.user.email,
        role: "MEMBER",
        playerId: candidate.playerId,
      },
      auth: ownerAuth,
      audit,
    });

    await databaseService.database
      .update(players)
      .set({ status: "INACTIVE" })
      .where(eq(players.id, candidate.playerId));

    await expect(
      organizationsService.acceptInvitation({
        invitationId: invitation.id,
        data: { claimToken: invitation.claimToken },
        auth: candidate.auth,
        audit,
      }),
    ).rejects.toMatchObject({ response: { code: "PLAYER_NOT_ASSIGNABLE" } });
    expect(await invitationStatus(invitation.id)).toBe("PENDING");
  }, 30_000);

  it("nimmt eine Einladung ohne Spielerbezug unveraendert an", async () => {
    const candidate = await freshCandidate("ohne-bezug");
    const invitation = await organizationsService.invite({
      organizationId,
      data: { email: candidate.auth.user.email, role: "MEMBER" },
      auth: ownerAuth,
      audit,
    });

    await organizationsService.acceptInvitation({
      invitationId: invitation.id,
      data: { claimToken: invitation.claimToken },
      auth: candidate.auth,
      audit,
    });

    const [summary] = await organizationsService.list(candidate.auth);
    expect(summary?.playerId).toBeNull();
  }, 30_000);

  it("nimmt eine Einladung an, deren Profil inzwischen geloescht wurde", async () => {
    const candidate = await freshCandidate("geloescht");
    const invitation = await organizationsService.invite({
      organizationId,
      data: {
        email: candidate.auth.user.email,
        role: "MEMBER",
        playerId: candidate.playerId,
      },
      auth: ownerAuth,
      audit,
    });

    // `on delete set null` traegt die Einladung, statt sie mitzureissen.
    await databaseService.database
      .delete(players)
      .where(eq(players.id, candidate.playerId));

    await organizationsService.acceptInvitation({
      invitationId: invitation.id,
      data: { claimToken: invitation.claimToken },
      auth: candidate.auth,
      audit,
    });

    expect(await invitationStatus(invitation.id)).toBe("ACCEPTED");
    const [summary] = await organizationsService.list(candidate.auth);
    expect(summary?.playerId).toBeNull();
  }, 30_000);
});
