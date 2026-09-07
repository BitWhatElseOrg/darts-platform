import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { auditEvents, boards, memberships, organizations, users } from "@darts-platform/database";

import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { OrganizationsRepository } from "../organizations/organizations.repository.js";
import { BoardsService } from "./boards.service.js";

const databaseService = new DatabaseService(parseApplicationEnvironment(process.env));
const service = new BoardsService(
  databaseService,
  new OrganizationAccessService(new OrganizationsRepository(databaseService)),
);

const organizationId = randomUUID();
const foreignOrganizationId = randomUUID();
const userId = randomUUID();
const memberUserId = randomUUID();

const auth: AuthContext = {
  user: { id: userId, email: `boards-${userId}@example.test`, name: "Board Owner" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
// MEMBER traegt `board:read`, aber nicht `board:manage` -- genau die Grenze,
// die der Service durchsetzen muss.
const memberAuth: AuthContext = {
  user: { id: memberUserId, email: `member-${memberUserId}@example.test`, name: "Board Member" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const audit = { correlationId: randomUUID(), ip: "127.0.0.1", userAgent: "vitest" } as const;

beforeAll(async () => {
  await databaseService.database.insert(users).values([
    { id: userId, email: auth.user.email, displayName: auth.user.name },
    { id: memberUserId, email: memberAuth.user.email, displayName: memberAuth.user.name },
  ]);
  await databaseService.database.insert(organizations).values([
    { id: organizationId, name: "Board Club", slug: `boards-${organizationId}`, timezone: "Europe/Zurich", locale: "de-CH" },
    { id: foreignOrganizationId, name: "Foreign Board Club", slug: `foreign-boards-${foreignOrganizationId}`, timezone: "Europe/Zurich", locale: "de-CH" },
  ]);
  await databaseService.database.insert(memberships).values([
    { organizationId, userId, role: "OWNER", status: "ACTIVE" },
    { organizationId, userId: memberUserId, role: "MEMBER", status: "ACTIVE" },
  ]);
});

afterAll(async () => {
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(organizations).where(eq(organizations.id, foreignOrganizationId));
  await databaseService.database.delete(users).where(eq(users.id, userId));
  await databaseService.database.delete(users).where(eq(users.id, memberUserId));
  await databaseService.onApplicationShutdown();
});

describe("boards", () => {
  it("legt ein Board an und schreibt den Audit-Datensatz", async () => {
    const name = `Board ${randomUUID().slice(0, 8)}`;
    const board = await service.create({ organizationId, auth, audit, data: { name } });

    expect(board).toMatchObject({ name, status: "AVAILABLE" });

    const [event] = await databaseService.database
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.organizationId, organizationId), eq(auditEvents.entityId, board.id)));
    expect(event).toMatchObject({
      action: "BOARD_CREATED",
      actorUserId: userId,
      entityType: "Board",
      correlationId: audit.correlationId,
    });

    const listed = await service.list({ organizationId, auth });
    expect(listed.map((entry) => entry.id)).toContain(board.id);
  });

  /**
   * Der Unique-Index `boards_organization_name_unique` ist die eigentliche
   * Schranke; der Service uebersetzt ihn ueber `isBoardNameConflict`
   * (`board-occupancy.ts`) in 409, damit die Flaeche eine verstaendliche
   * Meldung zeigt statt einer Datenbankfehlermeldung. Die Erkennung folgt der
   * Fehlerkette (`error.cause`), nicht dem aeusseren `error.message` --
   * Drizzle verpackt den Treiberfehler, dessen Constraint-Name nur in
   * `cause` steht.
   */
  it("lehnt einen doppelten Namen mit 409 ab", async () => {
    const name = `Doppel ${randomUUID().slice(0, 8)}`;
    const original = await service.create({ organizationId, auth, audit, data: { name } });

    await expect(
      service.create({ organizationId, auth, audit, data: { name } }),
    ).rejects.toMatchObject({ status: 409, response: { code: "BOARD_NAME_TAKEN" } });

    // Der abgelehnte zweite Versuch darf weder eine zweite Zeile noch einen
    // zweiten Audit-Datensatz hinterlassen -- die Transaktion muss vollstaendig
    // zurückgerollt sein.
    const rows = await databaseService.database
      .select()
      .from(boards)
      .where(and(eq(boards.organizationId, organizationId), eq(boards.name, name)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(original.id);

    const events = await databaseService.database
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.organizationId, organizationId), eq(auditEvents.entityId, original.id)));
    expect(events).toHaveLength(1);
  });

  it("laesst ein MEMBER lesen, aber nicht anlegen", async () => {
    await expect(service.list({ organizationId, auth: memberAuth })).resolves.toBeInstanceOf(Array);

    const name = `Verboten ${randomUUID().slice(0, 8)}`;
    await expect(
      service.create({ organizationId, auth: memberAuth, audit, data: { name } }),
    ).rejects.toMatchObject({ status: 403 });

    // Die Autorisierungsgrenze greift vor jedem Schreibzugriff -- weder das
    // Board noch ein Audit-Datensatz duerfen entstanden sein.
    const rows = await databaseService.database
      .select()
      .from(boards)
      .where(and(eq(boards.organizationId, organizationId), eq(boards.name, name)));
    expect(rows).toHaveLength(0);

    const events = await databaseService.database
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.organizationId, organizationId), eq(auditEvents.action, "BOARD_CREATED")));
    expect(events.map((event) => (event.newValue as { name?: string } | null)?.name)).not.toContain(name);
  });

  it("zeigt keine Boards einer fremden Organisation", async () => {
    const [foreign] = await databaseService.database
      .insert(boards)
      .values({ organizationId: foreignOrganizationId, name: "Fremdes Board" })
      .returning();
    expect(foreign).toBeDefined();

    const listed = await service.list({ organizationId, auth });
    expect(listed.map((entry) => entry.id)).not.toContain(foreign?.id);

    // Ohne Mitgliedschaft in der fremden Organisation gibt es dort gar keine
    // Sicht -- die Mandantengrenze haengt nicht an einem Filter allein.
    await expect(
      service.list({ organizationId: foreignOrganizationId, auth }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
