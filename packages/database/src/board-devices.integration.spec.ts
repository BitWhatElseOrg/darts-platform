import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { createDatabaseConnection } from "./client.js";
import {
  auditEvents,
  boardControllerLeases,
  boardDevices,
  boards,
  matches,
  organizations,
  users,
} from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error(
    "DATABASE_URL is required for die Migrations-Integrationstests. Lokale Infrastruktur starten und Tests vom Workspace-Root ausfuehren.",
  );
}

const { database, close } = createDatabaseConnection(databaseUrl);

const organizationId = randomUUID();
const foreignOrganizationId = randomUUID();
const userId = randomUUID();
const boardId = randomUUID();
const secondBoardId = randomUUID();
const matchId = randomUUID();

// Wird im zweiten Test gesetzt (siehe Testreihenfolge unten).
let activeDeviceId: string;

/**
 * Der postgres-Treiber traegt die Constraint-Meldung in `error.cause`, nicht
 * in `error.message` (`.rejects.toThrow(regex)` griffe daher ins Leere).
 * Gleiches Muster wie `display-keys.integration.spec.ts`.
 */
async function expectConstraintViolation(promise: Promise<unknown>, constraintName: string) {
  try {
    await promise;
  } catch (error) {
    const cause = error instanceof Error && "cause" in error ? error.cause : undefined;
    expect(String(cause)).toContain(constraintName);
    return;
  }
  throw new Error(`Erwartete eine verletzte Constraint: ${constraintName}`);
}

beforeAll(async () => {
  await database.insert(organizations).values([
    {
      id: organizationId,
      name: "Testverein Scheiben-Tablets",
      slug: `scheiben-tablets-${organizationId.slice(0, 8)}`,
      timezone: "Europe/Zurich",
      locale: "de-CH",
    },
    {
      id: foreignOrganizationId,
      name: "Fremdverein Scheiben-Tablets",
      slug: `fremd-scheiben-tablets-${foreignOrganizationId.slice(0, 8)}`,
      timezone: "Europe/Zurich",
      locale: "de-CH",
    },
  ]);

  await database.insert(users).values({
    id: userId,
    email: `scheiben-tablets-${userId.slice(0, 8)}@example.test`,
    displayName: "Test Turnierleitung",
  });

  await database.insert(boards).values([
    { id: boardId, organizationId, name: "Board 1" },
    { id: secondBoardId, organizationId, name: "Board 2" },
  ]);

  await database.insert(matches).values({
    id: matchId,
    organizationId,
    boardId: null,
    bestOfLegs: 1,
    startingSeat: 1,
  });
});

afterAll(async () => {
  await database.delete(organizations).where(eq(organizations.id, organizationId));
  await database.delete(organizations).where(eq(organizations.id, foreignOrganizationId));
  await database.delete(users).where(eq(users.id, userId));
  await close();
});

// Die Faelle haengen voneinander ab und laufen in Dateireihenfolge (siehe
// Task-2-Brief): das haelt die Fixture klein.
describe("board_devices", () => {
  it("erlaubt nur ein aktives Gerät je Scheibe", async () => {
    await database
      .insert(boardDevices)
      .values({ organizationId, boardId, secretHash: "a".repeat(64), label: "iPad 1", createdBy: userId });

    await expectConstraintViolation(
      database
        .insert(boardDevices)
        .values({ organizationId, boardId, secretHash: "b".repeat(64), label: "iPad 2", createdBy: userId }),
      "board_devices_board_active_unique",
    );
  });

  it("erlaubt ein neues Gerät, sobald das alte widerrufen ist", async () => {
    await database.update(boardDevices).set({ revokedAt: new Date() }).where(eq(boardDevices.boardId, boardId));

    const [created] = await database
      .insert(boardDevices)
      .values({ organizationId, boardId, secretHash: "c".repeat(64), label: "iPad 3", createdBy: userId })
      .returning();

    expect(created).toBeDefined();
    activeDeviceId = created!.id;
  });

  it("lehnt ein Gerät ab, dessen Organisation nicht die der Scheibe ist", async () => {
    await expectConstraintViolation(
      database.insert(boardDevices).values({
        organizationId: foreignOrganizationId,
        boardId: secondBoardId,
        secretHash: "d".repeat(64),
        label: "Fremd",
        createdBy: userId,
      }),
      "board_devices_board_organization_fk",
    );
  });

  it("lehnt einen Hash im falschen Format ab", async () => {
    await expectConstraintViolation(
      database.insert(boardDevices).values({
        organizationId,
        boardId: secondBoardId,
        secretHash: "Z".repeat(64),
        label: "Kaputt",
        createdBy: userId,
      }),
      "board_devices_secret_hash_format_check",
    );
  });

  it("verlangt bei der Lease genau einen Akteur", async () => {
    await expectConstraintViolation(
      database
        .insert(boardControllerLeases)
        .values({ matchId, organizationId, controllerId: randomUUID(), expiresAt: new Date() }),
      "board_controller_leases_actor_check",
    );

    await expectConstraintViolation(
      database.insert(boardControllerLeases).values({
        matchId,
        organizationId,
        controllerId: randomUUID(),
        userId,
        deviceId: activeDeviceId,
        expiresAt: new Date(),
      }),
      "board_controller_leases_actor_check",
    );
  });

  it("erlaubt im Audit höchstens einen Akteur", async () => {
    await expectConstraintViolation(
      database.insert(auditEvents).values({
        organizationId,
        actorUserId: userId,
        actorDeviceId: activeDeviceId,
        action: "TEST",
        entityType: "Test",
        correlationId: randomUUID(),
      }),
      "audit_events_single_actor_check",
    );
  });

  it("löscht Geräte mit der Scheibe", async () => {
    await database.delete(boards).where(eq(boards.id, boardId));

    expect(await database.select().from(boardDevices).where(eq(boardDevices.boardId, boardId))).toHaveLength(0);
  });
});
