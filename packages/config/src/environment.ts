import { z } from "zod";

const portSchema = z.coerce.number().int().min(1).max(65_535);
const rateLimitMaxSchema = z.coerce.number().int().min(1).max(1_000_000);
// Obergrenze 10: mehr Reverse-Proxy-Hops gibt es in keinem realistischen
// Aufbau; ein groesserer Wert ist fast sicher ein Tippfehler und wuerde
// X-Forwarded-For faelschbar machen — deshalb Abbruch beim Start.
const trustProxyHopsSchema = z.coerce.number().int().min(0).max(10);
const urlListSchema = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  )
  .pipe(z.array(z.string().url()));
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
  // `rediss://` ist die TLS-Variante; Railway bietet sie an, und die
  // Realtime- und Rate-Limit-Zaehler laufen ueber dieselbe Verbindung.
  REDIS_URL: z.string().url().regex(/^rediss?:\/\//u, {
    message: "must start with redis:// or rediss://",
  }),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  WEB_PORT: portSchema.default(3_000),
  API_PORT: portSchema.default(3_001),
  PORT: portSchema.optional(),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  WEB_ADDITIONAL_ORIGINS: urlListSchema,
  LOG_LEVEL: logLevelSchema.default("log"),
  /** Obergrenze je IP und Minute fuer alle nicht gesondert geregelten Routen. */
  RATE_LIMIT_MAX_PER_MINUTE: rateLimitMaxSchema.default(300),
  /**
   * Obergrenze fuer `/api/v1/public/**`. Bewusst hoeher als die sensible
   * Grenze: eine ganze Halle sitzt hinter einer einzigen oeffentlichen
   * IP-Adresse, und die TV-Wand fragt im Sekundentakt nach.
   */
  RATE_LIMIT_PUBLIC_MAX_PER_MINUTE: rateLimitMaxSchema.default(120),
  /** Obergrenze fuer Anmeldung, Registrierung und die Einladungsrouten. */
  RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: rateLimitMaxSchema.default(10),
  /**
   * Anzahl vertrauter Reverse-Proxy-Hops vor der Anwendung — lokal `0`
   * (kein Proxy), hinter Railway `1`. Bestimmt, welcher Eintrag der
   * `X-Forwarded-For`-Kette als tatsaechliche Client-Adresse gilt
   * (`request.ip`, u. a. fuer das Rate Limiting). Ein zu hoher Wert macht
   * `X-Forwarded-For` durch den Client selbst faelschbar (Audit I-6).
   */
  TRUST_PROXY_HOPS: trustProxyHopsSchema.default(0),
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
