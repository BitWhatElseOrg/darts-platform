import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  competitions,
  encounters,
  memberships,
  organizationInvitations,
  organizations,
  teams,
  tournaments,
  users,
} from "@darts-platform/database";
import type { AuthContext } from "../auth/auth.types.js";
import { AuthService } from "../auth/auth.service.js";
import {
  INVITATION_CLAIM_HEADER,
  generateInvitationClaimToken,
  hashInvitationClaimToken,
} from "../auth/invitation-claim.js";
import { DatabaseService } from "../database/database.service.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { OrganizationsRepository } from "../organizations/organizations.repository.js";
import { EncountersRepository } from "../encounters/encounters.repository.js";
import { DisplayKeysRepository } from "../tournaments/display-keys.repository.js";
import { DisplayKeysService } from "../tournaments/display-keys.service.js";
import { TournamentsRepository } from "../tournaments/tournaments.repository.js";
import { RedisService } from "../redis/redis.service.js";
import {
  rejectSubscription,
  type RejectableSocket,
  type SubscriptionRejection,
} from "./subscription-limit.js";
import { SubscriptionAuthorization } from "./subscription-authorization.js";

// M8: Better Auths eigener Limiter zaehlt unabhaengig vom Fastify-Limiter
// (siehe `auth.integration.spec.ts`). Dieser Wert deckelt nicht, wie oft
// dieser Suite-eigene Anmeldevorgang laeuft.
const environment = {
  ...parseApplicationEnvironment(process.env),
  RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: 100_000,
};
const databaseService = new DatabaseService(environment);
const redisService = new RedisService(environment);
const authService = new AuthService(databaseService, environment, redisService);
const organizationsRepository = new OrganizationsRepository(databaseService);
const organizationAccessService = new OrganizationAccessService(organizationsRepository);
const tournamentsRepository = new TournamentsRepository(databaseService);
const displayKeysRepository = new DisplayKeysRepository(databaseService);
const displayKeysService = new DisplayKeysService(
  displayKeysRepository,
  tournamentsRepository,
  organizationAccessService,
);
const encountersRepository = new EncountersRepository(databaseService);

const authorization = new SubscriptionAuthorization(
  tournamentsRepository,
  authService,
  organizationsRepository,
  displayKeysService,
  encountersRepository,
);

const organizationId = randomUUID();
const inviterId = randomUUID();
const directorId = randomUUID();
const memberEmail = `subscription-member-${randomUUID()}@example.test`;

