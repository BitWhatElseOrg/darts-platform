import { z } from "zod";

const portSchema = z.coerce.number().int().min(1).max(65_535);
const logLevelSchema = z.enum([
  "fatal",
  "error",
  "warn",
  "log",
  "debug",
  "verbose",
]);

export const applicationEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
  REDIS_URL: z.string().url().startsWith("redis://"),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  WEB_PORT: portSchema.default(3_000),
  API_PORT: portSchema.default(3_001),
  PORT: portSchema.optional(),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  LOG_LEVEL: logLevelSchema.default("log"),
});

export const publicWebEnvironmentSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url(),
});

export type ApplicationEnvironment = Readonly<
  z.infer<typeof applicationEnvironmentSchema>
>;

export type PublicWebEnvironment = Readonly<
  z.infer<typeof publicWebEnvironmentSchema>
>;

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export class EnvironmentValidationError extends Error {
  public readonly issues: readonly string[];

  public constructor(issues: readonly z.core.$ZodIssue[]) {
    const messages = issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "environment";
      return `${path}: ${issue.message}`;
    });

    super(`Invalid environment configuration:\n- ${messages.join("\n- ")}`);
    this.name = "EnvironmentValidationError";
    this.issues = messages;
  }
}

function parseWithSchema<T>(schema: z.ZodType<T>, source: EnvironmentSource): T {
  const result = schema.safeParse(source);

  if (!result.success) {
    throw new EnvironmentValidationError(result.error.issues);
  }

  return result.data;
}

export function parseApplicationEnvironment(
  source: EnvironmentSource,
): ApplicationEnvironment {
  return parseWithSchema(applicationEnvironmentSchema, source);
}

export function parsePublicWebEnvironment(
  source: EnvironmentSource,
): PublicWebEnvironment {
  return parseWithSchema(publicWebEnvironmentSchema, source);
}
