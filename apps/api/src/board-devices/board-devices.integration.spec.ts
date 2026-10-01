import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { auditEvents, boardDevices, boards, memberships, organizations, users } from "@darts-platform/database";
import { hashBoardDeviceSecret } from "@darts-platform/domain/board-device-secret";

import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { OrganizationsRepository } from "../organizations/organizations.repository.js";
import { BoardDevicesRepository } from "./board-devices.repository.js";
import { BoardDevicesService } from "./board-devices.service.js";

const databaseService = new DatabaseService(parseApplicationEnvironment(process.env));
const service = new BoardDevicesService(
  new BoardDevicesRepository(databaseService),
  new OrganizationAccessService(new OrganizationsRepository(databaseService)),
);

const organizationId = randomUUID();
const foreignOrganizationId = randomUUID();
const userId = randomUUID();
const memberUserId = randomUUID();
const boardId = randomUUID();
const secondBoardId = randomUUID();
const foreignBoardId = randomUUID();

const auth: AuthContext = {
  user: { id: userId, email: `board-devices-${userId}@example.test`, name: "Board Device Owner" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
// MEMBER traegt `board:read`, aber nicht `board:manage` -- genau die Grenze,
// die der Service durchsetzen muss (wie boards.integration.spec.ts).
const memberAuth: AuthContext = {
  user: { id: memberUserId, email: `board-devices-member-${memberUserId}@example.test`, name: "Board Device Member" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const audit = { correlationId: randomUUID(), ip: "127.0.0.1", userAgent: "vitest" } as const;

beforeAll(async () => {
  await databaseService.database.insert(users).values([
    { id: userId, email: auth.user.email, displayName: auth.user.name },
    { id: memberUserId, email: memberAuth.user.email, displayName: memberAuth.user.name },
  ]);
  await databaseService.database.insert(organizations).values([
    { id: organizationId, name: "Board Device Club", slug: `board-devices-${organizationId}`, timezone: "Europe/Zurich", locale: "de-CH" },
    { id: foreignOrganizationId, name: "Foreign Board Device Club", slug: `foreign-board-devices-${foreignOrganizationId}`, timezone: "Europe/Zurich", locale: "de-CH" },
  ]);
  await databaseService.database.insert(memberships).values([
    { organizationId, userId, role: "OWNER", status: "ACTIVE" },
    { organizationId, userId: memberUserId, role: "MEMBER", status: "ACTIVE" },
  ]);
  await databaseService.database.insert(boards).values([
    { id: boardId, organizationId, name: "Scheibe 1" },
    { id: secondBoardId, organizationId, name: "Scheibe 2" },
    { id: foreignBoardId, organizationId: foreignOrganizationId, name: "Fremde Scheibe" },
  ]);
});

afterAll(async () => {
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(organizations).where(eq(organizations.id, foreignOrganizationId));
  await databaseService.database.delete(users).where(eq(users.id, userId));
  await databaseService.database.delete(users).where(eq(users.id, memberUserId));
  await databaseService.onApplicationShutdown();
});

describe("board-devices", () => {
  it("richtet ein Gerät ein und gibt das Geheimnis genau einmal zurück", async () => {
    const created = await service.pair({ organizationId, boardId, data: { label: "iPad Scheibe 1" }, auth, audit });

    expect(created.secret).toMatch(/^bd_[A-Za-z0-9_-]{43}$/u);
    const [row] = await databaseService.database.select().from(boardDevices).where(eq(boardDevices.id, created.device.id));
    expect(row?.secretHash).toBe(hashBoardDeviceSecret(created.secret));

    const listed = await service.list({ organizationId, auth });
    expect(listed).toEqual([
      expect.objectContaining({ id: created.device.id, boardId, label: "iPad Scheibe 1", lastSeenAt: null }),
    ]);
    expect(JSON.stringify(listed)).not.toContain(created.secret);
  });

  it("ersetzt beim erneuten Einrichten das bisherige Gerät in derselben Transaktion", async () => {
    const first = await service.pair({ organizationId, boardId: secondBoardId, data: { label: "Alt" }, auth, audit });
    const second = await service.pair({ organizationId, boardId: secondBoardId, data: { label: "Neu" }, auth, audit });

    const rows = await databaseService.database.select().from(boardDevices).where(eq(boardDevices.boardId, secondBoardId));
    expect(rows.find((row) => row.id === first.device.id)?.revokedAt).not.toBeNull();
    expect(rows.filter((row) => row.revokedAt === null).map((row) => row.id)).toEqual([second.device.id]);

    const events = await databaseService.database
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.organizationId, organizationId), eq(auditEvents.entityId, first.device.id)));
    expect(events.map((event) => event.action)).toEqual(expect.arrayContaining(["BOARD_DEVICE_PAIRED", "BOARD_DEVICE_REVOKED"]));
  });

  it("verlangt board:manage", async () => {
    await expect(
      service.pair({ organizationId, boardId, data: { label: "X" }, auth: memberAuth, audit }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(service.list({ organizationId, auth: memberAuth })).rejects.toMatchObject({ status: 403 });
  });

  it("kennt keine Scheibe einer fremden Organisation", async () => {
    await expect(
      service.pair({ organizationId, boardId: foreignBoardId, data: { label: "X" }, auth, audit }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("widerruft idempotent und auditiert einmal", async () => {
    const created = await service.pair({ organizationId, boardId, data: { label: "Weg" }, auth, audit });

    await service.revoke({ organizationId, boardId, deviceId: created.device.id, auth, audit });
    await service.revoke({ organizationId, boardId, deviceId: created.device.id, auth, audit });

    const revoked = await databaseService.database
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, created.device.id), eq(auditEvents.action, "BOARD_DEVICE_REVOKED")));
    expect(revoked).toHaveLength(1);

    expect(await service.list({ organizationId, auth })).not.toContainEqual(
      expect.objectContaining({ id: created.device.id }),
    );
  });

  it("meldet 404 für ein Gerät einer anderen Scheibe", async () => {
    const created = await service.pair({ organizationId, boardId, data: { label: "A" }, auth, audit });

    await expect(
      service.revoke({ organizationId, boardId: secondBoardId, deviceId: created.device.id, auth, audit }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
