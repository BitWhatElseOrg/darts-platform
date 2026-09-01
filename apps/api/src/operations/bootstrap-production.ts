import { EnvironmentValidationError, parseApplicationEnvironment } from "@darts-platform/config";
import { createDatabaseConnection } from "@darts-platform/database";
import { ZodError } from "zod";

import {
  ProductionBootstrapError,
  assertProductionBootstrapAllowed,
  bootstrapProductionOwner,
  parseProductionBootstrapInput,
  type ProductionBootstrapResult,
} from "./production-bootstrap.js";

interface SafeBootstrapError {
  readonly code: string;
  readonly message: string;
}

class BootstrapCliError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BootstrapCliError";
  }
}

function safeBootstrapError(error: unknown): SafeBootstrapError {
  if (error instanceof BootstrapCliError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof ProductionBootstrapError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof EnvironmentValidationError) {
    return {
      code: "BOOTSTRAP_CONFIGURATION_INVALID",
      message: "Production bootstrap configuration is invalid.",
    };
  }
  if (error instanceof ZodError) {
    return {
      code: "BOOTSTRAP_INPUT_INVALID",
      message: "Production bootstrap input is invalid.",
    };
  }
  return {
    code: "BOOTSTRAP_FAILED",
    message: "Production bootstrap failed.",
  };
}

async function executeProductionBootstrap(): Promise<ProductionBootstrapResult> {
  try {
    assertProductionBootstrapAllowed({
      nodeEnv: process.env.NODE_ENV ?? "",
      allowProduction: process.env.ALLOW_PRODUCTION_BOOTSTRAP === "true",
    });
  } catch {
    throw new BootstrapCliError(
      "BOOTSTRAP_NOT_ALLOWED",
      "Production bootstrap requires NODE_ENV=production and ALLOW_PRODUCTION_BOOTSTRAP=true.",
    );
  }

  const environment = parseApplicationEnvironment(process.env);
  const input = parseProductionBootstrapInput(process.env);
  const connection = createDatabaseConnection(environment.DATABASE_URL);

  try {
    return await bootstrapProductionOwner(connection.database, input);
  } finally {
    await connection.close();
  }
}

executeProductionBootstrap()
  .then((result) => {
    process.stdout.write(
      `${JSON.stringify({
        event: "production_bootstrap_completed",
        ...result,
      })}\n`,
    );
  })
  .catch((error: unknown) => {
    const safeError = safeBootstrapError(error);
    process.stderr.write(
      `${JSON.stringify({
        event: "production_bootstrap_failed",
        ...safeError,
      })}\n`,
    );
    process.exitCode = 1;
  });
