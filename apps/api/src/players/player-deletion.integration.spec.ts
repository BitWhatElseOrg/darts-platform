import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  auditEvents,
  matchParticipantPlayers,
  matchParticipants,
  matches,
  memberships,
  organizationInvitations,
  organizations,
  playerAvatars,
  players,
  teamPlayers,
  teams,
  users,
} from "@darts-platform/database";

import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { OrganizationsRepository } from "../organizations/organizations.repository.js";
import { PlayersRepository } from "./players.repository.js";
import { PlayersService } from "./players.service.js";

/**
 * Deckt Task 2 ab (Spec 2026-09-24-bearbeiten-loeschen): das endgueltige
 * Loeschen eines Spielers ohne Historie, die 409-Sperre bei bestehender
 * Historie (Team- und Match-Teilnahme als zwei verschiedene RESTRICT-
 * Tabellen), die Rollenpruefung und die Mandantengrenze.
 */
const environment = parseApplicationEnvironment(process.env);
const databaseService = new DatabaseService(environment);
const organizationsRepository = new OrganizationsRepository(databaseService);
const accessService = new OrganizationAccessService(organizationsRepository);
const playersRepository = new PlayersRepository(databaseService);
const playersService = new PlayersService(playersRepository, accessService);

const ownerUserId = randomUUID();
const directorUserId = randomUUID();
const foreignUserId = randomUUID();
const orgA = randomUUID();
const orgB = randomUUID();

