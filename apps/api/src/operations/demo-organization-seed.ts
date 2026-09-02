import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

import {
  memberships,
  organizations,
  users,
  type Database,
} from "@darts-platform/database";

import type { ApplicationEnvironment } from "@darts-platform/config";

import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { applySeedFixtures, type SeedSummary } from "../seeding/seed-fixtures.js";

export const DEMO_PLAYER_NAMES = [
  "Deadpool", "Rambo", "Superman", "Batman",
  "Iron Man", "Spider-Man", "Thor", "Hulk",
  "Wolverine", "Rocky Balboa", "Indiana Jones", "James Bond",
  "John Wick", "Terminator", "Jack Sparrow", "Neo",
  "Wonder Woman", "Lara Croft", "Black Widow", "Captain Marvel",
  "Harley Quinn", "Catwoman", "Supergirl", "Mulan",
  "Ellen Ripley", "Sarah Connor", "Katniss Everdeen", "Princess Leia",
  "Rey Skywalker", "Furiosa", "Beatrix Kiddo", "Wednesday Addams",
] as const;

/** Knockout, league and running tournament, in that order. */
export const DEMO_TOURNAMENT_NAMES = [
  "Movie Masters",
  "Hero Open League",
  "Legends of the Oche",
] as const;

export interface DemoSeedActor {
  readonly organizationId: string;
  readonly auth: AuthContext;
}

export function assertDemoSeedAllowed(input: {
  readonly nodeEnv: string;
  readonly allowDemoSeed: boolean;
}): void {
  if (input.nodeEnv !== "production" || input.allowDemoSeed !== true) {
    throw new Error(
      "The demo seed requires NODE_ENV=production and ALLOW_DEMO_SEED=true.",
    );
  }
}

export async function resolveDemoSeedActor(
  database: Database,
  organizationId: string,
): Promise<DemoSeedActor> {
  const [organization] = await database
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  if (organization === undefined) {
    throw new Error(
      "The demo seed found no organization with the configured id.",
    );
  }

  const [owner] = await database
    .select({
      userId: memberships.userId,
      email: users.email,
      displayName: users.displayName,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.organizationId, organization.id),
        eq(memberships.role, "OWNER"),
        eq(memberships.status, "ACTIVE"),
      ),
    )
    .limit(1);

  if (owner === undefined) {
    throw new Error(
      "The demo seed found no active owner membership in the organization.",
    );
  }

  return {
    organizationId: organization.id,
    auth: {
      user: {
        id: owner.userId,
        email: owner.email,
        name: owner.displayName,
      },
      session: {
        id: randomUUID(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      },
    },
  };
}

/**
 * Fills an organization that already exists with demo data. It never creates an
 * organization, a user or a membership: the caller's organization must already
 * have an active owner, and that owner is who the seed acts as.
 */
export async function seedDemoOrganization(input: {
  readonly environment: ApplicationEnvironment;
  readonly organizationId: string;
}): Promise<SeedSummary> {
  const databaseService = new DatabaseService(input.environment);

  try {
    const actor = await resolveDemoSeedActor(
      databaseService.database,
      input.organizationId,
    );

    return await applySeedFixtures({
      databaseService,
      organizationId: actor.organizationId,
      auth: actor.auth,
      names: {
        playerNames: DEMO_PLAYER_NAMES,
        tournamentNames: DEMO_TOURNAMENT_NAMES,
        playerReferencePrefix: "demo-seed-player-",
        boardNamePrefix: "Demo Board ",
      },
    });
  } finally {
    await databaseService.onApplicationShutdown();
  }
}
