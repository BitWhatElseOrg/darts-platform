import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { memberships, organizations, users } from "@darts-platform/database";

import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { OrganizationsRepository } from "../organizations/organizations.repository.js";
import { OrganizationsService } from "../organizations/organizations.service.js";
import { PlayersRepository } from "./players.repository.js";
import { PlayersService } from "./players.service.js";

const databaseService = new DatabaseService(
  parseApplicationEnvironment(process.env),
);
const organizationsRepository = new OrganizationsRepository(databaseService);
const accessService = new OrganizationAccessService(organizationsRepository);
const organizationsService = new OrganizationsService(
  organizationsRepository,
  accessService,
);
const playersRepository = new PlayersRepository(databaseService);
const playersService = new PlayersService(playersRepository, accessService);
const ownerUserId = randomUUID();
const foreignUserId = randomUUID();
const ownerOrganizationId = randomUUID();
const foreignOrganizationId = randomUUID();
const ownerAuth: AuthContext = {
  user: {
    id: ownerUserId,
    email: `owner-${ownerUserId}@example.test`,
    name: "Owner",
  },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const audit = {
  correlationId: randomUUID(),
  ip: "127.0.0.1",
  userAgent: "vitest",
} as const;

beforeAll(async () => {
  await databaseService.database.insert(users).values([
    {
      id: ownerUserId,
      email: ownerAuth.user.email,
      displayName: ownerAuth.user.name,
    },
    {
      id: foreignUserId,
      email: `foreign-${foreignUserId}@example.test`,
      displayName: "Foreign User",
    },
  ]);
  await databaseService.database.insert(organizations).values([
    {
      id: ownerOrganizationId,
      name: "Owner Organization",
      slug: `owner-${ownerOrganizationId}`,
      timezone: "Europe/Zurich",
      locale: "de-CH",
    },
    {
      id: foreignOrganizationId,
      name: "Foreign Organization",
      slug: `foreign-${foreignOrganizationId}`,
      timezone: "Europe/Zurich",
      locale: "de-CH",
    },
  ]);
  await databaseService.database.insert(memberships).values([
    {
      organizationId: ownerOrganizationId,
      userId: ownerUserId,
      role: "OWNER",
      status: "ACTIVE",
    },
    {
      organizationId: foreignOrganizationId,
      userId: foreignUserId,
      role: "OWNER",
      status: "ACTIVE",
    },
  ]);
});

afterAll(async () => {
  await databaseService.database
    .delete(organizations)
    .where(eq(organizations.id, ownerOrganizationId));
  await databaseService.database
    .delete(organizations)
    .where(eq(organizations.id, foreignOrganizationId));
  await databaseService.database.delete(users).where(eq(users.id, ownerUserId));
  await databaseService.database.delete(users).where(eq(users.id, foreignUserId));
  await databaseService.onApplicationShutdown();
});

describe("player tenant isolation", () => {
  it("allows an owner to create and read a player in their organization", async () => {
    const player = await playersService.create({
      organizationId: ownerOrganizationId,
      data: { displayName: "Tenant Player", status: "ACTIVE" },
      auth: ownerAuth,
      audit,
    });

    const tenantPlayers = await playersService.list({
      organizationId: ownerOrganizationId,
      auth: ownerAuth,
    });

    expect(tenantPlayers).toContainEqual(player);
  });

  it("rejects the same authenticated user for another tenant", async () => {
    await expect(
      playersService.list({
        organizationId: foreignOrganizationId,
        auth: ownerAuth,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("accepts an email-bound invitation with a read-only role", async () => {
    const foreignEmail = `foreign-${foreignUserId}@example.test`;
    const invitation = await organizationsService.invite({
      organizationId: ownerOrganizationId,
      data: { email: foreignEmail, role: "VIEWER" },
      auth: ownerAuth,
      audit,
    });
    const foreignAuth: AuthContext = {
      user: { id: foreignUserId, email: foreignEmail, name: "Foreign User" },
      session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
    };

    await expect(
      organizationsService.acceptInvitation({
        invitationId: invitation.id,
        auth: foreignAuth,
        audit,
      }),
    ).resolves.toEqual({ accepted: true });
    await expect(
      playersService.list({
        organizationId: ownerOrganizationId,
        auth: foreignAuth,
      }),
    ).resolves.toHaveLength(1);
    await expect(
      playersService.create({
        organizationId: ownerOrganizationId,
        data: { displayName: "Forbidden Player", status: "ACTIVE" },
        auth: foreignAuth,
        audit,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
