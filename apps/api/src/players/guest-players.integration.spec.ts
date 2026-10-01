import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { OrganizationsRepository } from "../organizations/organizations.repository.js";
import { PlayersRepository } from "./players.repository.js";
import { PlayersService } from "./players.service.js";

const databaseService = new DatabaseService(parseApplicationEnvironment(process.env));
const access = new OrganizationAccessService(new OrganizationsRepository(databaseService));
const service = new PlayersService(new PlayersRepository(databaseService), access);
const organizationId = randomUUID();
const userId = randomUUID();
const auth: AuthContext = {
  user: { id: userId, email: `guests-${userId}@example.test`, name: "Owner" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const audit = {
  correlationId: randomUUID(),
  ip: "127.0.0.1",
  userAgent: "vitest",
} as const;

beforeAll(async () => {
  await databaseService.database
    .insert(users)
    .values({ id: userId, email: auth.user.email, displayName: auth.user.name });
  await databaseService.database.insert(organizations).values({
    id: organizationId,
    name: `Guests ${organizationId}`,
    slug: `guests-${organizationId}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });
  await databaseService.database
    .insert(memberships)
    .values({ organizationId, userId, role: "OWNER", status: "ACTIVE" });
});

afterAll(async () => {
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(users).where(eq(users.id, userId));
  await databaseService.onApplicationShutdown();
});

describe("Gastspieler-Schnellerfassung", () => {
  it("legt Gaeste idempotent an, auditiert einmal und blendet sie aus der Standardliste aus", async () => {
    const commandId = randomUUID();
    const input = {
      organizationId,
      data: { commandId, clubName: "DC Musterdorf", names: ["Anna Muster", "Beat Beispiel"] },
      auth,
      audit,
    };
    const [first, second] = await Promise.all([
      service.createGuests(input),
      service.createGuests(input),
    ]);
    expect(first.map((player) => player.displayName).sort()).toEqual(["Anna Muster", "Beat Beispiel"]);
    expect(second.map((player) => player.id).sort()).toEqual(first.map((player) => player.id).sort());
    expect(
      first.every(
        (player) =>
          player.kind === "GUEST" &&
          player.guestClubName === "DC Musterdorf" &&
          player.hasAccount === false,
      ),
    ).toBe(true);

    const rows = await databaseService.database
      .select()
      .from(players)
      .where(and(eq(players.organizationId, organizationId), eq(players.kind, "GUEST")));
    expect(rows).toHaveLength(2);
    const audits = await databaseService.database
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, organizationId),
          eq(auditEvents.action, "PLAYERS_GUESTS_CREATED"),
        ),
      );
    expect(audits).toHaveLength(1);

    await service.create({
      organizationId,
      data: { displayName: "Mitglied", status: "ACTIVE" },
      auth,
      audit,
    });
    expect((await service.list({ organizationId, auth })).map((player) => player.displayName)).toEqual(["Mitglied"]);
    expect(
      (await service.list({ organizationId, auth, kind: "GUEST" }))
        .map((player) => player.displayName)
        .sort(),
    ).toEqual(["Anna Muster", "Beat Beispiel"]);
    expect(await service.list({ organizationId, auth, kind: "ALL" })).toHaveLength(3);
  }, 30_000);

  it("verlangt player:create", async () => {
    const strangerId = randomUUID();
    const stranger: AuthContext = {
      user: { id: strangerId, email: `x-${strangerId}@example.test`, name: "X" },
      session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
    };
    await expect(
      service.createGuests({
        organizationId,
        data: { commandId: randomUUID(), clubName: "DC", names: ["Carla"] },
        auth: stranger,
        audit,
      }),
    ).rejects.toThrow();
  });
});
