import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";
import { NotFoundException } from "@nestjs/common";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  auditEvents,
  emailDeliveries,
  memberships,
  organizationInvitations,
  organizations,
  users,
} from "@darts-platform/database";
import {
  apiErrorSchema,
  invitationEmailPayloadSchema,
  invitationPreviewSchema,
} from "@darts-platform/schemas";

import type { AuthContext } from "../auth/auth.types.js";
import { hashInvitationClaimToken } from "../auth/invitation-claim.js";
import { DatabaseService } from "../database/database.service.js";
import { createApiTestApplication } from "../testing/api-harness.js";
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

describe("Einladung erneut senden", () => {
  it("rotiert den Code, verlaengert den Ablauf, legt eine zweite Zeile an und auditiert", async () => {
    const email = `resend-${randomUUID()}@example.test`;
    const created = await service.invite({ organizationId, data: { email, role: "MEMBER" }, auth: ownerAuth, audit });
    const resendAt = Date.now();

    const resent = await service.resendInvitation({ organizationId, invitationId: created.id, auth: ownerAuth, audit });

    expect(resent.id).toBe(created.id);
    expect(resent.claimToken).not.toBe(created.claimToken);
    expect(resent.expiresAt.getTime()).toBeGreaterThanOrEqual(resendAt + 47 * 60 * 60 * 1000);

    const [row] = await databaseService.database
      .select({ claimTokenHash: organizationInvitations.claimTokenHash, status: organizationInvitations.status })
      .from(organizationInvitations)
      .where(eq(organizationInvitations.id, created.id));
    expect(row?.status).toBe("PENDING");
    expect(row?.claimTokenHash).toBe(hashInvitationClaimToken(resent.claimToken));
    expect(row?.claimTokenHash).not.toBe(hashInvitationClaimToken(created.claimToken));

    const deliveries = await databaseService.database
      .select({ payload: emailDeliveries.payload })
      .from(emailDeliveries)
      .where(eq(emailDeliveries.invitationId, created.id))
      .orderBy(desc(emailDeliveries.createdAt));
    expect(deliveries).toHaveLength(2);
    expect(invitationEmailPayloadSchema.parse(deliveries[0]!.payload).invitationUrl).toContain(`#code=${resent.claimToken}`);

    const audits = await databaseService.database
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.entityId, created.id));
    expect(audits.map((entry) => entry.action)).toContain("MEMBER_INVITATION_RESENT");
  });

  it("weist eine zurueckgezogene Einladung mit 404 ab und legt keine Zeile an", async () => {
    const email = `closed-${randomUUID()}@example.test`;
    const created = await service.invite({ organizationId, data: { email, role: "MEMBER" }, auth: ownerAuth, audit });
    await service.cancelInvitation({ organizationId, invitationId: created.id, auth: ownerAuth, audit });

    await expect(
      service.resendInvitation({ organizationId, invitationId: created.id, auth: ownerAuth, audit }),
    ).rejects.toBeInstanceOf(NotFoundException);
    const deliveries = await databaseService.database
      .select({ id: emailDeliveries.id })
      .from(emailDeliveries)
      .where(eq(emailDeliveries.invitationId, created.id));
    expect(deliveries).toHaveLength(1);
  });

  it("findet eine Einladung einer fremden Organisation nicht", async () => {
    const email = `foreign-${randomUUID()}@example.test`;
    const created = await service.invite({ organizationId, data: { email, role: "MEMBER" }, auth: ownerAuth, audit });
    const foreignOrganizationId = randomUUID();
    await databaseService.database.insert(organizations).values({
      id: foreignOrganizationId, name: "Fremd", slug: `fremd-${foreignOrganizationId}`, timezone: "Europe/Zurich", locale: "de-CH",
    });
    await databaseService.database.insert(memberships).values({ organizationId: foreignOrganizationId, userId: ownerUserId, role: "OWNER", status: "ACTIVE" });
    try {
      await expect(
        service.resendInvitation({ organizationId: foreignOrganizationId, invitationId: created.id, auth: ownerAuth, audit }),
      ).rejects.toBeInstanceOf(NotFoundException);
    } finally {
      await databaseService.database.delete(organizations).where(eq(organizations.id, foreignOrganizationId));
    }
  });

  it("antwortet ueber HTTP mit dem neuen Code und liegt unter der sensiblen Stufe", async () => {
    const app = await createApiTestApplication({ RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: 1 });
    try {
      const url = `/api/v1/organizations/${organizationId}/invitations/${randomUUID()}/resend`;
      const first = await app.inject({ method: "POST", url });
      expect(first.statusCode).not.toBe(429);
      const second = await app.inject({ method: "POST", url });
      expect(second.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });
});

describe("Einladungsvorschau", () => {
  it("liefert Organisation, Rolle, E-Mail und Ablauf bei gueltigem Code — ohne Sitzung", async () => {
    const email = `preview-${randomUUID()}@example.test`;
    const created = await service.invite({ organizationId, data: { email, role: "SCORER" }, auth: ownerAuth, audit });
    const app = await createApiTestApplication();
    try {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/invitations/${created.id}/preview`,
        payload: { claimToken: created.claimToken },
      });
      expect(response.statusCode).toBe(200);
      const preview = invitationPreviewSchema.parse(response.json());
      expect(preview).toEqual({
        organizationName: "Mailverein",
        role: "SCORER",
        email,
        expiresAt: created.expiresAt,
      });
    } finally {
      await app.close();
    }
  });

  it("antwortet fuer falschen Code, fremde ID und abgelaufene Einladung identisch mit 404", async () => {
    const email = `preview-404-${randomUUID()}@example.test`;
    const created = await service.invite({ organizationId, data: { email, role: "MEMBER" }, auth: ownerAuth, audit });
    const wrongCode = created.claimToken.slice(0, -1) + (created.claimToken.endsWith("A") ? "B" : "A");
    const app = await createApiTestApplication();
    try {
      const wrong = await app.inject({ method: "POST", url: `/api/v1/invitations/${created.id}/preview`, payload: { claimToken: wrongCode } });
      const unknown = await app.inject({ method: "POST", url: `/api/v1/invitations/${randomUUID()}/preview`, payload: { claimToken: created.claimToken } });
      await databaseService.database
        .update(organizationInvitations)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(organizationInvitations.id, created.id));
      const expired = await app.inject({ method: "POST", url: `/api/v1/invitations/${created.id}/preview`, payload: { claimToken: created.claimToken } });

      for (const response of [wrong, unknown, expired]) {
        expect(response.statusCode).toBe(404);
        expect(apiErrorSchema.parse(response.json()).error.code).toBe("INVITATION_NOT_FOUND");
      }
      expect(wrong.json()).toMatchObject({ error: { code: "INVITATION_NOT_FOUND", message: expired.json().error.message } });
    } finally {
      await app.close();
    }
  });

  it("weist einen Body ohne gueltiges Code-Format mit 400 ab", async () => {
    const app = await createApiTestApplication();
    try {
      const response = await app.inject({ method: "POST", url: `/api/v1/invitations/${randomUUID()}/preview`, payload: { claimToken: "kurz" } });
      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
