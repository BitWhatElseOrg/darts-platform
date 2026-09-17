import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { memberships, organizations, users } from "@darts-platform/database";

import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { OrganizationsRepository } from "../organizations/organizations.repository.js";
import { PlayersRepository } from "./players.repository.js";
import { PlayersService } from "./players.service.js";

const environment = parseApplicationEnvironment(process.env);
const databaseService = new DatabaseService(environment);
const organizationsRepository = new OrganizationsRepository(databaseService);
const accessService = new OrganizationAccessService(organizationsRepository);
const playersRepository = new PlayersRepository(databaseService);
const playersService = new PlayersService(playersRepository, accessService);

const ownerUserId = randomUUID();
const organizationId = randomUUID();
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

let playerId: string;

beforeAll(async () => {
  await databaseService.database.insert(users).values({
    id: ownerUserId,
    email: ownerAuth.user.email,
    displayName: ownerAuth.user.name,
  });
  await databaseService.database.insert(organizations).values({
    id: organizationId,
    name: "Avatar Organization",
    slug: `avatar-${organizationId}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });
  await databaseService.database.insert(memberships).values({
    organizationId,
    userId: ownerUserId,
    role: "OWNER",
    status: "ACTIVE",
  });

  const player = await playersService.create({
    organizationId,
    data: { displayName: "Avatar Player", status: "ACTIVE" },
    auth: ownerAuth,
    audit,
  });
  playerId = player.id;
});

afterAll(async () => {
  await databaseService.database
    .delete(organizations)
    .where(eq(organizations.id, organizationId));
  await databaseService.database.delete(users).where(eq(users.id, ownerUserId));
  await databaseService.onApplicationShutdown();
});

describe("player avatar checksum", () => {
  it("meldet ohne Bild avatarChecksum als null", async () => {
    const player = await playersService.get({
      organizationId,
      playerId,
      auth: ownerAuth,
    });

    expect(player.avatarChecksum).toBeNull();
  });

  it("meldet avatarChecksum auch in der Spielerliste als null", async () => {
    const list = await playersService.list({ organizationId, auth: ownerAuth });

    expect(list.find((entry) => entry.id === playerId)?.avatarChecksum).toBeNull();
  });
});
