import { randomUUID } from "node:crypto";
import { count, eq, inArray } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  auditEvents,
  boards,
  competitions,
  encounters,
  matches,
  memberships,
  organizationInvitations,
  organizations,
  players,
  teams,
  tournamentDisplayKeys,
  tournaments,
  users,
} from "@darts-platform/database";
import { buildEncounterTemplate } from "@darts-platform/league-engine";

import { AuthService } from "../auth/auth.service.js";
import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { collectRoutes, type RouteEntry } from "../testing/route-inventory.js";

/**
 * Deckt Spec D1 ab: fuer jede Route mit `:organizationId` wird der Owner
 * von Organisation A gegen Ressourcen von Organisation B gefahren. Die
 * Routenliste kommt aus `collectRoutes` (Task 4) und wird nicht von Hand
 * gepflegt. Zwei Durchgaenge:
 *
 * 1. Zufaellige Kennungen fuer alle Pfadparameter ausser `:organizationId`
 *    — erwartet 403 oder 404, nie 2xx.
 * 2. Echte, vorher als Owner von B ueber die API angelegte Ressourcen —
 *    erwartet ausschliesslich 403 (die Ressource existiert, der Zugriff ist
 *    fremd), und ein Schnappschuss der Daten von B ist danach unveraendert:
 *    kein Schreibvorgang, kein Audit-Eintrag mit Owner A als Handelndem.
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
const ownerB = randomUUID();
const ownerBAuth: AuthContext = {
  user: { id: ownerB, email: `owner-b-${ownerB}@example.test`, name: "Owner B" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
/** Wen `AuthService.getSession` gerade meldet; Owner B nur fuer die Fixture. */
let currentAuth: AuthContext = ownerAuth;

/**
 * Gueltige Koerper je Route, damit die Tenant-Pruefung vor der
 * Koerper-Validierung ueberhaupt erreicht wird. Schluessel: "METHOD url".
 * Routen ohne Eintrag werden mit `{}` geschickt; ein 400 gilt dann als
 * "nicht bewiesen" und laesst den Test rot werden – der Eintrag ist dann
 * nachzutragen. Die Avatar-Upload-Route (`PUT .../avatar`) nimmt keinen
 * JSON-Koerper entgegen und wird unten gesondert behandelt.
 */
const bodies: Record<string, object> = {
  "PATCH /api/v1/organizations/:organizationId": { name: "Fremd umbenannt" },
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
  await databaseService.database.insert(users).values([
    { id: ownerA, email: ownerAuth.user.email, displayName: "Owner A" },
    { id: ownerB, email: ownerBAuth.user.email, displayName: "Owner B" },
  ]);
  await databaseService.database.insert(organizations).values([
    { id: organizationA, name: "Verein A", slug: `verein-a-${organizationA}`, timezone: "Europe/Zurich", locale: "de-CH" },
    { id: organizationB, name: "Verein B", slug: `verein-b-${organizationB}`, timezone: "Europe/Zurich", locale: "de-CH" },
  ]);
  await databaseService.database.insert(memberships).values([
    { organizationId: organizationA, userId: ownerA, role: "OWNER", status: "ACTIVE" },
    { organizationId: organizationB, userId: ownerB, role: "OWNER", status: "ACTIVE" },
  ]);
  ({ app, routes } = await collectRoutes({
    RATE_LIMIT_MAX_PER_MINUTE: 100_000, RATE_LIMIT_PUBLIC_MAX_PER_MINUTE: 100_000, RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: 100_000,
  }));
  vi.spyOn(app.get(AuthService), "getSession").mockImplementation(async () => currentAuth);
}, 60_000);