const directorAuth: AuthContext = {
  user: { id: directorId, email: `subscription-director-${directorId}@example.test`, name: "Turnierleitung" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const audit = { correlationId: randomUUID(), ip: "127.0.0.1", userAgent: "vitest" } as const;

let publicTournamentPublicId: string;
let privateTournamentPublicId: string;
let memberSessionCookie: string;
let knownEncounterPublicId: string;

function tournamentValues(visibility: "PUBLIC" | "PRIVATE") {
  return {
    organizationId,
    visibility,
    name: `Kanal-Autorisierung ${randomUUID()}`,
    format: "SINGLE_ELIMINATION",
    groupCount: 1,
    qualifyPerGroup: 1,
    knockoutSize: 2,
    seeding: "RANDOM",
    startsAt: new Date("2026-09-20T18:00:00.000Z"),
  } as const;
}

beforeAll(async () => {
  await databaseService.database.insert(users).values([
    { id: inviterId, email: `subscription-inviter-${inviterId}@example.test`, displayName: "Einladende Person" },
    { id: directorId, email: directorAuth.user.email, displayName: directorAuth.user.name },
  ]);
  await databaseService.database.insert(organizations).values({
    id: organizationId,
    name: "Kanal-Autorisierung Verein",
    slug: `subscription-auth-${organizationId}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });
  await databaseService.database.insert(memberships).values({
    organizationId,
    userId: directorId,
    role: "TOURNAMENT_DIRECTOR",
    status: "ACTIVE",
  });

  const [publicTournament] = await databaseService.database
    .insert(tournaments)
    .values(tournamentValues("PUBLIC"))
    .returning();
  const [privateTournament] = await databaseService.database
    .insert(tournaments)
    .values(tournamentValues("PRIVATE"))
    .returning();
  if (publicTournament === undefined || privateTournament === undefined) {
    throw new Error("Turnier wurde nicht angelegt.");
  }
  publicTournamentPublicId = publicTournament.publicId;
  privateTournamentPublicId = privateTournament.publicId;

  // Eine echte Anmeldung, wie in `auth/auth.integration.spec.ts` vorgemacht:
  // Einladung anlegen, per Anspruchstoken registrieren, das Sitzungscookie
  // aus der Antwort lesen.
  const claimToken = generateInvitationClaimToken();
  await databaseService.database.insert(organizationInvitations).values({
    organizationId,
    email: memberEmail,
    role: "MEMBER",
    claimTokenHash: hashInvitationClaimToken(claimToken),
    invitedByUserId: inviterId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
  });
  const signUpResponse = await authService.auth.handler(
    new Request(`${environment.BETTER_AUTH_URL}/api/v1/auth/sign-up/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: environment.WEB_ORIGIN,
        [INVITATION_CLAIM_HEADER]: claimToken,
      },
      body: JSON.stringify({
        name: "Vereinsmitglied",
        email: memberEmail,
        password: "IntegrationTest123!",
      }),
    }),
  );
  expect(signUpResponse.status).toBe(200);
  const setCookie = signUpResponse.headers.get("set-cookie");
  const sessionCookie = setCookie?.split(";", 1)[0];
  if (sessionCookie === undefined) {
    throw new Error("Better Auth did not return a member session cookie.");
  }
  memberSessionCookie = sessionCookie;

  const memberContext = await authService.getSession({ cookie: memberSessionCookie });
  if (memberContext === null) {
    throw new Error("Better Auth did not authenticate the member cookie.");
  }
  await databaseService.database.insert(memberships).values({
    organizationId,
    userId: memberContext.user.id,
    role: "MEMBER",
    status: "ACTIVE",
  });

  // Eine bekannte Begegnung: Liga ist per Reglement oeffentlich, es genuegt
  // ein einfacher Datensatz ohne Aufstellung (siehe
  // `matches/encounter-scoring-lock.integration.spec.ts` fuer dasselbe
  // minimale Fixture-Muster).
  const competitionId = randomUUID();
  const homeTeamId = randomUUID();
  const awayTeamId = randomUUID();
  await databaseService.database.insert(competitions).values({
    id: competitionId,
    organizationId,
    type: "LEAGUE",
    name: `Kanal-Autorisierung Liga ${competitionId}`,
    slug: `subscription-auth-${competitionId}`,
    status: "ACTIVE",
  });
  await databaseService.database.insert(teams).values([
    { id: homeTeamId, organizationId, name: `Heimteam ${homeTeamId}` },
    { id: awayTeamId, organizationId, name: `Gastteam ${awayTeamId}` },
  ]);
  const [encounter] = await databaseService.database
    .insert(encounters)
    .values({
      organizationId,
      competitionId,
      matchday: 1,
      homeTeamId,
      awayTeamId,
      scheduledAt: new Date("2026-09-20T19:00:00.000Z"),
    })
    .returning();
  if (encounter === undefined) throw new Error("Begegnung wurde nicht angelegt.");
  knownEncounterPublicId = encounter.publicId;
});

afterAll(async () => {
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(users).where(inArray(users.id, [inviterId, directorId]));
  await databaseService.database
    .delete(users)
    .where(eq(users.email, memberEmail));
  await databaseService.onApplicationShutdown();
  await redisService.onApplicationShutdown();
});

