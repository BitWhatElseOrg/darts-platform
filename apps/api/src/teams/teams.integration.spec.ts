import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  auditEvents,
  memberships,
  organizations,
  players,
  teamPlayers,
  users,
} from "@darts-platform/database";

import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { OrganizationsRepository } from "../organizations/organizations.repository.js";
import { TeamsRepository } from "./teams.repository.js";
import { TeamsService } from "./teams.service.js";

const databaseService = new DatabaseService(parseApplicationEnvironment(process.env));
const access = new OrganizationAccessService(new OrganizationsRepository(databaseService));
const service = new TeamsService(new TeamsRepository(databaseService), access);

const organizationId = randomUUID();
const foreignOrganizationId = randomUUID();
const userId = randomUUID();
const scorerUserId = randomUUID();
const playerIds = Array.from({ length: 3 }, () => randomUUID());
const foreignPlayerId = randomUUID();

const auth: AuthContext = {
  user: { id: userId, email: `teams-${userId}@example.test`, name: "Team Owner" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const scorerAuth: AuthContext = {
  user: { id: scorerUserId, email: `scorer-${scorerUserId}@example.test`, name: "Team Scorer" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const audit = { correlationId: randomUUID(), ip: "127.0.0.1", userAgent: "vitest" } as const;

beforeAll(async () => {
  await databaseService.database.insert(users).values([
    { id: userId, email: auth.user.email, displayName: auth.user.name },
    { id: scorerUserId, email: scorerAuth.user.email, displayName: scorerAuth.user.name },
  ]);
  await databaseService.database.insert(organizations).values([
    { id: organizationId, name: "Team Club", slug: `teams-${organizationId}`, timezone: "Europe/Zurich", locale: "de-CH" },
    { id: foreignOrganizationId, name: "Foreign Team Club", slug: `foreign-teams-${foreignOrganizationId}`, timezone: "Europe/Zurich", locale: "de-CH" },
  ]);
  await databaseService.database.insert(memberships).values([
    { organizationId, userId, role: "OWNER", status: "ACTIVE" },
    { organizationId, userId: scorerUserId, role: "SCORER", status: "ACTIVE" },
  ]);
  await databaseService.database.insert(players).values([
    ...playerIds.map((id, index) => ({ id, organizationId, displayName: `Kader ${index + 1}`, status: "ACTIVE" })),
    { id: foreignPlayerId, organizationId: foreignOrganizationId, displayName: "Fremde Person", status: "ACTIVE" },
  ]);
});

afterAll(async () => {
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(organizations).where(eq(organizations.id, foreignOrganizationId));
  await databaseService.database.delete(users).where(eq(users.id, userId));
  await databaseService.database.delete(users).where(eq(users.id, scorerUserId));
  await databaseService.onApplicationShutdown();
});

async function createTeam(name: string): Promise<string> {
  const team = await service.create({
    organizationId,
    data: { name, shortName: name.slice(0, 3).toUpperCase() },
    auth,
    audit,
  });
  return team.id;
}

describe("teams and squads", () => {
  it("creates a team, adds a captain and audits both", async () => {
    const teamId = await createTeam(`Bulls ${randomUUID().slice(0, 8)}`);
    const withCaptain = await service.addMember({
      organizationId,
      teamId,
      data: { playerId: playerIds[0]!, role: "CAPTAIN" },
      auth,
      audit,
    });
    expect(withCaptain.members).toHaveLength(1);
    expect(withCaptain.members[0]).toMatchObject({
      playerId: playerIds[0],
      role: "CAPTAIN",
      validTo: null,
    });

    const actions = await databaseService.database
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(and(eq(auditEvents.organizationId, organizationId), eq(auditEvents.entityId, teamId)));
    expect(actions.map((row) => row.action)).toEqual(
      expect.arrayContaining(["TEAM_CREATED", "TEAM_MEMBER_ADDED"]),
    );
  }, 30_000);

  it("refuses a second active membership for the same person", async () => {
    const teamId = await createTeam(`Cobras ${randomUUID().slice(0, 8)}`);
    await service.addMember({
      organizationId,
      teamId,
      data: { playerId: playerIds[0]!, role: "PLAYER" },
      auth,
      audit,
    });
    await expect(
      service.addMember({
        organizationId,
        teamId,
        data: { playerId: playerIds[0]!, role: "PLAYER" },
        auth,
        audit,
      }),
    ).rejects.toMatchObject({ response: { code: "TEAM_PLAYER_ALREADY_MEMBER" } });
  }, 30_000);

  it("refuses a person from another organization", async () => {
    const teamId = await createTeam(`Falcons ${randomUUID().slice(0, 8)}`);
    await expect(
      service.addMember({
        organizationId,
        teamId,
        data: { playerId: foreignPlayerId, role: "PLAYER" },
        auth,
        audit,
      }),
    ).rejects.toMatchObject({ response: { code: "NOT_FOUND" } });
  }, 30_000);

  /**
   * Der Austritt wird datiert, nicht gelöscht: eine Aufstellung wird gegen den
   * Kader zum Ansetzungszeitpunkt geprüft, und vergangene Begegnungen dürfen
   * dadurch nicht ungültig werden.
   */
  it("dates a squad exit instead of deleting it and lets the person rejoin", async () => {
    const teamId = await createTeam(`Dragons ${randomUUID().slice(0, 8)}`);
    await service.addMember({
      organizationId,
      teamId,
      data: { playerId: playerIds[1]!, role: "PLAYER", validFrom: new Date("2026-01-01T00:00:00.000Z") },
      auth,
      audit,
    });
    const removed = await service.removeMember({
      organizationId,
      teamId,
      playerId: playerIds[1]!,
      auth,
      audit,
    });
    expect(removed.members).toHaveLength(1);
    expect(removed.members[0]?.validTo).not.toBeNull();

    const rejoined = await service.addMember({
      organizationId,
      teamId,
      data: { playerId: playerIds[1]!, role: "CAPTAIN" },
      auth,
      audit,
    });
    expect(rejoined.members).toHaveLength(2);
    expect(rejoined.members.filter((member) => member.validTo === null)).toHaveLength(1);

    const rows = await databaseService.database
      .select({ validTo: teamPlayers.validTo })
      .from(teamPlayers)
      .where(and(eq(teamPlayers.organizationId, organizationId), eq(teamPlayers.teamId, teamId)));
    expect(rows).toHaveLength(2);
  }, 30_000);

  it("refuses to remove a person who is not on the squad", async () => {
    const teamId = await createTeam(`Eagles ${randomUUID().slice(0, 8)}`);
    await expect(
      service.removeMember({
        organizationId,
        teamId,
        playerId: playerIds[2]!,
        auth,
        audit,
      }),
    ).rejects.toMatchObject({ response: { code: "NOT_FOUND" } });
  }, 30_000);

  it("archives a team through an update", async () => {
    const teamId = await createTeam(`Hawks ${randomUUID().slice(0, 8)}`);
    const archived = await service.update({
      organizationId,
      teamId,
      data: { status: "ARCHIVED", shortName: null },
      auth,
      audit,
    });
    expect(archived).toMatchObject({ status: "ARCHIVED", shortName: null });
  }, 30_000);

  /** Ausgeblendete Bedienelemente wären keine Autorisierungsgrenze. */
  it("lets a scorer read teams but never manage them", async () => {
    const teamId = await createTeam(`Owls ${randomUUID().slice(0, 8)}`);
    await expect(service.list({ organizationId, auth: scorerAuth })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: teamId })]),
    );
    await expect(
      service.update({ organizationId, teamId, data: { name: "Neu" }, auth: scorerAuth, audit }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.addMember({
        organizationId,
        teamId,
        data: { playerId: playerIds[2]!, role: "PLAYER" },
        auth: scorerAuth,
        audit,
      }),
    ).rejects.toMatchObject({ status: 403 });
  }, 30_000);

  /**
   * Eine Mannschaft hat einen Captain. Ohne diese Regel meldet die Fläche —
   * deren Rollenauswahl stehen bleibt — versehentlich einen ganzen Kader
   * voller Captains.
   */
  it("refuses a second captain on the same squad", async () => {
    const teamId = await createTeam(`Captains ${randomUUID().slice(0, 8)}`);
    await service.addMember({
      organizationId,
      teamId,
      data: { playerId: playerIds[0]!, role: "CAPTAIN" },
      auth,
      audit,
    });

    await expect(
      service.addMember({
        organizationId,
        teamId,
        data: { playerId: playerIds[1]!, role: "CAPTAIN" },
        auth,
        audit,
      }),
    ).rejects.toMatchObject({ response: { code: "TEAM_CAPTAIN_TAKEN" }, status: 409 });

    // Ohne Captain-Rolle bleibt dieselbe Person aufnehmbar.
    await expect(
      service.addMember({
        organizationId,
        teamId,
        data: { playerId: playerIds[1]!, role: "PLAYER" },
        auth,
        audit,
      }),
    ).resolves.toMatchObject({ id: teamId });
  }, 30_000);
});
