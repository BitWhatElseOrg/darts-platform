import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  auditEvents,
  memberships,
  organizations,
  players,
  playerAvatars,
  users,
} from "@darts-platform/database";

import { AuthService } from "../auth/auth.service.js";
import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { OrganizationsRepository } from "../organizations/organizations.repository.js";
import { createApiTestApplication } from "../testing/api-harness.js";
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

/**
 * Ein echtes Bild, nicht gefaelschte Bytes: `normalizeAvatarImage` dekodiert
 * wirklich, siehe `avatar-image.spec.ts`.
 */
async function sampleImage(): Promise<Buffer> {
  return sharp({
    create: { width: 400, height: 300, channels: 3, background: { r: 30, g: 80, b: 180 } },
  })
    .jpeg()
    .toBuffer();
}

describe("player avatar endpoints", () => {
  const memberUserId = randomUUID();
  const foreignOwnerUserId = randomUUID();
  const foreignOrganizationId = randomUUID();
  const memberAuth: AuthContext = {
    user: {
      id: memberUserId,
      email: `member-${memberUserId}@example.test`,
      name: "Member",
    },
    session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
  };
  const foreignOwnerAuth: AuthContext = {
    user: {
      id: foreignOwnerUserId,
      email: `foreign-owner-${foreignOwnerUserId}@example.test`,
      name: "Foreign Owner",
    },
    session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
  };

  let linkedPlayerId: string;
  let foreignPlayerId: string;

  beforeAll(async () => {
    await databaseService.database.insert(users).values([
      { id: memberUserId, email: memberAuth.user.email, displayName: "Member" },
      {
        id: foreignOwnerUserId,
        email: foreignOwnerAuth.user.email,
        displayName: "Foreign Owner",
      },
    ]);
    await databaseService.database.insert(organizations).values({
      id: foreignOrganizationId,
      name: "Foreign Avatar Organization",
      slug: `foreign-avatar-${foreignOrganizationId}`,
      timezone: "Europe/Zurich",
      locale: "de-CH",
    });
    await databaseService.database.insert(memberships).values([
      { organizationId, userId: memberUserId, role: "MEMBER", status: "ACTIVE" },
      {
        organizationId: foreignOrganizationId,
        userId: foreignOwnerUserId,
        role: "OWNER",
        status: "ACTIVE",
      },
    ]);

    const linkedPlayer = await playersService.create({
      organizationId,
      data: { displayName: "Verknuepfte Person", status: "ACTIVE" },
      auth: ownerAuth,
      audit,
    });
    linkedPlayerId = linkedPlayer.id;
    // ADR 0015: das Konto wird mit diesem Spieler verknuepft. `create`/`update`
    // nehmen `userId` nicht entgegen — die Verknuepfung ist eine spaetere
    // Kontobindung, kein Feld der Spielerpflege.
    await databaseService.database
      .update(players)
      .set({ userId: memberUserId })
      .where(eq(players.id, linkedPlayerId));

    const foreignPlayer = await playersService.create({
      organizationId: foreignOrganizationId,
      data: { displayName: "Fremde Person", status: "ACTIVE" },
      auth: foreignOwnerAuth,
      audit,
    });
    foreignPlayerId = foreignPlayer.id;
  });

  afterAll(async () => {
    await databaseService.database
      .delete(organizations)
      .where(eq(organizations.id, foreignOrganizationId));
    await databaseService.database.delete(users).where(eq(users.id, memberUserId));
    await databaseService.database
      .delete(users)
      .where(eq(users.id, foreignOwnerUserId));
  });

  it("nimmt ein Bild von der Verwaltung entgegen und liefert es zurueck", async () => {
    const stored = await playersService.setAvatar({
      organizationId,
      playerId,
      body: await sampleImage(),
      auth: ownerAuth,
      audit,
    });
    expect(stored.avatarChecksum).toMatch(/^[0-9a-f]{64}$/u);

    const avatar = await playersService.getAvatar({
      organizationId,
      playerId,
      auth: ownerAuth,
    });
    expect(avatar.contentType).toBe("image/webp");
    expect(avatar.bytes.byteLength).toBeGreaterThan(0);
    expect(avatar.checksum).toBe(stored.avatarChecksum);
  });

  it("laesst die verknuepfte Person ihr eigenes Bild setzen", async () => {
    // ADR 0015: das Konto ist mit diesem Spieler verknuepft und hat kein
    // player:update.
    await expect(
      playersService.setAvatar({
        organizationId,
        playerId: linkedPlayerId,
        body: await sampleImage(),
        auth: memberAuth,
        audit,
      }),
    ).resolves.toMatchObject({ avatarChecksum: expect.any(String) });
  });

  it("verweigert einer fremden Person ohne player:update das Setzen", async () => {
    await expect(
      playersService.setAvatar({
        organizationId,
        playerId,
        body: await sampleImage(),
        auth: memberAuth,
        audit,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("lehnt Bytes ab, die kein Bild sind", async () => {
    await expect(
      playersService.setAvatar({
        organizationId,
        playerId,
        body: Buffer.from("kein Bild"),
        auth: ownerAuth,
        audit,
      }),
    ).rejects.toMatchObject({ response: { code: "AVATAR_INVALID_IMAGE" } });
  });

  it("verrät keine Bibliotheksmeldung im Fehler", async () => {
    // Entscheidung 1: `AvatarImageError.message` traegt die rohe
    // `sharp`-Meldung und darf niemals an den Client gehen (AGENTS.md §15).
    try {
      await playersService.setAvatar({
        organizationId,
        playerId,
        body: Buffer.from("kein Bild"),
        auth: ownerAuth,
        audit,
      });
      throw new Error("Das Setzen haette abgewiesen werden muessen.");
    } catch (error: unknown) {
      const response = (error as { response?: unknown }).response;
      const message =
        typeof response === "object" && response !== null && "message" in response
          ? String((response as { message: unknown }).message)
          : "";
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toMatch(/sharp|libvips|Input buffer/iu);
    }
  });

  it("findet einen Spieler einer fremden Organisation nicht", async () => {
    // Befund 1: ohne Bild waere dieser Test mehrdeutig — `getAvatar` wirft
    // 404 sowohl fuer einen fehlenden Spieler als auch fuer ein fehlendes
    // Bild. Verloere `playersRepository.get` den `organizationId`-Filter,
    // faende der Aufruf den fremden Spieler trotzdem, liefe weiter zu
    // `findAvatar`, faende dort nichts — und ergaebe wieder 404, obwohl die
    // Mandantengrenze laengst durchbrochen waere. Der fremde Spieler bekommt
    // deshalb zuerst ein Bild: ein kaputter Filter faende jetzt eine Zeile
    // und muesste mit 200 antworten.
    await playersService.setAvatar({
      organizationId: foreignOrganizationId,
      playerId: foreignPlayerId,
      body: await sampleImage(),
      auth: foreignOwnerAuth,
      audit,
    });

    // 404, nicht 403: sonst verriete die Antwort seine Existenz. Die
    // Fehlermeldung wird mitgeprueft, damit klar ist, dass der Spieler selbst
    // nicht gefunden wird (nicht erst sein Bild).
    await expect(
      playersService.getAvatar({
        organizationId,
        playerId: foreignPlayerId,
        auth: ownerAuth,
      }),
    ).rejects.toMatchObject({ status: 404, message: "Player not found." });
  });

  it("entfernt das Bild wieder", async () => {
    await playersService.setAvatar({
      organizationId,
      playerId,
      body: await sampleImage(),
      auth: ownerAuth,
      audit,
    });
    await playersService.removeAvatar({
      organizationId,
      playerId,
      auth: ownerAuth,
      audit,
    });

    const player = await playersService.get({ organizationId, playerId, auth: ownerAuth });
    expect(player.avatarChecksum).toBeNull();
    await expect(
      playersService.getAvatar({ organizationId, playerId, auth: ownerAuth }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("raeumt das Bild mit dem Spieler ab", async () => {
    // `playersService.remove` existiert nicht (nur list/get/create/update/
    // archive); die Spielerzeile wird deshalb direkt geloescht, um die
    // Kaskade aus der Migration zu pruefen.
    const cascadePlayer = await playersService.create({
      organizationId,
      data: { displayName: "Kaskaden Person", status: "ACTIVE" },
      auth: ownerAuth,
      audit,
    });
    await playersService.setAvatar({
      organizationId,
      playerId: cascadePlayer.id,
      body: await sampleImage(),
      auth: ownerAuth,
      audit,
    });

    await databaseService.database.delete(players).where(eq(players.id, cascadePlayer.id));

    const rows = await databaseService.database
      .select({ id: playerAvatars.id })
      .from(playerAvatars)
      .where(eq(playerAvatars.playerId, cascadePlayer.id));
    expect(rows).toHaveLength(0);
  });

  it("schreibt einen Audit-Eintrag ohne die Bilddaten", async () => {
    // Befund 2: mit einer eigenen `correlationId` und der Filterung nach
    // `entityId` UND `correlationId` trifft die Abfrage garantiert genau
    // diesen Aufruf — nicht eine Alt- oder Nachbarzeile aus einem frueheren
    // Testlauf (`audit_events.organization_id` ist `on delete set null`,
    // nicht `cascade`; solche Zeilen bleiben in der geteilten
    // Entwicklungsdatenbank stehen) und nicht eine Zeile eines anderen Tests
    // in dieser Datei, der denselben Spieler und dieselbe geteilte
    // `audit`-Konstante verwendet.
    const dedicatedAudit = { ...audit, correlationId: randomUUID() };
    const stored = await playersService.setAvatar({
      organizationId,
      playerId,
      body: await sampleImage(),
      auth: ownerAuth,
      audit: dedicatedAudit,
    });

    const [entry] = await databaseService.database
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "PLAYER_AVATAR_UPDATED"),
          eq(auditEvents.entityId, playerId),
          eq(auditEvents.correlationId, dedicatedAudit.correlationId),
        ),
      );
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry?.newValue)).not.toContain("bytes");
    expect(entry?.newValue).toMatchObject({ checksum: stored.avatarChecksum });
  });

  it("schreibt einen Entfernen-Audit-Eintrag mit der alten Pruefsumme, nicht mit den Bytes", async () => {
    // Befund 5: `PLAYER_AVATAR_REMOVED` war bisher ungetestet.
    const dedicatedAudit = { ...audit, correlationId: randomUUID() };
    const stored = await playersService.setAvatar({
      organizationId,
      playerId,
      body: await sampleImage(),
      auth: ownerAuth,
      audit: dedicatedAudit,
    });
    await playersService.removeAvatar({
      organizationId,
      playerId,
      auth: ownerAuth,
      audit: dedicatedAudit,
    });

    const [entry] = await databaseService.database
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "PLAYER_AVATAR_REMOVED"),
          eq(auditEvents.entityId, playerId),
          eq(auditEvents.correlationId, dedicatedAudit.correlationId),
        ),
      );
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry?.oldValue)).not.toContain("bytes");
    expect(entry?.oldValue).toMatchObject({ checksum: stored.avatarChecksum });
  });

  it("schreibt beim Entfernen ohne vorhandenes Bild keinen Audit-Eintrag", async () => {
    // Stille Entscheidung in `deleteAvatar`: ohne getroffene Zeile
    // (`removed === undefined`) entsteht kein Audit-Eintrag — ein Entfernen
    // ohne vorhandenes Bild ist keine Aenderung und soll auch nicht als eine
    // protokolliert werden.
    const withoutAvatar = await playersService.create({
      organizationId,
      data: { displayName: "Ohne Bild", status: "ACTIVE" },
      auth: ownerAuth,
      audit,
    });
    const dedicatedAudit = { ...audit, correlationId: randomUUID() };

    await playersService.removeAvatar({
      organizationId,
      playerId: withoutAvatar.id,
      auth: ownerAuth,
      audit: dedicatedAudit,
    });

    const rows = await databaseService.database
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "PLAYER_AVATAR_REMOVED"),
          eq(auditEvents.entityId, withoutAvatar.id),
        ),
      );
    expect(rows).toHaveLength(0);
  });
});