afterAll(async () => {
  await app.close();
  await databaseService.database.delete(organizations).where(inArray(organizations.id, [organizationA, organizationB]));
  await databaseService.database.delete(users).where(inArray(users.id, [ownerA, ownerB]));
  await databaseService.onApplicationShutdown();
});

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** Legt als Owner B ueber die API an; alles andere als 2xx ist ein Fixture-Fehler. */
async function createAsOwnerB<T>(method: Method, url: string, payload: object): Promise<T> {
  currentAuth = ownerBAuth;
  try {
    const response = await app.inject({ method, url, payload, headers: { "content-type": "application/json" } });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`Fixture ${method} ${url} -> ${response.statusCode}: ${response.body}`);
    }
    return response.json() as T;
  } finally {
    currentAuth = ownerAuth;
  }
}

/**
 * Echte Ressourcen von B, eine je Pfadparameter der Tenant-Routen. Der
 * Aufbau laeuft ueber dieselben Routen wie die Flaeche, damit die Daten
 * konsistent sind (Slots entstehen mit der Begegnung, der Anzeigeschluessel
 * mit dem Turnier). Ein Parameter ohne Eintrag laesst `fillRealParams`
 * scheitern — neue Pfadparameter muessen hier bewusst ergaenzt werden.
 */
async function createResourcesInB(): Promise<Record<string, string>> {
  const base = `/api/v1/organizations/${organizationB}`;
  const playerIds: string[] = [];
  for (let index = 1; index <= 6; index += 1) {
    const player = await createAsOwnerB<{ id: string }>("POST", `${base}/players`, {
      displayName: `B-Spieler ${index}`, status: "ACTIVE",
    });
    playerIds.push(player.id);
  }
  const board = await createAsOwnerB<{ id: string }>("POST", `${base}/boards`, { name: "B-Scheibe" });
  const match = await createAsOwnerB<{ id: string }>("POST", `${base}/matches`, {
    playerOneId: playerIds[4], playerTwoId: playerIds[5], boardId: null, bestOfLegs: 1, bestOfSets: 1,
  });
  const homeTeam = await createAsOwnerB<{ id: string }>("POST", `${base}/teams`, { name: "B-Heim" });
  const awayTeam = await createAsOwnerB<{ id: string }>("POST", `${base}/teams`, { name: "B-Gast" });
  const tournament = await createAsOwnerB<{ id: string }>("POST", `${base}/tournaments`, {
    name: "B-Turnier",
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    format: "SINGLE_ELIMINATION",
    startingScore: 501,
    inRule: "STRAIGHT",
    outRule: "DOUBLE",
    bestOfLegs: 1,
    bestOfSets: 1,
    participantIds: playerIds.slice(0, 4),
    groupCount: 1,
    qualifyPerGroup: 1,
    knockoutSize: 4,
    seeding: "RANDOM",
    boardIds: [board.id],
  });
  const displayKey = await createAsOwnerB<{ id: string }>(
    "POST", `${base}/tournaments/${tournament.id}/display-keys`, { label: "B-Anzeige" },
  );
  const competition = await createAsOwnerB<{ id: string }>("POST", `${base}/competitions`, {
    type: "LEAGUE",
    name: "B-Liga",
    slug: `b-liga-${randomUUID()}`,
    status: "ACTIVE",
    pointsWin: 3, pointsDraw: 1, pointsLoss: 0, pointsDeciderBonus: 1, deciderRule: "EXTRA_SLOT",
    lineupPositions: 4, minNominations: 4, minNominationsShorthanded: 3,
    maxSubstitutionsPerEncounter: 4, maxDoublesPerPlayer: 1,
    slots: buildEncounterTemplate({
      lineupPositions: 4, singlesStartingScore: 301, doublesStartingScore: 301,
      inRule: "STRAIGHT", outRule: "SINGLE", bestOfLegs: 1, maxRounds: null,
      regularDoubles: 2, withDecider: true,
    }),
  });
  const encounter = await createAsOwnerB<{ id: string; slots: ReadonlyArray<{ id: string }> }>(
    "POST", `${base}/competitions/${competition.id}/encounters`, {
      matchday: 1, homeTeamId: homeTeam.id, awayTeamId: awayTeam.id,
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
    },
  );
  const slotId = encounter.slots[0]?.id;
  if (slotId === undefined) throw new Error("Die Begegnung hat keine Slots erhalten.");
  const invitation = await createAsOwnerB<{ id: string }>("POST", `${base}/invitations`, {
    email: `gast-${randomUUID()}@example.test`, role: "MEMBER",
  });

  return {
    organizationId: organizationB,
    playerId: playerIds[0]!,
    matchId: match.id,
    userId: ownerB,
    invitationId: invitation.id,
    teamId: homeTeam.id,
    tournamentId: tournament.id,
    keyId: displayKey.id,
    competitionId: competition.id,
    encounterId: encounter.id,
    slotId,
  };
}

