import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { memberships, organizations, users } from "@darts-platform/database";
import {
  hasOrganizationPermission,
  organizationPermissions,
  organizationRoles,
  type OrganizationPermission,
  type OrganizationRole,
} from "@darts-platform/domain";

import { AuthService } from "../auth/auth.service.js";
import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { createApiTestApplication } from "../testing/api-harness.js";

/**
 * Deckt Spec D2 ab: jede Permission aus `packages/domain/src/permissions.ts`
 * bekommt eine Probe (eine Route, deren Autorisierung vor der Fachlogik
 * greift), und jede der sechs Rollen wird gegen jede Probe gefahren. Die
 * erwartete Antwort kommt ausschliesslich aus `hasOrganizationPermission` —
 * nie aus einer im Test wiederholten Kopie der Rollentabelle.
 *
 * Payload-Regel: jede Probe muss ihre Zod-Validierung bestehen, sonst
 * antwortet der Controller mit 400, bevor `OrganizationAccessService`
 * ueberhaupt aufgerufen wird — das Ergebnis waere dann fuer jede Rolle
 * gleich und die Matrix truege kein Signal mehr. Fachliche Folgefehler
 * (404 Ressource fehlt, 409 Konflikt bei wiederverwendeten Namen) NACH der
 * Berechtigungspruefung sind dagegen erlaubt und zaehlen als «autorisiert».
 */
const environment = parseApplicationEnvironment(process.env);
const databaseService = new DatabaseService(environment);
const organizationId = randomUUID();
const userIds = Object.fromEntries(
  organizationRoles.map((role) => [role, randomUUID()]),
) as Record<OrganizationRole, string>;

interface Probe {
  readonly method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  readonly url: string;
  readonly payload?: object;
}

