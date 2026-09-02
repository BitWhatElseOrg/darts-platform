import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { createDatabaseConnection } from "@darts-platform/database";

import {
  memberships,
  organizations,
  users,
  type Database,
} from "@darts-platform/database";

import {
  DEMO_PLAYER_NAMES,
  DEMO_TOURNAMENT_NAMES,
  assertDemoSeedAllowed,
  resolveDemoSeedActor,
  seedDemoOrganization,
} from "./demo-organization-seed.js";
import { createTemporaryDatabase } from "../testing/temporary-database.js";

const testDatabaseUrl = process.env.DATABASE_URL;
const unknownOrganizationId = "4db5fd12-c535-49c1-8834-b666f5bb3939";

async function withTemporaryDatabase<T>(
  run: (database: Database) => Promise<T>,
): Promise<T> {
  if (testDatabaseUrl === undefined || testDatabaseUrl.length === 0) {
    throw new Error("DATABASE_URL is required for demo seed integration tests.");
  }

  const temporary = await createTemporaryDatabase(testDatabaseUrl);
  try {
    return await run(temporary.connection.database);
  } finally {
    await temporary.cleanup();
  }
}

async function insertOrganization(
  database: Database,
  slug = "demo-club",
): Promise<string> {
  const [organization] = await database
    .insert(organizations)
    .values({
      name: "Demo Club",
      slug,
      timezone: "Europe/Zurich",
      locale: "de-CH",
    })
    .returning({ id: organizations.id });

  if (organization === undefined) {
    throw new Error("Test organization insert did not return a row.");
  }

  return organization.id;
}

async function insertOwner(
  database: Database,
  organizationId: string,
  email = "owner@example.ch",
): Promise<{ readonly id: string; readonly email: string }> {
  const [user] = await database
    .insert(users)
    .values({ email, displayName: "Demo Owner" })
    .returning({ id: users.id });

  if (user === undefined) {
    throw new Error("Test user insert did not return a row.");
  }

  await database.insert(memberships).values({
    organizationId,
    userId: user.id,
    role: "OWNER",
    status: "ACTIVE",
  });

  return { id: user.id, email };
}

const apiRoot = fileURLToPath(new URL("../../", import.meta.url));
const compiledSeedCli = fileURLToPath(
  new URL("../../dist/operations/seed-demo-organization.js", import.meta.url),
);
const pnpmExecutable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

interface ChildProcessResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

async function runChildProcess(input: {
  readonly command: string;
  readonly arguments: readonly string[];
  readonly environment: NodeJS.ProcessEnv;
}): Promise<ChildProcessResult> {
  const child = spawn(input.command, [...input.arguments], {
    cwd: apiRoot,
    env: input.environment,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

describe("demo seed CLI contract", () => {
  beforeAll(async () => {
    const build = await runChildProcess({
      command: pnpmExecutable,
      arguments: ["run", "build"],
      environment: process.env,
    });

    if (build.exitCode !== 0) {
      throw new Error(
        `API build failed before demo seed CLI tests.\n${build.stdout}${build.stderr}`,
      );
    }
  }, 180_000);

  it("refuses to run outside production without leaking configuration", async () => {
    const secret = "postgresql://seed-secret:seed-secret@example.test/darts";
    const result = await runChildProcess({
      command: process.execPath,
      arguments: [compiledSeedCli],
      environment: {
        ...process.env,
        NODE_ENV: "development",
        ALLOW_DEMO_SEED: "true",
        DATABASE_URL: secret,
        DEMO_SEED_ORGANIZATION_ID: unknownOrganizationId,
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("demo_seed_failed");
    expect(`${result.stdout}${result.stderr}`).not.toContain(secret);
    expect(`${result.stdout}${result.stderr}`).not.toContain("seed-secret");
  }, 60_000);
});

describe("demo seed guard", () => {
  it("rejects a non-production environment", () => {
    expect(() => {
      assertDemoSeedAllowed({
        nodeEnv: "development",
        allowDemoSeed: true,
      });
    }).toThrow(/NODE_ENV=production/u);
  });

  it("rejects a production environment without the explicit opt-in", () => {
    expect(() => {
      assertDemoSeedAllowed({
        nodeEnv: "production",
        allowDemoSeed: false,
      });
    }).toThrow(/ALLOW_DEMO_SEED=true/u);
  });
});

describe("demo seed actor resolution", () => {
  it("refuses an organization that does not exist", async () => {
    await withTemporaryDatabase(async (database) => {
      await expect(
        resolveDemoSeedActor(database, unknownOrganizationId),
      ).rejects.toThrow(/organization/iu);
    });
  }, 60_000);

  it("refuses an organization without an active owner", async () => {
    await withTemporaryDatabase(async (database) => {
      const organizationId = await insertOrganization(database);

      await expect(
        resolveDemoSeedActor(database, organizationId),
      ).rejects.toThrow(/owner/iu);
    });
  }, 60_000);

  it("acts as the existing active owner", async () => {
    await withTemporaryDatabase(async (database) => {
      const organizationId = await insertOrganization(database);
      const owner = await insertOwner(database, organizationId);

      const actor = await resolveDemoSeedActor(database, organizationId);

      expect(actor.organizationId).toBe(organizationId);
      expect(actor.auth.user.id).toBe(owner.id);
      expect(actor.auth.user.email).toBe(owner.email);
    });
  }, 60_000);
});

describe("demo organization seed", () => {
  const suffix = randomUUID();
  const organizationSlug = `demo-seed-${suffix}`;
  const ownerEmail = `demo-seed-${suffix}@example.test`;
  const environment = parseApplicationEnvironment(process.env);
  const connection = createDatabaseConnection(environment.DATABASE_URL);

  afterAll(async () => {
    await connection.database
      .delete(organizations)
      .where(eq(organizations.slug, organizationSlug));
    await connection.database.delete(users).where(eq(users.email, ownerEmail));
    await connection.close();
  });

  it("fills an existing organization and stays idempotent", async () => {
    const organizationId = await insertOrganization(
      connection.database,
      organizationSlug,
    );
    await insertOwner(connection.database, organizationId, ownerEmail);

    const first = await seedDemoOrganization({ environment, organizationId });
    const second = await seedDemoOrganization({ environment, organizationId });

    expect(first).toMatchObject({
      organizationId,
      players: 32,
      boards: 8,
      completedTournaments: 2,
      runningTournaments: 1,
    });
    expect(second).toEqual(first);

    expect(DEMO_PLAYER_NAMES).toHaveLength(32);
    expect(new Set(DEMO_PLAYER_NAMES)).toHaveLength(32);
    expect(DEMO_TOURNAMENT_NAMES).toHaveLength(3);
  }, 180_000);
});
