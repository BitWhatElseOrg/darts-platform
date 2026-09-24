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

/**
 * Regressionsschutz fuer den Fund aus dem Whole-Branch-Review am
 * 2026-09-24: `updatePlayerSchema` liess ueber `createPlayerSchema.partial()`
 * den Default `status: "ACTIVE"` durchsickern, sodass jede Bearbeitung ohne
 * Statusfeld (genau das, was `PlayerEditDialog` schickt) einen archivierten
 * Spieler stillschweigend reaktivierte. Die Reparatur entfernt den Default im
 * Update-Schema (`packages/schemas/src/player.ts`); dieser Test deckt das auf
 * DB-Ebene ab, damit ein Rueckfall im Repository (`players.repository.ts`,
 * `update()`) sofort auffaellt.
 */
const environment = parseApplicationEnvironment(process.env);
const databaseService = new DatabaseService(environment);
const organizationsRepository = new OrganizationsRepository(databaseService);
const accessService = new OrganizationAccessService(organizationsRepository);
const playersRepository = new PlayersRepository(databaseService);
const playersService = new PlayersService(playersRepository, accessService);

const ownerUserId = randomUUID();
const organizationId = randomUUID();

const ownerAuth: AuthContext = {
  user: { id: ownerUserId, email: `owner-${ownerUserId}@example.test`, name: "Owner" },
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
  ]);
  await db.insert(organizations).values([
    {
      id: organizationId,
      name: "Status Update Org",
      slug: `status-update-${organizationId}`,
      timezone: "Europe/Zurich",
      locale: "de-CH",
    },
  ]);
  await db.insert(memberships).values([
    { organizationId, userId: ownerUserId, role: "OWNER", status: "ACTIVE" },
  ]);
});

afterAll(async () => {
  await db.delete(organizations).where(eq(organizations.id, organizationId));
  await db.delete(users).where(eq(users.id, ownerUserId));
  await databaseService.onApplicationShutdown();
});

describe("Bearbeiten eines archivierten Spielers", () => {
  it("bleibt INACTIVE, wenn ein Update ohne Statusfeld gesendet wird", async () => {
    const created = await playersService.create({
      organizationId,
      data: { displayName: "Archivierte Anna", status: "ACTIVE" },
      auth: ownerAuth,
      audit,
    });

    const archived = await playersService.archive({
      organizationId,
      playerId: created.id,
      auth: ownerAuth,
      audit,
    });
    expect(archived.status).toBe("INACTIVE");

    const updated = await playersService.update({
      organizationId,
      playerId: created.id,
      data: { displayName: "Archivierte Anna B." },
      auth: ownerAuth,
      audit,
    });

    expect(updated.status).toBe("INACTIVE");
    expect(updated.displayName).toBe("Archivierte Anna B.");
  });

  it("reaktiviert weiterhin, wenn der Status ausdruecklich mitgeschickt wird", async () => {
    const created = await playersService.create({
      organizationId,
      data: { displayName: "Reaktivierbare Berta", status: "ACTIVE" },
      auth: ownerAuth,
      audit,
    });
    await playersService.archive({
      organizationId,
      playerId: created.id,
      auth: ownerAuth,
      audit,
    });

    const updated = await playersService.update({
      organizationId,
      playerId: created.id,
      data: { status: "ACTIVE" },
      auth: ownerAuth,
      audit,
    });

    expect(updated.status).toBe("ACTIVE");
  });
});
