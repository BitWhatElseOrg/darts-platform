import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { memberships, organizations, users } from "@darts-platform/database";

import { AuthService } from "../auth/auth.service.js";
import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { collectRoutes, type RouteEntry } from "../testing/route-inventory.js";

/**
 * Deckt Spec D1 ab: fuer jede Route mit `:organizationId` wird der Owner
 * von Organisation A gegen Ressourcen von Organisation B gefahren. Erwartet
 * wird ausschliesslich 403 oder 404 — nie ein 2xx-Erfolg. Die Routenliste
 * kommt aus `collectRoutes` (Task 4) und wird nicht von Hand gepflegt.
 */
const environment = parseApplicationEnvironment(process.env);
const databaseService = new DatabaseService(environment);
const organizationA = randomUUID();
const organizationB = randomUUID();
const ownerA = randomUUID();
const ownerAuth: AuthContext = {
  user: { id: ownerA, email: `owner-a-${ownerA}@example.test`, name: "Owner A" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};

/**
 * Gueltige Koerper je Route, damit die Tenant-Pruefung vor der
 * Koerper-Validierung ueberhaupt erreicht wird. Schluessel: "METHOD url".
 * Routen ohne Eintrag werden mit `{}` geschickt; ein 400 gilt dann als
 * "nicht bewiesen" und laesst den Test rot werden – der Eintrag ist dann
 * nachzutragen. Die Avatar-Upload-Route (`PUT .../avatar`) nimmt keinen
 * JSON-Koerper entgegen und wird unten gesondert behandelt.
 */
const bodies: Record<string, unknown> = {
  "POST /api/v1/organizations/:organizationId/boards": { name: "Board 1" },
  "POST /api/v1/organizations/:organizationId/players": { displayName: "Fremde Spielerin", status: "ACTIVE" },
  "PATCH /api/v1/organizations/:organizationId/players/:playerId": { displayName: "Umbenannt" },
  "POST /api/v1/organizations/:organizationId/matches": {
    playerOneId: randomUUID(), playerTwoId: randomUUID(), boardId: null, bestOfLegs: 1, bestOfSets: 1,
  },
  "POST /api/v1/organizations/:organizationId/matches/:matchId/visits": {
    commandId: randomUUID(), expectedVersion: 0, playerId: randomUUID(), points: 60, dartsThrown: 3,
  },
  "POST /api/v1/organizations/:organizationId/matches/:matchId/undo": { commandId: randomUUID(), expectedVersion: 0 },
  "POST /api/v1/organizations/:organizationId/matches/:matchId/leg-start": {
    commandId: randomUUID(), expectedVersion: 0, legNumber: 1, startingSeat: 1,
  },
  "POST /api/v1/organizations/:organizationId/matches/:matchId/leg-by-bull": {
    commandId: randomUUID(), expectedVersion: 0, winnerSeat: 1,
  },
  "POST /api/v1/organizations/:organizationId/matches/:matchId/abort": {
    commandId: randomUUID(), expectedVersion: 0, reason: "Testabbruch",
  },
  "POST /api/v1/organizations/:organizationId/matches/:matchId/controller-lease": { controllerId: randomUUID(), force: false },
  "POST /api/v1/organizations/:organizationId/invitations": { email: "gast@example.test", role: "MEMBER" },
  "PATCH /api/v1/organizations/:organizationId/members/:userId": { role: "ADMIN" },
  "PUT /api/v1/organizations/:organizationId/members/:userId/player": { playerId: randomUUID() },
  "POST /api/v1/organizations/:organizationId/teams": { name: "Fremdes Team" },
  "PATCH /api/v1/organizations/:organizationId/teams/:teamId": { name: "Umbenannt" },
  "POST /api/v1/organizations/:organizationId/teams/:teamId/members": { playerId: randomUUID() },
  "POST /api/v1/organizations/:organizationId/tournaments/:tournamentId/display-keys": { label: "Anzeige" },
  "PATCH /api/v1/organizations/:organizationId/tournaments/:tournamentId/visibility": { visibility: "PUBLIC" },
  "POST /api/v1/organizations/:organizationId/tournaments/:tournamentId/assignments": {
    commandId: randomUUID(), expectedVersion: 0, matchId: randomUUID(), boardId: randomUUID(),
  },
  "POST /api/v1/organizations/:organizationId/tournaments": {
    name: "Matrix-Turnier",
    startsAt: new Date().toISOString(),
    format: "SINGLE_ELIMINATION",
    startingScore: 501,
    inRule: "STRAIGHT",
    outRule: "DOUBLE",
    bestOfLegs: 5,
    bestOfSets: 1,
    participantIds: [randomUUID(), randomUUID(), randomUUID(), randomUUID()],
    groupCount: 1,
    qualifyPerGroup: 1,
    knockoutSize: 4,
    seeding: "RANDOM",
    boardIds: [randomUUID()],
  },
  "POST /api/v1/organizations/:organizationId/competitions": {
    name: "Matrix-Wettbewerb",
    slug: `matrix-${randomUUID()}`,
    slots: [
      { sequence: 1, discipline: "SINGLES", label: "S1", startingScore: 501, bestOfLegs: 5 },
    ],
  },
  "POST /api/v1/organizations/:organizationId/encounters/:encounterId/start": {
    commandId: randomUUID(), expectedVersion: 0,
  },
  "POST /api/v1/organizations/:organizationId/encounters/:encounterId/nominations": {
    commandId: randomUUID(), expectedVersion: 0, side: "HOME",
    nominations: [{ position: 1, playerId: randomUUID() }],
  },
  "POST /api/v1/organizations/:organizationId/tournaments/structure-preview": {
    format: "GROUPS_THEN_KNOCKOUT", participantCount: 8, groupCount: 2, qualifyPerGroup: 2, knockoutSize: 4,
  },
  "POST /api/v1/organizations/:organizationId/tournaments/advanced-format-preview": {
    participantCount: 8, competitorKind: "PLAYER", bestOfLegs: 5, bestOfSets: 1,
    stages: [{ key: "group", type: "ROUND_ROBIN", advance: 4 }],
  },
  "POST /api/v1/organizations/:organizationId/tournaments/:tournamentId/board-releases": {
    commandId: randomUUID(), expectedVersion: 0, boardId: randomUUID(),
  },
  "POST /api/v1/organizations/:organizationId/tournaments/:tournamentId/result-corrections": {
    commandId: randomUUID(), expectedVersion: 0, matchId: randomUUID(), reason: "Testkorrektur",
  },
  "POST /api/v1/organizations/:organizationId/tournaments/:tournamentId/withdrawals": {
    commandId: randomUUID(), expectedVersion: 0, playerId: randomUUID(), reason: "Testrueckzug",
  },
  "POST /api/v1/organizations/:organizationId/competitions/:competitionId/encounters": {
    matchday: 1, homeTeamId: randomUUID(), awayTeamId: randomUUID(), scheduledAt: new Date().toISOString(),
  },
  "PATCH /api/v1/organizations/:organizationId/competitions/:competitionId": {
    commandId: randomUUID(), expectedVersion: 0, name: "Umbenannt",
  },
  "POST /api/v1/organizations/:organizationId/encounters/:encounterId/doubles": {
    commandId: randomUUID(), expectedVersion: 0, side: "HOME",
    pairings: [{ sequence: 1, playerIds: [randomUUID(), randomUUID()] }],
  },
  "POST /api/v1/organizations/:organizationId/encounters/:encounterId/substitutions": {
    commandId: randomUUID(), expectedVersion: 0, side: "HOME", position: 1,
    outPlayerId: randomUUID(), inPlayerId: randomUUID(), effectiveFromSequence: 1,
  },
  "POST /api/v1/organizations/:organizationId/encounters/:encounterId/slots/:slotId/assign": {
    commandId: randomUUID(), expectedVersion: 0, boardId: randomUUID(),
  },
  "POST /api/v1/organizations/:organizationId/encounters/:encounterId/slots/:slotId/release": {
    commandId: randomUUID(), expectedVersion: 0,
  },
  "POST /api/v1/organizations/:organizationId/encounters/:encounterId/slots/:slotId/walkover": {
    commandId: randomUUID(), expectedVersion: 0, winnerSide: "HOME", reason: "Testwalkover",
  },
  "POST /api/v1/organizations/:organizationId/encounters/:encounterId/forfeit": {
    commandId: randomUUID(), expectedVersion: 0, forfeitSide: "HOME", reason: "Testforfait",
  },
  "POST /api/v1/organizations/:organizationId/encounters/:encounterId/cancel": {
    commandId: randomUUID(), expectedVersion: 0, reason: "Testabbruch",
  },
};

let app: NestFastifyApplication;
let routes: readonly RouteEntry[];

beforeAll(async () => {
  await databaseService.database.insert(users).values({ id: ownerA, email: ownerAuth.user.email, displayName: "Owner A" });
  await databaseService.database.insert(organizations).values([
    { id: organizationA, name: "Verein A", slug: `verein-a-${organizationA}`, timezone: "Europe/Zurich", locale: "de-CH" },
    { id: organizationB, name: "Verein B", slug: `verein-b-${organizationB}`, timezone: "Europe/Zurich", locale: "de-CH" },
  ]);
  await databaseService.database.insert(memberships).values({ organizationId: organizationA, userId: ownerA, role: "OWNER", status: "ACTIVE" });
  ({ app, routes } = await collectRoutes({
    RATE_LIMIT_MAX_PER_MINUTE: 100_000, RATE_LIMIT_PUBLIC_MAX_PER_MINUTE: 100_000, RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: 100_000,
  }));
  vi.spyOn(app.get(AuthService), "getSession").mockResolvedValue(ownerAuth);
}, 60_000);

afterAll(async () => {
  await app.close();
  await databaseService.database.delete(organizations).where(inArray(organizations.id, [organizationA, organizationB]));
  await databaseService.database.delete(users).where(eq(users.id, ownerA));
  await databaseService.onApplicationShutdown();
});

function fillParams(url: string): string {
  return url
    .replace(":organizationId", organizationB)
    .replace(/:[A-Za-z]+Id/gu, () => randomUUID())
    .replace(/:[A-Za-z]+/gu, () => randomUUID());
}

describe("Tenant-Isolation: Owner von A gegen Ressourcen von B", () => {
  it("prüft jede Route mit :organizationId", async () => {
    const tenantRoutes = routes.filter((route) => route.url.includes(":organizationId"));
    expect(tenantRoutes.length).toBeGreaterThanOrEqual(40);

    const leaks: string[] = [];
    const unproven: string[] = [];

    for (const route of tenantRoutes) {
      const key = `${route.method} ${route.url}`;
      const isAvatarUpload = key.endsWith("/avatar") && route.method === "PUT";
      const payload =
        route.method === "GET" || route.method === "DELETE"
          ? undefined
          : isAvatarUpload
            ? Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
            : (bodies[key] ?? {});
      const response = await app.inject({
        method: route.method as "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
        url: fillParams(route.url),
        ...(payload === undefined ? {} : { payload }),
        // Fastifys JSON-Parser lehnt einen leeren Koerper mit
        // `content-type: application/json` mit 400 ab (FST_ERR_CTP_EMPTY_JSON_BODY).
        // Der Header gehoert daher nur gesetzt, wenn tatsaechlich ein Koerper folgt.
        ...(payload === undefined
          ? {}
          : { headers: { "content-type": isAvatarUpload ? "image/png" : "application/json" } }),
      });

      if (response.statusCode >= 200 && response.statusCode < 300) leaks.push(`${key} -> ${response.statusCode}`);
      else if (response.statusCode === 400 || response.statusCode === 415) unproven.push(`${key} -> ${response.statusCode} (Koerper ergaenzen)`);
      else if (response.statusCode !== 403 && response.statusCode !== 404) leaks.push(`${key} -> ${response.statusCode}`);
    }

    expect(leaks, `Fremdzugriff moeglich:\n${leaks.join("\n")}`).toEqual([]);
    expect(unproven, `Nicht bewiesen:\n${unproven.join("\n")}`).toEqual([]);
  }, 120_000);
});
