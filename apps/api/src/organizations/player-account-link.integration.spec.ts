import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  memberships,
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