/**
 * Faelle, die die echte HTTP-Ebene brauchen statt `playersService` direkt:
 * ob ein Fastify-Koerperlimitfehler die Nest-Pipeline ueberhaupt erreicht,
 * und ob `GET .../avatar` die zugesagten Header setzt und rohe Bytes statt
 * eines JSON-serialisierten `Buffer`-Objekts ausliefert.
 */
describe("HTTP-Ebene .../avatar", () => {
  let application: NestFastifyApplication;
  const authHeaders = {} as const;

  beforeAll(async () => {
    application = await createApiTestApplication();
    vi.spyOn(application.get(AuthService), "getSession").mockResolvedValue(ownerAuth);
  }, 60_000);

  afterAll(async () => {
    await application.close();
  });

  it("beantwortet einen zu grossen Koerper im Fehlerformat", async () => {
    const response = await application.inject({
      method: "PUT",
      url: `/api/v1/organizations/${organizationId}/players/${playerId}/avatar`,
      headers: { "content-type": "image/webp", ...authHeaders },
      payload: Buffer.alloc(2 * 1024 * 1024),
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({ error: { code: "AVATAR_TOO_LARGE" } });
  });

  it("liefert Cache-Header, ETag und die rohen Bildbytes", async () => {
    // Befund 3: `Cache-Control`, `ETag`, `Content-Type` und `Vary` sind
    // Zusagen des Controllers, kein Test berührte sie. Ausserdem prüft dies,
    // ob `@Res({ passthrough: true })` mit einem zurückgegebenen `Buffer`
    // wirklich rohe Bytes ausliefert statt eines JSON-serialisierten
    // Buffer-Objekts (`{"type":"Buffer","data":[...]}`) — die Prüfsumme der
    // rohen Antwort muss exakt der gespeicherten entsprechen.
    const stored = await playersService.setAvatar({
      organizationId,
      playerId,
      body: await sampleImage(),
      auth: ownerAuth,
      audit,
    });

    const response = await application.inject({
      method: "GET",
      url: `/api/v1/organizations/${organizationId}/players/${playerId}/avatar`,
      headers: { ...authHeaders },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/webp");
    expect(response.headers["cache-control"]).toBe("private, max-age=31536000, immutable");
    expect(response.headers.etag).toBe(`"${stored.avatarChecksum}"`);
    expect(response.headers.vary).toBe("Cookie");
    expect(createHash("sha256").update(response.rawPayload).digest("hex")).toBe(
      stored.avatarChecksum,
    );
  });
});
