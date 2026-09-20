import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  emailDeliveries,
  memberships,
  organizations,
  users,
} from "@darts-platform/database";
import { invitationEmailPayloadSchema } from "@darts-platform/schemas";

import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { OrganizationAccessService } from "./organization-access.service.js";
import { OrganizationsRepository } from "./organizations.repository.js";
import { OrganizationsService } from "./organizations.service.js";

const environment = parseApplicationEnvironment(process.env);
const databaseService = new DatabaseService(environment);
const repository = new OrganizationsRepository(databaseService);
const service = new OrganizationsService(
  repository,
  new OrganizationAccessService(repository),
  environment,
);

const organizationId = randomUUID();
const ownerUserId = randomUUID();
const ownerAuth: AuthContext = {
  user: {
    id: ownerUserId,
    email: `owner-${ownerUserId}@example.test`,
    name: "Alex Muster",
  },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const audit = {
  correlationId: randomUUID(),
  ip: "127.0.0.1",
  userAgent: "vitest",
};

beforeAll(async () => {
  await databaseService.database.insert(users).values({
    id: ownerUserId,
    email: ownerAuth.user.email,
    displayName: "Alex Muster",
  });
  await databaseService.database.insert(organizations).values({
    id: organizationId,
    name: "Mailverein",
    slug: `mailverein-${organizationId}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });
  await databaseService.database.insert(memberships).values({
    organizationId,
    userId: ownerUserId,
    role: "OWNER",
    status: "ACTIVE",
  });
});

afterAll(async () => {
  await databaseService.database
    .delete(organizations)
    .where(eq(organizations.id, organizationId));
  await databaseService.database.delete(users).where(eq(users.id, ownerUserId));
  await databaseService.onApplicationShutdown();
});

describe("Einladung erzeugt einen Versandauftrag", () => {
  it("legt genau eine INVITATION-Zeile mit Link, Namen und Ablauf an", async () => {
    const email = `gast-${randomUUID()}@example.test`;
    const created = await service.invite({
      organizationId,
      data: { email, role: "SCORER" },
      auth: ownerAuth,
      audit,
    });

    const rows = await databaseService.database
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.invitationId, created.id))
      .orderBy(desc(emailDeliveries.createdAt));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.kind).toBe("INVITATION");
    expect(row.recipient).toBe(email);
    expect(row.organizationId).toBe(organizationId);
    expect(row.sentAt).toBeNull();

    const payload = invitationEmailPayloadSchema.parse(row.payload);
    expect(payload.organizationName).toBe("Mailverein");
    expect(payload.inviterName).toBe("Alex Muster");
    expect(payload.role).toBe("SCORER");
    expect(payload.expiresAt.getTime()).toBe(created.expiresAt.getTime());
    expect(payload.invitationUrl).toBe(
      `${new URL(environment.WEB_ORIGIN).origin}/einladung/${created.id}#code=${created.claimToken}`,
    );
  });

  it("legt keine Zeile an, wenn die Einladung scheitert", async () => {
    const before = await databaseService.database
      .select({ id: emailDeliveries.id })
      .from(emailDeliveries)
      .where(eq(emailDeliveries.organizationId, organizationId));
    await expect(
      service.invite({
        organizationId,
        data: {
          email: `x-${randomUUID()}@example.test`,
          role: "MEMBER",
          playerId: randomUUID(),
        },
        auth: ownerAuth,
        audit,
      }),
    ).rejects.toThrow();
    const after = await databaseService.database
      .select({ id: emailDeliveries.id })
      .from(emailDeliveries)
      .where(eq(emailDeliveries.organizationId, organizationId));
    expect(after.length).toBe(before.length);
  });

  it("liefert in der Einladungsliste den Zustand der juengsten Zustellung", async () => {
    const email = `status-${randomUUID()}@example.test`;
    const created = await service.invite({ organizationId, data: { email, role: "MEMBER" }, auth: ownerAuth, audit });

    let list = await service.listOrganizationInvitations({ organizationId, auth: ownerAuth });
    expect(list.find((entry) => entry.id === created.id)?.lastDelivery).toEqual({ status: "pending" });

    const sentAt = new Date("2026-09-20T10:00:00.000Z");
    await databaseService.database
      .update(emailDeliveries)
      .set({ sentAt, providerMessageId: "msg", payload: null })
      .where(eq(emailDeliveries.invitationId, created.id));
    list = await service.listOrganizationInvitations({ organizationId, auth: ownerAuth });
    expect(list.find((entry) => entry.id === created.id)?.lastDelivery).toEqual({ status: "sent", sentAt });

    // Eine zweite, juengere Zeile (wie nach «Erneut senden») bestimmt den Status.
    await databaseService.database.insert(emailDeliveries).values({
      kind: "INVITATION",
      recipient: email,
      organizationId,
      invitationId: created.id,
      payload: null,
      deadLetteredAt: new Date("2026-09-20T11:00:00.000Z"),
      attempts: 8,
      lastError: "test",
    });
    list = await service.listOrganizationInvitations({ organizationId, auth: ownerAuth });
    expect(list.find((entry) => entry.id === created.id)?.lastDelivery?.status).toBe("failed");
  });
});