const probes: Record<OrganizationPermission, Probe> = {
  "organization:read": {
    method: "GET",
    url: `/api/v1/organizations/${organizationId}`,
  },
  "organization:update": {
    method: "PATCH",
    url: `/api/v1/organizations/${organizationId}`,
    payload: { name: "Matrix-Verein (umbenannt)" },
  },
  "organization:manage_members": {
    method: "GET",
    url: `/api/v1/organizations/${organizationId}/members`,
  },
  "organization:manage_roles": {
    method: "PATCH",
    url: `/api/v1/organizations/${organizationId}/members/${randomUUID()}`,
    payload: { role: "MEMBER" },
  },
  // Der falsche Name fuehrt nach der Berechtigungspruefung zu 400
  // `ORGANIZATION_NAME_MISMATCH` (zaehlt als "autorisiert"); die Probe
  // loescht also nie die Matrix-Organisation.
  "organization:delete": {
    method: "DELETE",
    url: `/api/v1/organizations/${organizationId}`,
    payload: { confirmName: "falscher Name" },
  },
  "player:read": {
    method: "GET",
    url: `/api/v1/organizations/${organizationId}/players`,
  },
  "player:create": {
    method: "POST",
    url: `/api/v1/organizations/${organizationId}/players`,
    payload: { displayName: `P-${randomUUID()}`, status: "ACTIVE" },
  },
  "player:update": {
    method: "PATCH",
    url: `/api/v1/organizations/${organizationId}/players/${randomUUID()}`,
    payload: { displayName: "X" },
  },
  "player:archive": {
    method: "DELETE",
    url: `/api/v1/organizations/${organizationId}/players/${randomUUID()}`,
  },
  "player:delete": {
    method: "DELETE",
    url: `/api/v1/organizations/${organizationId}/players/${randomUUID()}/permanent`,
  },
  "board:read": {
    method: "GET",
    url: `/api/v1/organizations/${organizationId}/boards`,
  },
  "board:manage": {
    method: "POST",
    url: `/api/v1/organizations/${organizationId}/boards`,
    payload: { name: `B-${randomUUID()}` },
  },
  "match:read": {
    method: "GET",
    url: `/api/v1/organizations/${organizationId}/matches`,
  },
  "match:create": {
    method: "POST",
    url: `/api/v1/organizations/${organizationId}/matches`,
    payload: {
      playerOneId: randomUUID(),
      playerTwoId: randomUUID(),
      boardId: null,
      bestOfLegs: 1,
      bestOfSets: 1,
    },
  },
  "match:score": {
    method: "POST",
    url: `/api/v1/organizations/${organizationId}/matches/${randomUUID()}/visits`,
    payload: {
      commandId: randomUUID(),
      expectedVersion: 0,
      playerId: randomUUID(),
      points: 60,
      dartsThrown: 3,
    },
  },
  "match:undo": {
    method: "POST",
    url: `/api/v1/organizations/${organizationId}/matches/${randomUUID()}/undo`,
    payload: { commandId: randomUUID(), expectedVersion: 0 },
  },
  "match:abort": {
    method: "POST",
    url: `/api/v1/organizations/${organizationId}/matches/${randomUUID()}/abort`,
    payload: { commandId: randomUUID(), expectedVersion: 0, reason: "Test" },
  },
  "tournament:read": {
    method: "GET",
    url: `/api/v1/organizations/${organizationId}/tournaments`,
  },
  // `createTournamentSchema` verlangt ein vollstaendiges Turnier (Reglement-
  // unabhaengig, reine API-Validierung): ohne gueltigen Rumpf antwortet der
  // Controller schon vor der Rechtepruefung mit 400 und die Probe wuerde nie
  // die Autorisierung erreichen. Die Teilnehmer-/Board-IDs existieren nicht,
  // was nach der Rechtepruefung zu einem Fachfehler statt zu einem Erfolg
  // fuehrt — das zaehlt laut Aufgabenstellung weiterhin als «autorisiert».
  "tournament:create": {
    method: "POST",
    url: `/api/v1/organizations/${organizationId}/tournaments`,
    payload: {
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
  },
  "tournament:update": {
    method: "PATCH",
    url: `/api/v1/organizations/${organizationId}/tournaments/${randomUUID()}/visibility`,
    payload: { visibility: "PUBLIC" },
  },
  "tournament:share": {
    method: "GET",
    url: `/api/v1/organizations/${organizationId}/tournaments/${randomUUID()}/display-keys`,
  },
  "statistics:read": {
    method: "GET",
    url: `/api/v1/organizations/${organizationId}/players/${randomUUID()}/statistics`,
  },
  "board:assign": {
    method: "POST",
    url: `/api/v1/organizations/${organizationId}/tournaments/${randomUUID()}/assignments`,
    payload: {
      commandId: randomUUID(),
      expectedVersion: 0,
      matchId: randomUUID(),
      boardId: randomUUID(),
    },
  },
  "team:read": {
    method: "GET",
    url: `/api/v1/organizations/${organizationId}/teams`,
  },
  "team:manage": {
    method: "POST",
    url: `/api/v1/organizations/${organizationId}/teams`,
    payload: { name: `T-${randomUUID()}` },
  },
  "competition:read": {
    method: "GET",
    url: `/api/v1/organizations/${organizationId}/competitions`,
  },
  // `createCompetitionSchema` verlangt Name, Slug und mindestens einen Slot;
  // dieselbe Begruendung wie bei `tournament:create` gilt hier.
  "competition:manage": {
    method: "POST",
    url: `/api/v1/organizations/${organizationId}/competitions`,
    payload: {
      name: "Matrix-Wettbewerb",
      slug: `matrix-${randomUUID()}`,
      slots: [
        {
          sequence: 1,
          discipline: "SINGLES",
          label: "S1",
          startingScore: 501,
          bestOfLegs: 5,
        },
      ],
    },
  },
  "encounter:read": {
    method: "GET",
    url: `/api/v1/organizations/${organizationId}/encounters/${randomUUID()}`,
  },
  // `startEncounterSchema` verlangt `commandId`/`expectedVersion`; ein
  // leerer Rumpf waere schon an der Validierung gescheitert.
  "encounter:manage": {
    method: "POST",
    url: `/api/v1/organizations/${organizationId}/encounters/${randomUUID()}/start`,
    payload: { commandId: randomUUID(), expectedVersion: 0 },
  },
  // `submitNominationsSchema` verlangt `commandId`/`expectedVersion`, eine
  // Seite und mindestens eine Nominierung; auch hier scheiterte `{}` an der
  // Validierung, bevor die Rechtepruefung ueberhaupt lief.
  "encounter:lineup": {
    method: "POST",
    url: `/api/v1/organizations/${organizationId}/encounters/${randomUUID()}/nominations`,
    payload: {
      commandId: randomUUID(),
      expectedVersion: 0,
      side: "HOME",
      nominations: [{ position: 1, playerId: randomUUID() }],
    },
  },
};

let app: NestFastifyApplication;

beforeAll(async () => {
  await databaseService.database.insert(users).values(
    organizationRoles.map((role) => ({
      id: userIds[role],
      email: `${role.toLowerCase()}-${userIds[role]}@example.test`,
      displayName: role,
    })),
  );
  await databaseService.database.insert(organizations).values({
    id: organizationId,
    name: "Matrix-Verein",
    slug: `matrix-${organizationId}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });
  await databaseService.database.insert(memberships).values(
    organizationRoles.map((role) => ({
      organizationId,
      userId: userIds[role],
      role,
      status: "ACTIVE" as const,
    })),
  );
  app = await createApiTestApplication({
    RATE_LIMIT_MAX_PER_MINUTE: 100_000,
    RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: 100_000,
  });
}, 60_000);

afterAll(async () => {
  await app.close();
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(users).where(inArray(users.id, Object.values(userIds)));
  await databaseService.onApplicationShutdown();
});

function authFor(role: OrganizationRole): AuthContext {
  return {
    user: { id: userIds[role], email: `${role.toLowerCase()}-${userIds[role]}@example.test`, name: role },
    session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
  };
}

describe("Permission-Matrix: jede Rolle gegen jede Permission", () => {
  it("deckt alle Permissions mit einer Probe ab", () => {
    expect(Object.keys(probes).sort()).toEqual([...organizationPermissions].sort());
  });

  for (const role of organizationRoles) {
    it(`Rolle ${role}`, async () => {
      vi.spyOn(app.get(AuthService), "getSession").mockResolvedValue(authFor(role));
      const wrong: string[] = [];

      for (const permission of organizationPermissions) {
        const probe = probes[permission];
        const response = await app.inject({
          method: probe.method,
          url: probe.url,
          ...(probe.payload === undefined ? {} : { payload: probe.payload }),
        });
        const allowed = hasOrganizationPermission(role, permission);
        const denied = response.statusCode === 403;
        if (allowed && denied) wrong.push(`${permission}: erwartet erlaubt, bekam 403`);
        if (!allowed && !denied) wrong.push(`${permission}: erwartet 403, bekam ${response.statusCode}`);
      }

      expect(wrong, wrong.join("\n")).toEqual([]);
    }, 120_000);
  }
});
