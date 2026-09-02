import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { and, eq } from "drizzle-orm";

import {
  parseApplicationEnvironment,
  type ApplicationEnvironment,
} from "@darts-platform/config";
import {
  memberships,
  organizationInvitations,
  organizations,
  users,
} from "@darts-platform/database";

import { createAuth } from "../auth/auth.factory.js";
import {
  INVITATION_CLAIM_HEADER,
  generateInvitationClaimToken,
  hashInvitationClaimToken,
} from "../auth/invitation-claim.js";
import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { applySeedFixtures, type SeedSummary } from "../seeding/seed-fixtures.js";

export type { SeedSummary };

export const DEMO_EMAIL = "demo@dartbase.local";
export const DEMO_PASSWORD = "DartBaseDemo2026!";
export const DEMO_ORGANIZATION_SLUG = "dartbase-demo";

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

const DEFAULT_PROFILE: DevelopmentSeedProfile = {
  email: DEMO_EMAIL,
  password: DEMO_PASSWORD,
  organizationName: "DartBase Demo Club",
  organizationSlug: DEMO_ORGANIZATION_SLUG,
  tournamentPrefix: "Musterstadt",
};

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
    const invitationClaimToken = generateInvitationClaimToken();
    const bootstrapUserId = randomUUID();
    await database.insert(users).values({ id: bootstrapUserId, email: `seed-bootstrap-${bootstrapUserId}@example.test`, displayName: "Development Seed Bootstrap" });
    await database.insert(organizationInvitations).values({ organizationId: organization.id, email: normalizedEmail, role: "ADMIN", claimTokenHash: hashInvitationClaimToken(invitationClaimToken), invitedByUserId: bootstrapUserId, expiresAt: new Date(Date.now() + 60 * 60 * 1_000) });
    const auth = createAuth(database, environment);
    const response = await auth.handler(new Request(`${environment.BETTER_AUTH_URL}/api/v1/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: environment.WEB_ORIGIN, [INVITATION_CLAIM_HEADER]: invitationClaimToken },
      body: JSON.stringify({ name: "Demo Turnierleitung", email: normalizedEmail, password: profile.password }),
    }));
    if (!response.ok) throw new Error(`Demo account registration failed with HTTP ${response.status}.`);
    [user] = await database.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
    if (user === undefined) throw new Error("Demo user could not be loaded after registration.");
    await database.update(organizationInvitations).set({ invitedByUserId: user.id, status: "ACCEPTED", claimTokenHash: null, updatedAt: new Date() }).where(and(eq(organizationInvitations.organizationId, organization.id), eq(organizationInvitations.email, normalizedEmail)));
    await database.delete(users).where(eq(users.id, bootstrapUserId));
  }

  await database.insert(memberships).values({ organizationId: organization.id, userId: user.id, role: "OWNER", status: "ACTIVE" }).onConflictDoUpdate({ target: [memberships.organizationId, memberships.userId], set: { role: "OWNER", status: "ACTIVE" } });
  return {
    organizationId: organization.id,
    auth: { user: { id: user.id, email: user.email, name: user.displayName }, session: { id: randomUUID(), expiresAt: new Date("2099-01-01T00:00:00.000Z") } },
  };
}

export async function seedDevelopmentData(options: { readonly environment: ApplicationEnvironment; readonly profile?: DevelopmentSeedProfile; readonly allowRemote?: boolean }): Promise<SeedSummary> {
  const profile = options.profile ?? DEFAULT_PROFILE;
  assertDevelopmentSeedAllowed({ nodeEnv: options.environment.NODE_ENV, databaseUrl: options.environment.DATABASE_URL }, options.allowRemote ?? false);
  const databaseService = new DatabaseService(options.environment);
  try {
    const identity = await ensureIdentity(databaseService, options.environment, profile);

    return await applySeedFixtures({
      databaseService,
      organizationId: identity.organizationId,
      auth: identity.auth,
      names: {
        playerNames: DEMO_PLAYER_NAMES,
        tournamentNames: [
          `${profile.tournamentPrefix} Herbst-Cup`,
          `${profile.tournamentPrefix} Vereinsliga`,
          `${profile.tournamentPrefix} Open`,
        ],
        playerReferencePrefix: "development-seed-player-",
        boardNamePrefix: "Demo Board ",
      },
    });
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
