import { z } from "zod";

const portSchema = z.coerce.number().int().min(1).max(65_535);
const rateLimitMaxSchema = z.coerce.number().int().min(1).max(1_000_000);
// Obergrenze 10: mehr Reverse-Proxy-Hops gibt es in keinem realistischen
// Aufbau; ein groesserer Wert ist fast sicher ein Tippfehler und wuerde
// X-Forwarded-For faelschbar machen — deshalb Abbruch beim Start.
//
// Bewusst ohne `.default(...)`: in Production muss der Wert explizit gesetzt
// sein (Ruling B12), und ein Default auf Feldebene liesse sich von einem
// expliziten Wert nicht mehr unterscheiden, sobald die Objektvalidierung
// laeuft (siehe `superRefine` unten). Ausserhalb von Production greift der
// Default `0` erst im abschliessenden `transform`.
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
/**
 * Freigabe-Flags werden bewusst hart geparst: nur die Zeichenketten `true`
 * und `false` sind zulaessig. Ein Tippfehler bricht den Start ab, statt
 * stillschweigend als „aus" durchzugehen.
 */
const booleanFlagSchema = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

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
  /**
   * Erlaubt `POST /organizations` fuer jede angemeldete Person. Vorgabe
   * `false`: Mandanten entstehen ueber den Bootstrap-Pfad (ADR 0012).
   */
  ALLOW_SELF_SERVICE_ORGANIZATIONS: booleanFlagSchema,
  /** Obergrenze je IP und Minute fuer alle nicht gesondert geregelten Routen. */
  RATE_LIMIT_MAX_PER_MINUTE: rateLimitMaxSchema.default(300),
  /**
   * Obergrenze fuer `/api/v1/public/**`. `live-tournament.tsx` pollt nur,
   * solange der Socket unten ist, alle 5 Sekunden — 12 Anfragen je Minute und
   * Client. Eine ganze Halle sitzt dabei hinter einer einzigen oeffentlichen
   * NAT-Adresse: bei rund 50 Handys ergibt das ~600 Anfragen je Minute.
   */
  RATE_LIMIT_PUBLIC_MAX_PER_MINUTE: rateLimitMaxSchema.default(600),
  /**
   * Obergrenze fuer Anmeldung, Registrierung und die Annahme einer Einladung.
   * Das Ausstellen einer Einladung zaehlt seit Ruling B14 zur allgemeinen
   * Stufe (`RATE_LIMIT_MAX_PER_MINUTE`), nicht mehr hierher.
   */
  RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: rateLimitMaxSchema.default(10),
  /**
   * Anzahl vertrauter Reverse-Proxy-Hops vor der Anwendung — lokal `0`
   * (kein Proxy), hinter Railway `1`. Bestimmt, welcher Eintrag der
   * `X-Forwarded-For`-Kette als tatsaechliche Client-Adresse gilt
   * (`request.ip`, u. a. fuer das Rate Limiting). Ein zu hoher Wert macht
   * `X-Forwarded-For` durch den Client selbst faelschbar (Audit I-6).
   *
   * In Production ist die Variable Pflicht (Ruling B12, siehe `superRefine`
   * unten und `infrastructure/railway.md`); ausserhalb von Production bleibt
   * unbelegt gleichbedeutend mit `0`.
   */
  TRUST_PROXY_HOPS: trustProxyHopsSchema.optional(),
}).superRefine((data, ctx) => {
  // Ruling B12: ein unbelegtes `TRUST_PROXY_HOPS` waere in Production ein
  // stiller Fehlgriff — die Anwendung liefe mit `0` und der Reverse-Proxy
  // selbst zaehlte fuer jede Anfrage als Client, was das Rate Limiting fuer
  // alle Nutzenden gemeinsam ausschoepft (siehe Kommentar oben). Ein
  // expliziter Wert `0` ist dagegen erlaubt und bleibt unangetastet.
  if (data.NODE_ENV === "production" && data.TRUST_PROXY_HOPS === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["TRUST_PROXY_HOPS"],
      message:
        "TRUST_PROXY_HOPS muss in Production explizit gesetzt sein (siehe infrastructure/railway.md).",
    });
  }
}).transform((data) => ({
  ...data,
  TRUST_PROXY_HOPS: data.TRUST_PROXY_HOPS ?? 0,
}));

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