const ownerAuth: AuthContext = {
  user: { id: ownerUserId, email: `owner-${ownerUserId}@example.test`, name: "Owner" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const directorAuth: AuthContext = {
  user: { id: directorUserId, email: `director-${directorUserId}@example.test`, name: "Director" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const foreignAuth: AuthContext = {
  user: { id: foreignUserId, email: `foreign-${foreignUserId}@example.test`, name: "Foreign" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const audit = {
  correlationId: randomUUID(),
  ip: "127.0.0.1",
  userAgent: "vitest",
} as const;

const db = databaseService.database;

beforeAll(async () => {
  await db.insert(users).values([
    { id: ownerUserId, email: ownerAuth.user.email, displayName: "Owner" },
    { id: directorUserId, email: directorAuth.user.email, displayName: "Director" },
    { id: foreignUserId, email: foreignAuth.user.email, displayName: "Foreign" },
  ]);
  await db.insert(organizations).values([
    { id: orgA, name: "Org A", slug: `org-a-${orgA}`, timezone: "Europe/Zurich", locale: "de-CH" },
    { id: orgB, name: "Org B", slug: `org-b-${orgB}`, timezone: "Europe/Zurich", locale: "de-CH" },
  ]);
  await db.insert(memberships).values([
    { organizationId: orgA, userId: ownerUserId, role: "OWNER", status: "ACTIVE" },
    { organizationId: orgA, userId: directorUserId, role: "TOURNAMENT_DIRECTOR", status: "ACTIVE" },
    { organizationId: orgB, userId: foreignUserId, role: "OWNER", status: "ACTIVE" },
  ]);
});

afterAll(async () => {
  await db.delete(organizations).where(eq(organizations.id, orgA));
  await db.delete(organizations).where(eq(organizations.id, orgB));
  await db.delete(users).where(eq(users.id, ownerUserId));
  await db.delete(users).where(eq(users.id, directorUserId));
  await db.delete(users).where(eq(users.id, foreignUserId));
  await databaseService.onApplicationShutdown();
});

describe("Spieler endgueltig loeschen", () => {
  it("deletes a player without history, with avatar and audit", async () => {
    const [player] = await db
      .insert(players)
      .values({ organizationId: orgA, displayName: "Ohne Historie", status: "ACTIVE" })
      .returning();
    await db.insert(playerAvatars).values({
      organizationId: orgA,
      playerId: player!.id,
      contentType: "image/webp",
      bytes: Buffer.from([1, 2, 3]),
      byteSize: 3,
      checksum: "abc",
    });
    const [invitation] = await db
      .insert(organizationInvitations)
      .values({
        organizationId: orgA,
        email: `invited-${randomUUID()}@example.test`,
        role: "MEMBER",
        playerId: player!.id,
        claimTokenHash: "a".repeat(64),
        invitedByUserId: ownerUserId,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();

    await playersService.deletePermanently({
      organizationId: orgA,
      playerId: player!.id,
      auth: ownerAuth,
      audit,
    });

    expect(await db.select().from(players).where(eq(players.id, player!.id))).toEqual([]);
    expect(
      await db.select().from(playerAvatars).where(eq(playerAvatars.playerId, player!.id)),
    ).toEqual([]);
    const [after] = await db
      .select()
      .from(organizationInvitations)
      .where(eq(organizationInvitations.id, invitation!.id));
    expect(after?.playerId).toBeNull();
    const [event] = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, player!.id), eq(auditEvents.action, "PLAYER_DELETED")));
    expect(event?.organizationId).toBe(orgA);
    expect(event?.actorUserId).toBe(ownerUserId);
    expect(event?.newValue).toBeNull();
  });

  it("refuses a player with team history with 409 PLAYER_HAS_HISTORY and keeps him", async () => {
    const [player] = await db
      .insert(players)
      .values({ organizationId: orgA, displayName: "Mit Kaderhistorie", status: "ACTIVE" })
      .returning();
    const [team] = await db
      .insert(teams)
      .values({ organizationId: orgA, name: `Team ${randomUUID()}` })
      .returning();
    await db.insert(teamPlayers).values({
      organizationId: orgA,
      teamId: team!.id,
      playerId: player!.id,
    });

    await expect(
      playersService.deletePermanently({
        organizationId: orgA,
        playerId: player!.id,
        auth: ownerAuth,
        audit,
      }),
    ).rejects.toMatchObject({ status: 409, response: { code: "PLAYER_HAS_HISTORY" } });

    expect(await db.select().from(players).where(eq(players.id, player!.id))).toHaveLength(1);
    const events = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, player!.id), eq(auditEvents.action, "PLAYER_DELETED")));
    expect(events).toEqual([]);
  });

  it("refuses a player with match history with 409 PLAYER_HAS_HISTORY and keeps him", async () => {
    const [playerOne] = await db
      .insert(players)
      .values({ organizationId: orgA, displayName: "Spieler Eins", status: "ACTIVE" })
      .returning();
    const [playerTwo] = await db
      .insert(players)
      .values({ organizationId: orgA, displayName: "Spieler Zwei", status: "ACTIVE" })
      .returning();
    const [match] = await db
      .insert(matches)
      .values({ organizationId: orgA, bestOfLegs: 1, startingSeat: 1 })
      .returning();
    const [participantOne] = await db
      .insert(matchParticipants)
      .values({ organizationId: orgA, matchId: match!.id, seat: 1 })
      .returning();
    const [participantTwo] = await db
      .insert(matchParticipants)
      .values({ organizationId: orgA, matchId: match!.id, seat: 2 })
      .returning();
    await db.insert(matchParticipantPlayers).values([
      {
        organizationId: orgA,
        matchId: match!.id,
        participantId: participantOne!.id,
        playerId: playerOne!.id,
        position: 1,
      },
      {
        organizationId: orgA,
        matchId: match!.id,
        participantId: participantTwo!.id,
        playerId: playerTwo!.id,
        position: 1,
      },
    ]);

    await expect(
      playersService.deletePermanently({
        organizationId: orgA,
        playerId: playerOne!.id,
        auth: ownerAuth,
        audit,
      }),
    ).rejects.toMatchObject({ status: 409, response: { code: "PLAYER_HAS_HISTORY" } });

    expect(await db.select().from(players).where(eq(players.id, playerOne!.id))).toHaveLength(1);
  });

  it("forbids roles without player:delete", async () => {
    const [player] = await db
      .insert(players)
      .values({ organizationId: orgA, displayName: "Kein Zugriff", status: "ACTIVE" })
      .returning();

    await expect(
      playersService.deletePermanently({
        organizationId: orgA,
        playerId: player!.id,
        auth: directorAuth,
        audit,
      }),
    ).rejects.toMatchObject({ status: 403 });

    expect(await db.select().from(players).where(eq(players.id, player!.id))).toHaveLength(1);
  });

  it("answers 404 for a player of another organization", async () => {
    const [foreignPlayer] = await db
      .insert(players)
      .values({ organizationId: orgB, displayName: "Fremd", status: "ACTIVE" })
      .returning();

    await expect(
      playersService.deletePermanently({
        organizationId: orgA,
        playerId: foreignPlayer!.id,
        auth: ownerAuth,
        audit,
      }),
    ).rejects.toMatchObject({ status: 404 });

    expect(await db.select().from(players).where(eq(players.id, foreignPlayer!.id))).toHaveLength(1);
  });
});
