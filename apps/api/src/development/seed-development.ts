export const DEMO_EMAIL = "demo@dart-ost.local";
export const DEMO_PASSWORD = "DartOstDemo2026!";
export const DEMO_ORGANIZATION_SLUG = "dart-ost-demo";

export const DEMO_PLAYER_NAMES = [
  "Alina Frei", "Basil Kern", "Céline Moser", "Dario Bühler",
  "Elin Roth", "Fabio Graf", "Gianna Keller", "Henrik Maurer",
  "Iva Brunner", "Jonas Ziegler", "Kira Baumann", "Lars Widmer",
  "Mara Schmid", "Noah Wenger", "Olivia Meier", "Pascal Vogel",
  "Quinn Steiner", "Rina Hofer", "Sandro Lüthi", "Tabea Arnold",
  "Uma Gasser", "Valentin Furrer", "Wanda Suter", "Xaver Ammann",
  "Yara Kunz", "Yves Huber", "Zoé Gerber", "Adrian Egli",
  "Bianca Marti", "Cedric Stalder", "Delia Hug", "Ennio Ackermann",
] as const;

export function assertDevelopmentSeedAllowed(input: {
  readonly nodeEnv: string;
  readonly databaseUrl: string;
}, allowRemote: boolean): void {
  if (input.nodeEnv === "production") {
    throw new Error("The development seed is disabled in production.");
  }
  const hostname = new URL(input.databaseUrl).hostname;
  if (!allowRemote && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname)) {
    throw new Error("The development seed refuses a non-local database without ALLOW_REMOTE_DEV_SEED=true.");
  }
}

export interface DevelopmentSeedProfile {
  readonly email: string;
  readonly password: string;
  readonly organizationName: string;
  readonly organizationSlug: string;
  readonly tournamentPrefix: string;
}

export interface SeedSummary {
  readonly organizationId: string;
  readonly players: number;
  readonly boards: number;
  readonly completedTournaments: number;
  readonly runningTournaments: number;
  readonly activeScoringMatches: number;
  readonly readyMatches: number;
}

const DEFAULT_PROFILE: DevelopmentSeedProfile = {
  email: DEMO_EMAIL,
  password: DEMO_PASSWORD,
  organizationName: "Dart Ost Demo Club",
  organizationSlug: DEMO_ORGANIZATION_SLUG,
  tournamentPrefix: "Musterstadt",
};

const audit: AuditContext = { ip: "127.0.0.1", userAgent: "development-seed", correlationId: randomUUID() };

function stableUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = "8";
  const compact = hex.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