/**
 * Alles von B, was ein fremder Schreibzugriff veraendern koennte, in einer
 * vergleichbaren Form. Zeitstempel und Versionen sind Teil davon: auch ein
 * „Update ohne Aenderung" faellt so auf.
 */
async function snapshotOrganizationB() {
  const database = databaseService.database;
  const inB = (column: AnyPgColumn) => eq(column, organizationB);
  const [organization] = await database
    .select({ name: organizations.name, timezone: organizations.timezone, locale: organizations.locale, updatedAt: organizations.updatedAt })
    .from(organizations).where(eq(organizations.id, organizationB));
  const [auditCount] = await database
    .select({ count: count() }).from(auditEvents).where(inB(auditEvents.organizationId));
  const [auditByOwnerA] = await database
    .select({ count: count() }).from(auditEvents).where(eq(auditEvents.actorUserId, ownerA));
  return {
    organization,
    members: await database.select({ userId: memberships.userId, role: memberships.role, status: memberships.status })
      .from(memberships).where(inB(memberships.organizationId)).orderBy(memberships.userId),
    players: await database.select({ id: players.id, displayName: players.displayName, status: players.status, updatedAt: players.updatedAt })
      .from(players).where(inB(players.organizationId)).orderBy(players.id),
    boards: await database.select({ id: boards.id, name: boards.name, status: boards.status, updatedAt: boards.updatedAt })
      .from(boards).where(inB(boards.organizationId)).orderBy(boards.id),
    matches: await database.select({ id: matches.id, status: matches.status, version: matches.version, updatedAt: matches.updatedAt })
      .from(matches).where(inB(matches.organizationId)).orderBy(matches.id),
    teams: await database.select({ id: teams.id, name: teams.name, status: teams.status, updatedAt: teams.updatedAt })
      .from(teams).where(inB(teams.organizationId)).orderBy(teams.id),
    tournaments: await database.select({ id: tournaments.id, visibility: tournaments.visibility, version: tournaments.version, updatedAt: tournaments.updatedAt })
      .from(tournaments).where(inB(tournaments.organizationId)).orderBy(tournaments.id),
    displayKeys: await database.select({ id: tournamentDisplayKeys.id, revokedAt: tournamentDisplayKeys.revokedAt })
      .from(tournamentDisplayKeys)
      .innerJoin(tournaments, eq(tournamentDisplayKeys.tournamentId, tournaments.id))
      .where(inB(tournaments.organizationId)).orderBy(tournamentDisplayKeys.id),
    competitions: await database.select({ id: competitions.id, name: competitions.name, status: competitions.status, updatedAt: competitions.updatedAt })
      .from(competitions).where(inB(competitions.organizationId)).orderBy(competitions.id),
    encounters: await database.select({ id: encounters.id, status: encounters.status, version: encounters.version, updatedAt: encounters.updatedAt })
      .from(encounters).where(inB(encounters.organizationId)).orderBy(encounters.id),
    invitations: await database.select({ id: organizationInvitations.id, status: organizationInvitations.status })
      .from(organizationInvitations).where(inB(organizationInvitations.organizationId)).orderBy(organizationInvitations.id),
    auditCount: auditCount?.count ?? -1,
    auditByOwnerA: auditByOwnerA?.count ?? -1,
  };
}

