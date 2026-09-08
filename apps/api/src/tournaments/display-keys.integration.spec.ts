import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ForbiddenException } from "@nestjs/common";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { memberships, organizations, tournaments, users } from "@darts-platform/database";

import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { OrganizationsRepository } from "../organizations/organizations.repository.js";
import { DisplayKeysRepository } from "./display-keys.repository.js";
import { DisplayKeysService } from "./display-keys.service.js";
import { TournamentsRepository } from "./tournaments.repository.js";

const databaseService = new DatabaseService(parseApplicationEnvironment(process.env));
const access = new OrganizationAccessService(new OrganizationsRepository(databaseService));
const tournamentsRepository = new TournamentsRepository(databaseService);
const repository = new DisplayKeysRepository(databaseService);
const service = new DisplayKeysService(repository, tournamentsRepository, access);

const organizationId = randomUUID();
const userId = randomUUID();
const viewerUserId = randomUUID();

const auth: AuthContext = {
  user: { id: userId, email: `display-key-${userId}@example.test`, name: "Turnierleitung" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
// Mitglied ohne `tournament:share` (Reglement der Berechtigungen: VIEWER traegt
// nur Lesezugriffe) — siehe permissions.ts. Der letzte Testfall ist der
// wichtigste des Tasks: er prueft eine Berechtigung, nicht eine Behauptung.
const viewerAuth: AuthContext = {
  user: { id: viewerUserId, email: `display-key-viewer-${viewerUserId}@example.test`, name: "Betrachter" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const audit = { correlationId: randomUUID(), ip: "127.0.0.1", userAgent: "vitest" } as const;

const tournamentStartsAt = new Date("2026-09-20T18:00:00.000Z");
let tournamentId: string;
let publicId: string;
let otherPublicId: string;

function tournamentValues(startsAt: Date) {
  return {
    organizationId,
    name: `Anzeige-Schluessel-Turnier ${randomUUID()}`,
    format: "SINGLE_ELIMINATION",
    groupCount: 1,
    qualifyPerGroup: 1,
    knockoutSize: 2,
    seeding: "RANDOM",
    startsAt,
  } as const;
}

beforeAll(async () => {
  await databaseService.database.insert(users).values([
    { id: userId, email: auth.user.email, displayName: auth.user.name },
    { id: viewerUserId, email: viewerAuth.user.email, displayName: viewerAuth.user.name },
  ]);
  await databaseService.database.insert(organizations).values({
    id: organizationId,
    name: "Anzeige-Schluessel Verein",
    slug: `display-key-${organizationId}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });
  await databaseService.database.insert(memberships).values([
    { organizationId, userId, role: "TOURNAMENT_DIRECTOR", status: "ACTIVE" },
    { organizationId, userId: viewerUserId, role: "VIEWER", status: "ACTIVE" },
  ]);
  const [tournament] = await databaseService.database
    .insert(tournaments)
    .values(tournamentValues(tournamentStartsAt))
    .returning();
  const [otherTournament] = await databaseService.database
    .insert(tournaments)
    .values(tournamentValues(tournamentStartsAt))
    .returning();
  if (tournament === undefined || otherTournament === undefined) {
    throw new Error("Turnier wurde nicht angelegt.");
  }
  tournamentId = tournament.id;
  publicId = tournament.publicId;
  otherPublicId = otherTournament.publicId;
});

afterAll(async () => {
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(users).where(eq(users.id, userId));
  await databaseService.database.delete(users).where(eq(users.id, viewerUserId));
  await databaseService.onApplicationShutdown();
});

describe("Anzeige-Schluessel API", () => {
  it("gibt den Klartext genau einmal heraus", async () => {
    const created = await service.create({
      organizationId, tournamentId, data: { label: "Board 3" }, auth, audit,
    });

    expect(created.secret).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    const listed = await service.list({ organizationId, tournamentId, auth });
    const found = listed.keys.find((key) => key.id === created.id);

    expect(found).toBeDefined();
    expect(Object.keys(found ?? {})).not.toContain("secret");
  });

  it("setzt den Ablauf ohne Angabe auf 48 Stunden nach Turnierbeginn", async () => {
    const created = await service.create({
      organizationId, tournamentId, data: { label: "Beamer" }, auth, audit,
    });

    expect(created.expiresAt.getTime()).toBe(tournamentStartsAt.getTime() + 48 * 60 * 60 * 1000);
  });

  it("laesst einen gueltigen Schluessel das private Turnier aufloesen", async () => {
    const created = await service.create({
      organizationId, tournamentId, data: { label: "Board 1" }, auth, audit,
    });

    await expect(service.resolve(publicId, created.secret)).resolves.toBe("valid");
  });

  it("weist einen widerrufenen Schluessel ab", async () => {
    const created = await service.create({
      organizationId, tournamentId, data: { label: "Board 2" }, auth, audit,
    });
    await service.revoke({ organizationId, tournamentId, keyId: created.id, auth, audit });

    await expect(service.resolve(publicId, created.secret)).resolves.toBe("invalid");
  });

  it("weist einen abgelaufenen Schluessel ab", async () => {
    const created = await service.create({
      organizationId,
      tournamentId,
      data: { label: "Gestern", expiresAt: new Date(Date.now() - 60_000) },
      auth,
      audit,
    });

    await expect(service.resolve(publicId, created.secret)).resolves.toBe("invalid");
  });

  it("weist einen Schluessel eines anderen Turniers ab", async () => {
    const created = await service.create({
      organizationId, tournamentId, data: { label: "Fremd" }, auth, audit,
    });

    await expect(service.resolve(otherPublicId, created.secret)).resolves.toBe("invalid");
  });

  it("laesst ohne tournament:share nichts ausstellen", async () => {
    await expect(
      service.create({
        organizationId, tournamentId, data: { label: "Verboten" }, auth: viewerAuth, audit,
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});