describe("SubscriptionAuthorization.authorizeTournament", () => {
  it("laesst ein oeffentliches Turnier ohne Cookie herein", async () => {
    const decision = await authorization.authorizeTournament({
      publicId: publicTournamentPublicId,
      headers: {},
      displayKeySecret: undefined,
    });

    expect(decision).toEqual({ kind: "allow" });
  });

  it("weist ein privates Turnier ohne Cookie ab", async () => {
    const decision = await authorization.authorizeTournament({
      publicId: privateTournamentPublicId,
      headers: {},
      displayKeySecret: undefined,
    });

    expect(decision).toEqual({ kind: "deny", reason: "SUBSCRIPTION_FORBIDDEN" });
  });

  it("laesst ein privates Turnier mit dem Cookie eines Mitglieds herein", async () => {
    const decision = await authorization.authorizeTournament({
      publicId: privateTournamentPublicId,
      headers: { cookie: memberSessionCookie },
      displayKeySecret: undefined,
    });

    expect(decision).toEqual({ kind: "allow" });
  });

  it("laesst ein privates Turnier mit gueltigem Anzeige-Schluessel herein", async () => {
    const created = await displayKeysService.create({
      organizationId,
      tournamentId: (await tournamentsRepository.getAccessFactsByPublicId(privateTournamentPublicId))!.id,
      data: { label: "Board 1" },
      auth: directorAuth,
      audit,
    });

    const decision = await authorization.authorizeTournament({
      publicId: privateTournamentPublicId,
      headers: {},
      displayKeySecret: created.secret,
    });

    expect(decision).toEqual({ kind: "allow" });
  });

  it("nennt eine unbekannte Adresse unbekannt", async () => {
    const decision = await authorization.authorizeTournament({
      publicId: randomUUID(),
      headers: {},
      displayKeySecret: undefined,
    });

    expect(decision).toEqual({ kind: "deny", reason: "SUBSCRIPTION_UNKNOWN_ROOM" });
  });

  it("liefert fuer die unbekannte und die verbotene Adresse denselben Client-Grund — sonst waere die Existenz des privaten Turniers selbst schon eine Information (Finding 1)", async () => {
    const forbidden = await authorization.authorizeTournament({
      publicId: privateTournamentPublicId,
      headers: {},
      displayKeySecret: undefined,
    });
    const unknown = await authorization.authorizeTournament({
      publicId: randomUUID(),
      headers: {},
      displayKeySecret: undefined,
    });
    if (forbidden.kind !== "deny" || unknown.kind !== "deny") {
      throw new Error("Beide Entscheidungen muessen ablehnen.");
    }
    // Die internen Gruende unterscheiden sich weiterhin (fuer die Logs in
    // `realtime.service.ts`) — nur das, was ueber die Steckdose geht, muss
    // gleich sein.
    expect(forbidden.reason).toBe("SUBSCRIPTION_FORBIDDEN");
    expect(unknown.reason).toBe("SUBSCRIPTION_UNKNOWN_ROOM");

    function clientPayload(reason: SubscriptionRejection): unknown {
      let payload: unknown;
      const socket: RejectableSocket = { emit: (_event, sent) => (payload = sent) };
      rejectSubscription(socket, "tournament:x", reason);
      return payload;
    }

    expect(clientPayload(forbidden.reason)).toEqual(clientPayload(unknown.reason));
  });
});

describe("SubscriptionAuthorization.authorizeEncounter", () => {
  it("laesst eine bekannte Begegnung herein — die Liga ist per Reglement oeffentlich", async () => {
    const decision = await authorization.authorizeEncounter({
      publicId: knownEncounterPublicId,
    });

    expect(decision).toEqual({ kind: "allow" });
  });

  it("nennt eine unbekannte Begegnung unbekannt", async () => {
    const decision = await authorization.authorizeEncounter({
      publicId: randomUUID(),
    });

    expect(decision).toEqual({ kind: "deny", reason: "SUBSCRIPTION_UNKNOWN_ROOM" });
  });
});