function fillParams(url: string): string {
  return url
    .replace(":organizationId", organizationB)
    .replace(/:[A-Za-z]+Id/gu, () => randomUUID())
    .replace(/:[A-Za-z]+/gu, () => randomUUID());
}

function fillRealParams(url: string, realIds: Record<string, string>): string {
  return url.replace(/:([A-Za-z]+)/gu, (_match, name: string) => {
    const value = realIds[name];
    if (value === undefined) throw new Error(`Kein echter Wert fuer :${name} in ${url} — createResourcesInB ergaenzen.`);
    return value;
  });
}

function payloadFor(route: RouteEntry): { payload?: object | Buffer; headers?: Record<string, string> } {
  const key = `${route.method} ${route.url}`;
  const isAvatarUpload = key.endsWith("/avatar") && route.method === "PUT";
  if (route.method === "GET" || route.method === "DELETE") return {};
  if (isAvatarUpload) {
    return { payload: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), headers: { "content-type": "image/png" } };
  }
  // Fastifys JSON-Parser lehnt einen leeren Koerper mit
  // `content-type: application/json` mit 400 ab (FST_ERR_CTP_EMPTY_JSON_BODY).
  // Der Header gehoert daher nur gesetzt, wenn tatsaechlich ein Koerper folgt.
  return { payload: bodies[key] ?? {}, headers: { "content-type": "application/json" } };
}

describe("Tenant-Isolation: Owner von A gegen Ressourcen von B", () => {
  function tenantRoutes(): readonly RouteEntry[] {
    const found = routes.filter((route) => route.url.includes(":organizationId"));
    expect(
      found.length,
      `Nur ${found.length} tenant-bezogene Routen gefunden, erwartet mindestens 60 ` +
        "(Stand 18.09.2026: 67) — moeglicherweise ist das Routen-Inventar (collectRoutes) kaputt.",
    ).toBeGreaterThanOrEqual(60);
    return found;
  }

  it("prüft jede Route mit :organizationId gegen zufällige Kennungen (403 oder 404)", async () => {
    const leaks: string[] = [];
    const unproven: string[] = [];

    for (const route of tenantRoutes()) {
      const key = `${route.method} ${route.url}`;
      const response = await app.inject({
        method: route.method as Method,
        url: fillParams(route.url),
        ...payloadFor(route),
      });

      if (response.statusCode >= 200 && response.statusCode < 300) leaks.push(`${key} -> ${response.statusCode}`);
      else if (response.statusCode === 400 || response.statusCode === 415) unproven.push(`${key} -> ${response.statusCode} (Koerper ergaenzen)`);
      else if (response.statusCode !== 403 && response.statusCode !== 404) leaks.push(`${key} -> ${response.statusCode}`);
    }

    expect(leaks, `Fremdzugriff moeglich:\n${leaks.join("\n")}`).toEqual([]);
    expect(unproven, `Nicht bewiesen:\n${unproven.join("\n")}`).toEqual([]);
  }, 120_000);

  it("prüft jede Route mit :organizationId gegen echte Ressourcen von B (nur 403, keine Änderung)", async () => {
    const realIds = await createResourcesInB();
    const before = await snapshotOrganizationB();
    expect(before.players).toHaveLength(6);
    expect(before.encounters).toHaveLength(1);
    expect(before.auditByOwnerA).toBe(0);

    const wrong: string[] = [];
    for (const route of tenantRoutes()) {
      const key = `${route.method} ${route.url}`;
      const response = await app.inject({
        method: route.method as Method,
        url: fillRealParams(route.url, realIds),
        ...payloadFor(route),
      });
      if (response.statusCode !== 403) wrong.push(`${key} -> ${response.statusCode}`);
    }

    expect(wrong, `Nicht 403 bei existierender fremder Ressource:\n${wrong.join("\n")}`).toEqual([]);
    expect(await snapshotOrganizationB()).toEqual(before);
  }, 180_000);
});
