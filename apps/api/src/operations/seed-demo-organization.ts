import {
  EnvironmentValidationError,
  parseApplicationEnvironment,
} from "@darts-platform/config";
import { ZodError, z } from "zod";

import {
  assertDemoSeedAllowed,
  seedDemoOrganization,
} from "./demo-organization-seed.js";
import type { SeedSummary } from "../seeding/seed-fixtures.js";

const organizationIdSchema = z.uuid();

interface SafeSeedError {
  readonly code: string;
  readonly message: string;
}

class DemoSeedCliError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DemoSeedCliError";
  }
}

function safeSeedError(error: unknown): SafeSeedError {
  if (error instanceof DemoSeedCliError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof EnvironmentValidationError) {
    return {
      code: "DEMO_SEED_CONFIGURATION_INVALID",
      message: "Demo seed configuration is invalid.",
    };
  }
  if (error instanceof ZodError) {
    return {
      code: "DEMO_SEED_INPUT_INVALID",
      message: "DEMO_SEED_ORGANIZATION_ID must be a UUID.",
    };
  }
  return {
    code: "DEMO_SEED_FAILED",
    message: "Demo seed failed.",
  };
}

async function executeDemoSeed(): Promise<SeedSummary> {
  try {
    assertDemoSeedAllowed({
      nodeEnv: process.env.NODE_ENV ?? "",
      allowDemoSeed: process.env.ALLOW_DEMO_SEED === "true",
    });
  } catch {
    throw new DemoSeedCliError(
      "DEMO_SEED_NOT_ALLOWED",
      "The demo seed requires NODE_ENV=production and ALLOW_DEMO_SEED=true.",
    );
  }

  const organizationId = organizationIdSchema.parse(
    process.env.DEMO_SEED_ORGANIZATION_ID,
  );
  const environment = parseApplicationEnvironment(process.env);

  return seedDemoOrganization({ environment, organizationId });
}

executeDemoSeed()
  .then((summary) => {
    process.stdout.write(
      `${JSON.stringify({ event: "demo_seed_completed", ...summary })}\n`,
    );
  })
  .catch((error: unknown) => {
    const safeError = safeSeedError(error);
    process.stderr.write(
      `${JSON.stringify({ event: "demo_seed_failed", ...safeError })}\n`,
    );
    process.exitCode = 1;
  });