async function ensureIdentity(databaseService: DatabaseService, environment: ApplicationEnvironment, profile: DevelopmentSeedProfile): Promise<{ readonly organizationId: string; readonly auth: AuthContext }> {
  const database = databaseService.database;
  const normalizedEmail = profile.email.trim().toLowerCase();
  let [organization] = await database.select().from(organizations).where(eq(organizations.slug, profile.organizationSlug)).limit(1);
  let [user] = await database.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);

  if (organization === undefined) {
    [organization] = await database.insert(organizations).values({ name: profile.organizationName, slug: profile.organizationSlug, timezone: "Europe/Zurich", locale: "de-CH" }).returning();
  }
  if (organization === undefined) throw new Error("Demo organization could not be created.");

  if (user === undefined) {
    const bootstrapUserId = randomUUID();
    await database.insert(users).values({ id: bootstrapUserId, email: `seed-bootstrap-${bootstrapUserId}@example.test`, displayName: "Development Seed Bootstrap" });
    await database.insert(organizationInvitations).values({ organizationId: organization.id, email: normalizedEmail, role: "ADMIN", invitedByUserId: bootstrapUserId, expiresAt: new Date(Date.now() + 60 * 60 * 1_000) });
    const auth = createAuth(database, environment);
    const response = await auth.handler(new Request(`${environment.BETTER_AUTH_URL}/api/v1/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: environment.WEB_ORIGIN },
      body: JSON.stringify({ name: "Demo Turnierleitung", email: normalizedEmail, password: profile.password }),
    }));
    if (!response.ok) throw new Error(`Demo account registration failed with HTTP ${response.status}.`);
    [user] = await database.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
    if (user === undefined) throw new Error("Demo user could not be loaded after registration.");
    await database.update(organizationInvitations).set({ invitedByUserId: user.id, status: "ACCEPTED", updatedAt: new Date() }).where(and(eq(organizationInvitations.organizationId, organization.id), eq(organizationInvitations.email, normalizedEmail)));
    await database.delete(users).where(eq(users.id, bootstrapUserId));
  }

  await database.insert(memberships).values({ organizationId: organization.id, userId: user.id, role: "OWNER", status: "ACTIVE" }).onConflictDoUpdate({ target: [memberships.organizationId, memberships.userId], set: { role: "OWNER", status: "ACTIVE" } });
  return {
    organizationId: organization.id,
    auth: { user: { id: user.id, email: user.email, name: user.displayName }, session: { id: stableUuid(`${profile.organizationSlug}:session`), expiresAt: new Date("2099-01-01T00:00:00.000Z") } },
  };
}

function services(databaseService: DatabaseService) {
  const organizationsRepository = new OrganizationsRepository(databaseService);
  const access = new OrganizationAccessService(organizationsRepository);
  const playersService = new PlayersService(new PlayersRepository(databaseService), access);
  const boardsService = new BoardsService(databaseService, access);
  const matchesRepository = new MatchesRepository(databaseService);
  const matchesService = new MatchesService(matchesRepository, access);
  const tournamentsRepository = new TournamentsRepository(databaseService);
  const tournamentsService = new TournamentsService(tournamentsRepository, matchesRepository, access);
  return { playersService, boardsService, matchesService, tournamentsService };
}

async function finishScoringMatch(input: { readonly organizationId: string; readonly scoringMatchId: string; readonly auth: AuthContext; readonly matchesService: MatchesService }): Promise<void> {
  let state = await input.matchesService.get({ organizationId: input.organizationId, matchId: input.scoringMatchId, auth: input.auth });
  const winnerId = state.participants[0].playerId;
  for (let guard = 0; state.status !== "COMPLETED" && guard < 10; guard += 1) {
    const currentPlayerId = state.currentPlayerId;
    if (currentPlayerId === null) throw new Error("Active seed match has no current player.");
    const playerVisits = state.visits.filter((visit) => visit.playerId === currentPlayerId && !visit.reverted).length;
    const winnerTurn = currentPlayerId === winnerId;
    const points = winnerTurn ? ([180, 180, 141][playerVisits] ?? 0) : 60;
    const checkout = winnerTurn && points === 141;
    state = await input.matchesService.submitVisit({
      organizationId: input.organizationId,
      matchId: state.id,
      data: {
        commandId: stableUuid(`seed:visit:${state.id}:${currentPlayerId}:${playerVisits}`),
        expectedVersion: state.version,
        playerId: currentPlayerId,
        points,
        dartsThrown: 3,
        checkoutAttempts: checkout ? 1 : 0,
        ...(checkout ? { checkoutDouble: 12 } : {}),
      },
      auth: input.auth,
      audit,
    });
  }
  if (state.status !== "COMPLETED") throw new Error("Seed match did not complete within the command guard.");
}

async function scoringMatchId(databaseService: DatabaseService, organizationId: string, tournamentMatchId: string): Promise<string> {
  const [row] = await databaseService.database.select({ scoringMatchId: tournamentMatches.scoringMatchId }).from(tournamentMatches).where(and(eq(tournamentMatches.organizationId, organizationId), eq(tournamentMatches.id, tournamentMatchId))).limit(1);
  if (row?.scoringMatchId === null || row?.scoringMatchId === undefined) throw new Error("Assigned tournament match has no scoring match.");
  return row.scoringMatchId;
}

async function completeTournament(input: { readonly databaseService: DatabaseService; readonly organizationId: string; readonly tournamentId: string; readonly auth: AuthContext; readonly boardIds: readonly string[]; readonly matchesService: MatchesService; readonly tournamentsService: TournamentsService }): Promise<void> {
  for (let guard = 0; guard < 128; guard += 1) {
    let dashboard = await input.tournamentsService.dashboard({ organizationId: input.organizationId, tournamentId: input.tournamentId, auth: input.auth });
    if (dashboard.tournament.status === "COMPLETED") return;
    const playing = dashboard.boards.find((board) => board.state === "PLAYING")?.match;
    if (playing !== null && playing !== undefined) {
      await finishScoringMatch({ organizationId: input.organizationId, scoringMatchId: await scoringMatchId(input.databaseService, input.organizationId, playing.matchId), auth: input.auth, matchesService: input.matchesService });
      continue;
    }
    const ready = dashboard.queue.find((match) => match.readiness === "READY");
    const board = dashboard.boards.find((candidate) => candidate.state === "FREE");
    if (ready === undefined || board === undefined) throw new Error("Seed tournament cannot make progress.");
    dashboard = await input.tournamentsService.assign({ organizationId: input.organizationId, tournamentId: input.tournamentId, data: { commandId: stableUuid(`seed:assign:${ready.matchId}`), expectedVersion: dashboard.tournament.version, matchId: ready.matchId, boardId: board.boardId }, auth: input.auth, audit });
    await finishScoringMatch({ organizationId: input.organizationId, scoringMatchId: await scoringMatchId(input.databaseService, input.organizationId, ready.matchId), auth: input.auth, matchesService: input.matchesService });
  }
  throw new Error("Seed tournament did not complete within the tournament guard.");
}

async function ensureTournament(input: { readonly organizationId: string; readonly name: string; readonly format: "SINGLE_ELIMINATION" | "ROUND_ROBIN" | "GROUPS_THEN_KNOCKOUT"; readonly participantIds: readonly string[]; readonly boardIds: readonly string[]; readonly knockoutSize: 2 | 4 | 8 | 16 | 32 | 64; readonly groupCount: number; readonly qualifyPerGroup: number; readonly auth: AuthContext; readonly tournamentsService: TournamentsService }): Promise<string> {
  const existing = (await input.tournamentsService.list({ organizationId: input.organizationId, auth: input.auth })).find((tournament) => tournament.name === input.name);
  if (existing !== undefined) return existing.id;
  const created = await input.tournamentsService.create({ organizationId: input.organizationId, data: { name: input.name, startsAt: new Date("2026-08-29T12:00:00.000Z"), format: input.format, startingScore: 501, doubleOut: true, bestOfLegs: 1, bestOfSets: 1, participantIds: [...input.participantIds], groupCount: input.groupCount, qualifyPerGroup: input.qualifyPerGroup, knockoutSize: input.knockoutSize, seeding: "SEEDED", boardIds: [...input.boardIds] }, auth: input.auth, audit });
  return created.id;
}

async function prepareRunningTournament(input: { readonly databaseService: DatabaseService; readonly organizationId: string; readonly tournamentId: string; readonly auth: AuthContext; readonly matchesService: MatchesService; readonly tournamentsService: TournamentsService }): Promise<void> {
  for (let guard = 0; guard < 16; guard += 1) {
    let dashboard = await input.tournamentsService.dashboard({ organizationId: input.organizationId, tournamentId: input.tournamentId, auth: input.auth });
    const completedGroupMatches = await input.databaseService.database.select({ id: tournamentMatches.id }).from(tournamentMatches).where(and(eq(tournamentMatches.organizationId, input.organizationId), eq(tournamentMatches.tournamentId, input.tournamentId), eq(tournamentMatches.status, "COMPLETED")));
    const playing = dashboard.boards.find((board) => board.state === "PLAYING")?.match;
    if (completedGroupMatches.length < 4) {
      if (playing !== null && playing !== undefined) {
        await finishScoringMatch({ organizationId: input.organizationId, scoringMatchId: await scoringMatchId(input.databaseService, input.organizationId, playing.matchId), auth: input.auth, matchesService: input.matchesService });
        continue;
      }
      const ready = dashboard.queue.find((match) => match.readiness === "READY");
      const board = dashboard.boards.find((candidate) => candidate.state === "FREE");
      if (ready === undefined || board === undefined) throw new Error("Running demo tournament cannot schedule a group match.");
      await input.tournamentsService.assign({ organizationId: input.organizationId, tournamentId: input.tournamentId, data: { commandId: stableUuid(`seed:running:assign:${ready.matchId}`), expectedVersion: dashboard.tournament.version, matchId: ready.matchId, boardId: board.boardId }, auth: input.auth, audit });
      continue;
    }
    if (playing !== null && playing !== undefined) {
      const active = await input.matchesService.get({ organizationId: input.organizationId, matchId: await scoringMatchId(input.databaseService, input.organizationId, playing.matchId), auth: input.auth });
      if (active.visits.length === 0 && active.currentPlayerId !== null) {
        await input.matchesService.submitVisit({ organizationId: input.organizationId, matchId: active.id, data: { commandId: stableUuid(`seed:running:opening:${active.id}`), expectedVersion: active.version, playerId: active.currentPlayerId, points: 100, dartsThrown: 3, checkoutAttempts: 0 }, auth: input.auth, audit });
      }
      return;
    }
    const ready = dashboard.queue.find((match) => match.readiness === "READY");
    const board = dashboard.boards.find((candidate) => candidate.state === "FREE");
    if (ready === undefined || board === undefined) throw new Error("Running demo tournament has no fifth match.");
    dashboard = await input.tournamentsService.assign({ organizationId: input.organizationId, tournamentId: input.tournamentId, data: { commandId: stableUuid(`seed:running:assign:${ready.matchId}`), expectedVersion: dashboard.tournament.version, matchId: ready.matchId, boardId: board.boardId }, auth: input.auth, audit });
  }
  throw new Error("Running demo tournament did not reach its target state.");
}

export async function seedDevelopmentData(options: { readonly environment: ApplicationEnvironment; readonly profile?: DevelopmentSeedProfile; readonly allowRemote?: boolean }): Promise<SeedSummary> {
  const profile = options.profile ?? DEFAULT_PROFILE;
  assertDevelopmentSeedAllowed({ nodeEnv: options.environment.NODE_ENV, databaseUrl: options.environment.DATABASE_URL }, options.allowRemote ?? false);
  const databaseService = new DatabaseService(options.environment);
  try {
    const identity = await ensureIdentity(databaseService, options.environment, profile);
    const application = services(databaseService);

    const existingPlayers = await application.playersService.list({ organizationId: identity.organizationId, auth: identity.auth });
    for (const [index, displayName] of DEMO_PLAYER_NAMES.entries()) {
      const externalReference = `development-seed-player-${index + 1}`;
      if (existingPlayers.some((player) => player.externalReference === externalReference)) continue;
      await application.playersService.create({ organizationId: identity.organizationId, data: { displayName, status: "ACTIVE", externalReference }, auth: identity.auth, audit });
    }
    const playerRows = await databaseService.database.select().from(players).where(and(eq(players.organizationId, identity.organizationId), inArray(players.externalReference, DEMO_PLAYER_NAMES.map((_, index) => `development-seed-player-${index + 1}`))));
    const orderedPlayers = [...playerRows].sort((left, right) => (left.externalReference ?? "").localeCompare(right.externalReference ?? "", undefined, { numeric: true }));

    const existingBoards = await application.boardsService.list({ organizationId: identity.organizationId, auth: identity.auth });
    for (let index = 1; index <= 8; index += 1) {
      const name = `Demo Board ${index}`;
      if (!existingBoards.some((board) => board.name === name)) await application.boardsService.create({ organizationId: identity.organizationId, data: { name }, auth: identity.auth, audit });
    }
    const boardRows = await databaseService.database.select().from(boards).where(and(eq(boards.organizationId, identity.organizationId), inArray(boards.name, Array.from({ length: 8 }, (_, index) => `Demo Board ${index + 1}`))));
    const orderedBoards = [...boardRows].sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
    const playerIds = orderedPlayers.map((player) => player.id);
    const boardIds = orderedBoards.map((board) => board.id);
    if (playerIds.length !== 32 || boardIds.length !== 8) throw new Error("Demo players or boards are incomplete.");

    const knockoutId = await ensureTournament({ organizationId: identity.organizationId, name: `${profile.tournamentPrefix} Herbst-Cup`, format: "SINGLE_ELIMINATION", participantIds: playerIds.slice(0, 8), boardIds, knockoutSize: 8, groupCount: 1, qualifyPerGroup: 1, auth: identity.auth, tournamentsService: application.tournamentsService });
    await completeTournament({ databaseService, organizationId: identity.organizationId, tournamentId: knockoutId, auth: identity.auth, boardIds, matchesService: application.matchesService, tournamentsService: application.tournamentsService });
    const leagueId = await ensureTournament({ organizationId: identity.organizationId, name: `${profile.tournamentPrefix} Vereinsliga`, format: "ROUND_ROBIN", participantIds: playerIds.slice(8, 12), boardIds, knockoutSize: 4, groupCount: 1, qualifyPerGroup: 1, auth: identity.auth, tournamentsService: application.tournamentsService });
    await completeTournament({ databaseService, organizationId: identity.organizationId, tournamentId: leagueId, auth: identity.auth, boardIds, matchesService: application.matchesService, tournamentsService: application.tournamentsService });
    const runningId = await ensureTournament({ organizationId: identity.organizationId, name: `${profile.tournamentPrefix} Open`, format: "GROUPS_THEN_KNOCKOUT", participantIds: playerIds, boardIds, knockoutSize: 16, groupCount: 8, qualifyPerGroup: 2, auth: identity.auth, tournamentsService: application.tournamentsService });
    await prepareRunningTournament({ databaseService, organizationId: identity.organizationId, tournamentId: runningId, auth: identity.auth, matchesService: application.matchesService, tournamentsService: application.tournamentsService });

    const tournamentNames = [`${profile.tournamentPrefix} Herbst-Cup`, `${profile.tournamentPrefix} Vereinsliga`, `${profile.tournamentPrefix} Open`];
    const tournamentRows = await databaseService.database.select().from(tournaments).where(and(eq(tournaments.organizationId, identity.organizationId), inArray(tournaments.name, tournamentNames)));
    const dashboard = await application.tournamentsService.dashboard({ organizationId: identity.organizationId, tournamentId: runningId, auth: identity.auth });
    return {
      organizationId: identity.organizationId,
      players: playerIds.length,
      boards: boardIds.length,
      completedTournaments: tournamentRows.filter((tournament) => tournament.status === "COMPLETED").length,
      runningTournaments: tournamentRows.filter((tournament) => tournament.status !== "COMPLETED").length,
      activeScoringMatches: dashboard.boards.filter((board) => board.state === "PLAYING").length,
      readyMatches: dashboard.queue.filter((match) => match.readiness === "READY").length,
    };
  } finally {
    await databaseService.onApplicationShutdown();
  }
}

async function main(): Promise<void> {
  const environment = parseApplicationEnvironment(process.env);
  const summary = await seedDevelopmentData({ environment, allowRemote: process.env.ALLOW_REMOTE_DEV_SEED === "true" });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\nDemo-Login: ${DEMO_EMAIL}\nDemo-Passwort: ${DEMO_PASSWORD}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { and, eq, inArray } from "drizzle-orm";

import { parseApplicationEnvironment, type ApplicationEnvironment } from "@darts-platform/config";
import {
  boards,
  memberships,
  organizationInvitations,
  organizations,
  players,
  tournamentMatches,
  tournaments,
  users,
} from "@darts-platform/database";

import { createAuth } from "../auth/auth.factory.js";
import type { AuthContext } from "../auth/auth.types.js";
import type { AuditContext } from "../common/audit-context.js";
import { DatabaseService } from "../database/database.service.js";
import { BoardsService } from "../boards/boards.service.js";
import { MatchesRepository } from "../matches/matches.repository.js";
import { MatchesService } from "../matches/matches.service.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { OrganizationsRepository } from "../organizations/organizations.repository.js";
import { PlayersRepository } from "../players/players.repository.js";
import { PlayersService } from "../players/players.service.js";
import { TournamentsRepository } from "../tournaments/tournaments.repository.js";
import { TournamentsService } from "../tournaments/tournaments.service.js";
