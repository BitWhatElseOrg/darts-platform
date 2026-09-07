# Tier 2 — Teil D: Betrieb (Outbox-Konsumenten, Health, Worker)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein dauerhaft fehlschlagendes Outbox-Ereignis blockiert weder Realtime noch Statistik mehr, sondern wandert nach fünf Versuchen mit exponentiellem Backoff in einen auffindbaren Dead-Letter-Zustand, und der Betrieb erkennt Rückstand und Dead Letter am Health-Endpunkt sowie an strukturierten Worker-Logs.

**Architecture:** Beide Outbox-Konsumenten (Realtime-Relay im API-Prozess, Statistik-Poller im Worker) behalten ihre bestehende Bauart — Poll-Schleife über `outbox_events`, Stempel erst nach Erfolg, Broadcast ausschliesslich nach Commit. Ergänzt werden pro Konsument vier Spalten auf derselben Zeile (Versuchszähler, frühester nächster Versuch, Dead-Letter-Zeitpunkt, letzte Fehlermeldung), eine gemeinsame, infrastrukturarme Hilfsschicht in `packages/database` (Backoff-Rechnung, Auswahlprädikat, Fehlerbuchung samt Log-Ereignis) und ein Health-Sondierer, der das Alter des ältesten offenen Ereignisses je Konsument misst. Der strukturierte JSON-Logger der API zieht in `packages/config` um, damit der Worker denselben Record-Aufbau ohne NestJS-Abhängigkeit nutzt.

**Tech Stack:** TypeScript (strict), pnpm/Turborepo, NestJS + Fastify (API), Drizzle ORM + PostgreSQL, Zod (`packages/schemas`), Vitest (Unit + Integration gegen echtes Postgres), Socket.IO (Verteilkanal, unverändert).

**Spec:**
- `/tmp/claude-1000/-home-sut-projects-darts-platform/70688d40-4244-406a-b67f-18e37ab90b1a/scratchpad/audit/F-realtime-betrieb.md` — Befund 1 (Dead-Letter/Backoff/Alarm), Minor 9 (Worker-Logging), Minor 10 (Health ohne Outbox-Rückstand)
- `/tmp/claude-1000/-home-sut-projects-darts-platform/70688d40-4244-406a-b67f-18e37ab90b1a/scratchpad/audit/C-datenintegritaet.md` — I7/I8 als Nachbarplan (Teil A), hier nur als Kollisionsgrenze
- `AGENTS.md` §4, §5, §10, §14, §16, §21, §24; `ARCHITECTURE.md` §25, §26, §31; `docs/adr/0009-phase-6-statistics.md`; `infrastructure/railway.md`

## Global Constraints

- **Realtime erst nach Commit.** Die Outbox-Zeile entsteht in derselben Transaktion wie die Domänenmutation. Kein Schritt dieses Plans verändert einen Schreibpfad, der Outbox-Zeilen erzeugt, und kein Schritt sendet ausserhalb des Pollers.
- **Tenant-Regel.** Jede tenant-bezogene Repository-Funktion führt `organizationId`. Die beiden Outbox-Poller und der Health-Sondierer lesen bewusst organisationsübergreifend: sie sind Systemprozesse ohne Benutzeranfrage und ohne Sitzung, verteilen bzw. zählen nur bereits committete Ereignisse und geben keine Organisationsdaten an einen Aufrufer heraus (der Relay leitet jedes Ereignis in genau den Raum seines eigenen Aggregats, der Worker rechnet je `event.organizationId` weiter). Diese Begründung gehört als Kommentar an jede der drei Abfragen.
- **Migration nur vorwärts.** Neue Spalten mit Default und `not null` brauchen keinen Bestandscheck; bestehende Migrationen werden nicht angefasst. Schema-Snapshot und `DATABASE_SCHEMA.md` werden mitgeführt.
- **Kein kritischer Zustand nur in Redis.** Versuchszähler und Dead-Letter-Zustand liegen in PostgreSQL.
- **Logging ohne Personendaten.** In Log-Records nur `eventId`, `eventType`, `aggregateId`, `organizationId`, `consumer`, `attempts` und die auf 500 Zeichen gekürzte Fehlermeldung — nie die Ereignis-Payload, nie Namen oder E-Mail-Adressen.
- **Fehlerformat unverändert.** `{ "error": { "code", "message", "correlationId" } }` bleibt wie er ist; dieser Plan fügt keinen neuen Fehlercode hinzu.
- **TypeScript `strict`, kein `any`.** `unknown` statt `any`, exhaustive `switch` mit `never`-Zweig, explizite Typen an Paketgrenzen.
- **Sprache.** Kommentare und Commit-Betreffe deutsch (Schweizer Rechtschreibung, kein ß), Bezeichner englisch.
- **Commits.** Conventional Commits, deutscher Betreff, **kein `Co-Authored-By`-Trailer**.
- **Testbefehle.**
  - API-Integration: `cd /home/sut/projects/darts-platform/apps/api && npx dotenv -e ../../.env -- npx vitest run <pfad>`
  - Worker: `cd /home/sut/projects/darts-platform/apps/worker && npx dotenv -e ../../.env -- npx vitest run <pfad>`
  - Pakete: `cd /home/sut/projects/darts-platform && npx dotenv -e .env -- pnpm --filter <paket> test`
  - Vor jedem Commit: `pnpm lint`, `pnpm typecheck`, `pnpm test` (alle aus der Repo-Wurzel `/home/sut/projects/darts-platform`).
  - Am Planende zusätzlich `pnpm build` und `pnpm test:e2e` (Playwright läuft laut `apps/web/playwright.config.ts:17` ohnehin mit `workers: 1`).
- **Abhängigkeit zu den Nachbarplänen.** Teil A (C-I7/C-I8) legt Migration `0023_…` an, Teil C evtl. `0024_…`. Dieser Plan nimmt `0025_outbox_dead_letter`. Der ausführende Branch muss Teil A enthalten, bevor Task 2 die Migration erzeugt (siehe Merge-Hinweise dort und in Task 3).

---

## Nicht mehr zutreffend

Keiner der drei Befunde ist entfallen. Gegengeprüft am heutigen Stand von `fix/audit-tier2`:

- **F-1** — `apps/api/src/realtime/publish-outbox.ts:79-96` hat weiterhin kein `try`/`catch` innerhalb der Schleife; `apps/worker/src/main.ts:53-67` fängt erst ausserhalb der Schleife. Kein Versuchszähler, kein Backoff, keine Dead-Letter-Spalte im Schema (`packages/database/src/schema.ts:546-558`).
- **F-M9** — `apps/worker/src/main.ts:66` loggt weiterhin `console.error("Statistik-Aggregation fehlgeschlagen", error)`.
- **F-M10** — `apps/api/src/health/health.service.ts:29-45` prüft weiterhin nur Datenbank und Redis.

Eine Doku-Abweichung kommt hinzu und wird in Task 2 mit erledigt: `DATABASE_SCHEMA.md:965-987` beschreibt `outbox_events` bereits mit `attempts`/`last_error` und nennt `created_at` statt `occurred_at`; `statistics_processed_at` fehlt dort ganz. Die Tabelle sieht heute anders aus als die Doku behauptet.

## Nicht in diesem Plan

- C-I7 (partieller Index für den Statistik-Poll, Retention/Prune) und C-I8 (`FOR UPDATE SKIP LOCKED`, Sequenzspalte statt `occurred_at`) — Teil A.
- BullMQ als Queue-Ersatz, Sentry/OpenTelemetry/Prometheus — Roadmap (`ARCHITECTURE.md` §26, §31).
- F-Minor 6 (Doku Board-Lock), F-Minor 7 (Socket-Autorisierung), F-Minor 8 (Sequenz statt Zeitstempel).
- Web-Oberfläche: Das Health-Dashboard (`apps/web/src/components/health-dashboard.tsx`) zeigt weiterhin nur Datenbank und Redis. Das neue `outbox`-Feld wird von `healthResponseSchema` validiert (Task 5) und ist damit für eine spätere Anzeige verfügbar; die Anzeige selbst ist Frontend-Arbeit und nicht Teil dieses Plans.

---

## File Structure

**Neu**

| Datei | Verantwortung |
| --- | --- |
| `packages/config/src/structured-logger.ts` | Framework-freier Kern des JSON-Loggers: Level-Liste, Schwellenfilter, Record-Serialisierung, Ziel-Auswahl stdout/stderr |
| `packages/config/src/structured-logger.spec.ts` | Unit-Test für Level-Filter, Zielwahl und Record-Aufbau |
| `packages/database/src/outbox.ts` | Konsumentenbegriff, Backoff-Rechnung, Auswahlprädikat, Fehlerbuchung inkl. Dead-Letter-Log-Ereignis |
| `packages/database/src/outbox.spec.ts` | Unit-Test der reinen Backoff-Rechnung und der Konstanten |
| `packages/database/drizzle/0025_outbox_dead_letter.sql` | Vorwärtsmigration: acht Spalten plus Dead-Letter-Index |
| `apps/worker/src/statistics/rebuild-player-statistics.ts` | Neuberechnung der Karrierestatistik einer Person (aus `main.ts` extrahiert) |
| `apps/worker/src/statistics/process-statistics-outbox.ts` | Testbare Poll-Runde des Statistik-Konsumenten inkl. Fehlerbuchung |
| `apps/worker/src/statistics/process-statistics-outbox.integration.spec.ts` | Integrationstest gegen echtes Postgres: Blockade, Dead-Letter, Log-Ereignis |
| `apps/worker/vitest.config.mts` | Node-Umgebung und 10-Sekunden-Timeout wie in der API |
| `apps/api/src/health/outbox-health.service.ts` | Sondierung des Outbox-Rückstands (drei Abfragen) |
| `apps/api/src/health/outbox-health.integration.spec.ts` | Integrationstest der Sondierung gegen echtes Postgres |

**Geändert**

| Datei | Änderung |
| --- | --- |
| `packages/config/src/index.ts` | Export des Logger-Kerns |
| `packages/config/src/environment.ts` | `logLevelSchema` nutzt die Level-Liste aus dem Logger-Kern |
| `packages/config/package.json` | — (keine neue Abhängigkeit; `@types/node` ist vorhanden) |
| `packages/database/src/schema.ts` | Acht Spalten und ein partieller Index auf `outboxEvents` |
| `packages/database/src/index.ts` | Export von `outbox.ts` |
| `packages/database/drizzle/meta/_journal.json`, `0025_snapshot.json` | Von `drizzle-kit generate` erzeugt, Tag umbenannt |
| `apps/api/src/common/structured-logger.ts` | Delegiert an den Kern, behält die NestJS-Signatur |
| `apps/api/src/realtime/publish-outbox.ts` | Auswahlprädikat, Fehlerbuchung je Ereignis, Optionsobjekt |
| `apps/api/src/realtime/publish-outbox.integration.spec.ts` | Aufrufe auf das Optionsobjekt umgestellt, drei neue Fälle |
| `apps/api/src/realtime/realtime.service.ts` | Übergibt Logger-Adapter an den Relay |
| `apps/api/src/health/health.service.ts` | Dritter Prüfwert Outbox, dreistufiger Status |
| `apps/api/src/health/health.controller.ts` | 503 nur noch bei `unhealthy` |
| `apps/api/src/health/health.module.ts` | Neuer Provider |
| `apps/api/src/health/health.controller.spec.ts` | Stub für den Sondierer, angepasste und neue Fälle |
| `apps/worker/src/main.ts` | Strukturierter Logger, Verdrahtung der extrahierten Module |
| `packages/schemas/src/health.ts`, `packages/schemas/src/index.ts` | `outbox`-Block und dreistufiger Status |
| `DATABASE_SCHEMA.md` | §18 auf den tatsächlichen Stand plus Betriebs-SQL |
| `ARCHITECTURE.md` | §25 Dead-Letter-Satz, §31 Health-Signal |
| `infrastructure/railway.md` | Bedeutung der Health-Status für Deploy-Gate |

---

## Task 1: Strukturierter Logger für alle Prozesse

**Files:**
- Create: `packages/config/src/structured-logger.ts`
- Create: `packages/config/src/structured-logger.spec.ts`
- Modify: `packages/config/src/index.ts`
- Modify: `packages/config/src/environment.ts:14-21` (`logLevelSchema`)
- Modify: `apps/api/src/common/structured-logger.ts` (vollständig ersetzt)
- Modify: `apps/worker/src/main.ts:1-10` und `:66`

**Interfaces:**
- Produces: `applicationLogLevels` (`readonly ["fatal","error","warn","log","debug","verbose"]`), `type ApplicationLogLevel`, `type LogDestination = "stdout" | "stderr"`, `type LogWriter = (destination: LogDestination, record: string) => void`, `type LogFields = Readonly<Record<string, unknown>>`, `interface StructuredLogEmitter { emit(level: ApplicationLogLevel, fields: LogFields): void }`, `createStructuredLogEmitter(service: string, minimumLevel: ApplicationLogLevel, writer?: LogWriter): StructuredLogEmitter` — alle aus `@darts-platform/config`.
- Produces: `apps/api/src/common/structured-logger.ts` exportiert unverändert `class StructuredLogger implements LoggerService` mit `constructor(service: string, minimumLevel: ApplicationLogLevel, writer?: LogWriter)` sowie die Typen `ApplicationLogLevel`, `LogDestination`, `LogWriter` (Re-Export) — `apps/api/src/main.ts:26` und `apps/api/src/common/structured-logger.spec.ts` bleiben dadurch unangetastet.

**Hinweis zum Paketort:** `AGENTS.md` §3 listet die erlaubten Pakete abschliessend; `packages/logging` steht nicht darin und bräuchte ein ADR. `packages/config` besitzt bereits `LOG_LEVEL` samt Level-Aufzählung und wird von API und Worker als Abhängigkeit geführt (`apps/worker/package.json`), trägt keine Framework-Abhängigkeit und ist damit der richtige Ort. Der NestJS-Adapter (`LoggerService`) bleibt in der API.

- [ ] **Step 1: Failing test für den Logger-Kern schreiben**

Datei `packages/config/src/structured-logger.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  applicationLogLevels,
  createStructuredLogEmitter,
  type LogDestination,
} from "./structured-logger";

describe("createStructuredLogEmitter", () => {
  it("schreibt einen maschinenlesbaren Record nach stdout", () => {
    const records: Array<{ destination: LogDestination; record: string }> = [];
    const emitter = createStructuredLogEmitter("worker", "log", (destination, record) => {
      records.push({ destination, record });
    });

    emitter.emit("log", { event: "statistics.event_processed", eventId: "abc" });

    expect(records).toHaveLength(1);
    expect(records[0]?.destination).toBe("stdout");
    expect(JSON.parse(records[0]?.record ?? "{}")).toMatchObject({
      level: "log",
      service: "worker",
      event: "statistics.event_processed",
      eventId: "abc",
    });
  });

  it("filtert unterhalb der Schwelle und schickt Fehler nach stderr", () => {
    const records: Array<{ destination: LogDestination; record: string }> = [];
    const emitter = createStructuredLogEmitter("worker", "warn", (destination, record) => {
      records.push({ destination, record });
    });

    emitter.emit("debug", { event: "ignoriert" });
    emitter.emit("error", { event: "outbox.dead_letter" });

    expect(records).toHaveLength(1);
    expect(records[0]?.destination).toBe("stderr");
    expect(JSON.parse(records[0]?.record ?? "{}")).toMatchObject({
      level: "error",
      event: "outbox.dead_letter",
    });
  });

  it("führt genau die Level der Umgebungsvariablen", () => {
    expect([...applicationLogLevels]).toEqual([
      "fatal",
      "error",
      "warn",
      "log",
      "debug",
      "verbose",
    ]);
  });
});
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

```bash
cd /home/sut/projects/darts-platform && pnpm --filter @darts-platform/config test
```

Erwartet: FAIL — `Failed to resolve import "./structured-logger"`.

- [ ] **Step 3: Logger-Kern implementieren**

Datei `packages/config/src/structured-logger.ts` (Importstil ohne `.js`, wie `packages/config/src/index.ts` es führt):

```ts
export const applicationLogLevels = [
  "fatal",
  "error",
  "warn",
  "log",
  "debug",
  "verbose",
] as const;

export type ApplicationLogLevel = (typeof applicationLogLevels)[number];
export type LogDestination = "stdout" | "stderr";
export type LogWriter = (destination: LogDestination, record: string) => void;
export type LogFields = Readonly<Record<string, unknown>>;

const severity: Readonly<Record<ApplicationLogLevel, number>> = {
  verbose: 10,
  debug: 20,
  log: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export interface StructuredLogEmitter {
  emit(level: ApplicationLogLevel, fields: LogFields): void;
}

export function defaultLogWriter(destination: LogDestination, record: string): void {
  const output = destination === "stderr" ? process.stderr : process.stdout;
  output.write(`${record}\n`);
}

/**
 * Erzeugt den Record-Aufbau, den alle Prozesse teilen: ein JSON-Objekt je
 * Zeile mit Zeitstempel, Level und Dienstname. Der Kern kennt weder NestJS
 * noch eine Datenbank, damit ihn auch der Worker verwenden kann.
 */
export function createStructuredLogEmitter(
  service: string,
  minimumLevel: ApplicationLogLevel,
  writer: LogWriter = defaultLogWriter,
): StructuredLogEmitter {
  return {
    emit(level, fields) {
      if (severity[level] < severity[minimumLevel]) return;

      const record = JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        service,
        ...fields,
      });

      writer(level === "fatal" || level === "error" ? "stderr" : "stdout", record);
    },
  };
}
```

- [ ] **Step 4: Exporte und Umgebungsschema anschliessen**

In `packages/config/src/index.ts` vor dem bestehenden `./environment`-Export ergänzen:

```ts
export {
  applicationLogLevels,
  createStructuredLogEmitter,
  defaultLogWriter,
  type ApplicationLogLevel,
  type LogDestination,
  type LogFields,
  type LogWriter,
  type StructuredLogEmitter,
} from "./structured-logger";
```

In `packages/config/src/environment.ts` den Import ergänzen und die doppelte Level-Liste ersetzen:

```ts
import { applicationLogLevels } from "./structured-logger";
```

```ts
const logLevelSchema = z.enum(applicationLogLevels);
```

- [ ] **Step 5: Tests laufen lassen und grün bestätigen**

```bash
cd /home/sut/projects/darts-platform && pnpm --filter @darts-platform/config test
```

Erwartet: PASS, inklusive der bestehenden `environment.spec.ts`.

- [ ] **Step 6: API-Logger auf den Kern umstellen**

`apps/api/src/common/structured-logger.ts` vollständig ersetzen:

```ts
import type { LoggerService } from "@nestjs/common";
import {
  createStructuredLogEmitter,
  type ApplicationLogLevel,
  type LogDestination,
  type LogFields,
  type LogWriter,
  type StructuredLogEmitter,
} from "@darts-platform/config";

export type { ApplicationLogLevel, LogDestination, LogWriter };

function serializeMessage(message: unknown): LogFields {
  if (message instanceof Error) {
    return {
      message: message.message,
      errorName: message.name,
      stack: message.stack,
    };
  }

  if (typeof message === "object" && message !== null) {
    return message as LogFields;
  }

  return { message: String(message) };
}

function contextFrom(optionalParameters: readonly unknown[]): string | undefined {
  const candidate = optionalParameters.at(-1);
  return typeof candidate === "string" ? candidate : undefined;
}

/**
 * NestJS-Adapter auf den gemeinsamen Record-Aufbau aus `packages/config`.
 * Der Worker nutzt denselben Kern ohne NestJS.
 */
export class StructuredLogger implements LoggerService {
  private readonly emitter: StructuredLogEmitter;

  public constructor(
    service: string,
    minimumLevel: ApplicationLogLevel,
    writer?: LogWriter,
  ) {
    this.emitter = createStructuredLogEmitter(service, minimumLevel, writer);
  }

  public log(message: unknown, ...optionalParameters: readonly unknown[]): void {
    this.write("log", message, optionalParameters);
  }

  public fatal(message: unknown, ...optionalParameters: readonly unknown[]): void {
    this.write("fatal", message, optionalParameters);
  }

  public error(message: unknown, ...optionalParameters: readonly unknown[]): void {
    this.write("error", message, optionalParameters);
  }

  public warn(message: unknown, ...optionalParameters: readonly unknown[]): void {
    this.write("warn", message, optionalParameters);
  }

  public debug(message: unknown, ...optionalParameters: readonly unknown[]): void {
    this.write("debug", message, optionalParameters);
  }

  public verbose(message: unknown, ...optionalParameters: readonly unknown[]): void {
    this.write("verbose", message, optionalParameters);
  }

  private write(
    level: ApplicationLogLevel,
    message: unknown,
    optionalParameters: readonly unknown[],
  ): void {
    const context = contextFrom(optionalParameters);
    this.emitter.emit(level, {
      ...serializeMessage(message),
      ...(context === undefined ? {} : { context }),
    });
  }
}
```

- [ ] **Step 7: Worker auf den Kern umstellen**

In `apps/worker/src/main.ts` den Import erweitern:

```ts
import { createStructuredLogEmitter, parseApplicationEnvironment } from "@darts-platform/config";
```

Nach der Zeile mit `const connection = createDatabaseConnection(...)` ergänzen:

```ts
const logger = createStructuredLogEmitter("worker", environment.LOG_LEVEL);
```

Und den `catch`-Zweig in `run()` ersetzen:

```ts
  } catch (error) {
    logger.emit("error", {
      event: "statistics.tick_failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
```

- [ ] **Step 8: Bestehende API-Logger-Tests und den Worker prüfen**

```bash
cd /home/sut/projects/darts-platform/apps/api && npx dotenv -e ../../.env -- npx vitest run src/common/structured-logger.spec.ts
cd /home/sut/projects/darts-platform && pnpm --filter @darts-platform/worker test
```

Erwartet: beide PASS (der Worker meldet weiterhin nur `module-format` und `build-statistics-matches`).

- [ ] **Step 9: Qualitätstore und Commit**

```bash
cd /home/sut/projects/darts-platform && pnpm lint && pnpm typecheck && pnpm test
```

```bash
cd /home/sut/projects/darts-platform
git add packages/config/src/structured-logger.ts packages/config/src/structured-logger.spec.ts packages/config/src/index.ts packages/config/src/environment.ts apps/api/src/common/structured-logger.ts apps/worker/src/main.ts
git commit -m "refactor(config): strukturierten Logger fuer API und Worker teilen"
```

---

## Task 2: Migration und Hilfsschicht für Versuchszähler und Dead Letter

**Files:**
- Modify: `packages/database/src/schema.ts:546-558` (Tabelle `outboxEvents`)
- Create: `packages/database/drizzle/0025_outbox_dead_letter.sql` (von `drizzle-kit generate` erzeugt, danach umbenannt)
- Modify: `packages/database/drizzle/meta/_journal.json` (Tag umbenennen), neu: `packages/database/drizzle/meta/0025_snapshot.json`
- Create: `packages/database/src/outbox.ts`
- Create: `packages/database/src/outbox.spec.ts`
- Modify: `packages/database/src/index.ts`
- Modify: `DATABASE_SCHEMA.md:965-987` (§18)

**Interfaces:**
- Produces (Schema, camelCase → Spalte): `publishAttempts` → `publish_attempts`, `publishNotBefore` → `publish_not_before`, `publishDeadLetteredAt` → `publish_dead_lettered_at`, `publishLastError` → `publish_last_error` und dieselben vier mit Präfix `statistics`.
- Produces (`@darts-platform/database`): `OUTBOX_MAX_ATTEMPTS = 5`, `OUTBOX_BACKOFF_BASE_MS = 1_000`, `OUTBOX_BACKOFF_CAP_MS = 300_000`, `STATISTICS_OUTBOX_EVENT_TYPE = "MATCH_COMPLETED"`, `type OutboxConsumer = "publish" | "statistics"`, `interface OutboxLogger { emit(level: "error" | "warn" | "debug", fields: Readonly<Record<string, unknown>>): void }`, `outboxRetryDelayMs(attempts: number): number`, `outboxPending(consumer: OutboxConsumer, now: Date): SQL | undefined`, `recordOutboxFailure(input: OutboxFailureInput): Promise<"retry" | "dead_letter">` mit `interface OutboxFailureInput { readonly database: Database; readonly consumer: OutboxConsumer; readonly event: OutboxEvent; readonly error: unknown; readonly now: Date; readonly maxAttempts: number; readonly logger: OutboxLogger }`.

**Entscheid zwei Spaltenpaare statt generischer Struktur:** Die beiden Konsumenten führen ihren Fortschritt bereits als eigene Spalte auf derselben Zeile (`published_at`, `statistics_processed_at`, `packages/database/src/schema.ts:551-552`, so auch in ADR 0009 festgehalten). Versuchszähler und Dead-Letter-Zustand folgen demselben Muster: acht Spalten, symmetrisch benannt. Eine generische Tabelle `outbox_consumer_state` wäre flexibler, brächte aber einen Join in genau die Abfrage, die im Sekundentakt läuft, und würde die partiellen Indexe aus Teil A unbrauchbar machen — die setzen auf Prädikate über Spalten von `outbox_events`. Bei zwei Konsumenten überwiegt die einfache, indexierbare Zeile; ab einem dritten Konsumenten (Notifications/Webhooks laut `ARCHITECTURE.md` §25) gehört der Schnitt neu bewertet, was als Kommentar am Schema steht.

**Merge-Hinweis zu Teil A/C:** Vor Step 3 prüfen, welches der höchste Eintrag in `packages/database/drizzle/meta/_journal.json` ist. Erwartet ist `0024` (Teil A `0023`, Teil C `0024`). Ist Teil A noch nicht im Branch, zuerst darauf rebasen — sonst vergibt `drizzle-kit` eine Nummer, die später kollidiert. Vergibt der Generator eine andere als `0025`, die vergebene Nummer verwenden und die Dateinamen in diesem Plan entsprechend lesen.

- [ ] **Step 1: Failing test für die Backoff-Rechnung schreiben**

Datei `packages/database/src/outbox.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  OUTBOX_BACKOFF_CAP_MS,
  OUTBOX_MAX_ATTEMPTS,
  outboxRetryDelayMs,
} from "./outbox.js";

describe("outboxRetryDelayMs", () => {
  it("verdoppelt die Wartezeit mit jedem Fehlversuch", () => {
    expect(outboxRetryDelayMs(1)).toBe(1_000);
    expect(outboxRetryDelayMs(2)).toBe(2_000);
    expect(outboxRetryDelayMs(3)).toBe(4_000);
    expect(outboxRetryDelayMs(4)).toBe(8_000);
  });

  it("deckelt die Wartezeit", () => {
    expect(outboxRetryDelayMs(50)).toBe(OUTBOX_BACKOFF_CAP_MS);
  });

  it("behandelt den ersten Versuch wie einen Fehlversuch", () => {
    expect(outboxRetryDelayMs(0)).toBe(1_000);
  });

  it("hält die Obergrenze bei fuenf Versuchen", () => {
    expect(OUTBOX_MAX_ATTEMPTS).toBe(5);
  });
});
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

```bash
cd /home/sut/projects/darts-platform && npx dotenv -e .env -- pnpm --filter @darts-platform/database test
```

Erwartet: FAIL — `Failed to resolve import "./outbox.js"`.

- [ ] **Step 3: Spalten und Index im Schema ergänzen**

In `packages/database/src/schema.ts` die Tabelle `outboxEvents` erweitern — nach `statisticsProcessedAt` einfügen:

```ts
    // Je Konsument ein eigener Versuchszähler, ein frühester nächster
    // Versuch und ein Dead-Letter-Stempel. Getrennte Spalten statt einer
    // generischen Zustandstabelle, weil beide Konsumenten ihren Fortschritt
    // schon als Spalte führen und die Poll-Abfragen so ohne Join auf ihren
    // partiellen Indexen bleiben. Ab einem dritten Konsumenten gehört der
    // Schnitt neu bewertet.
    publishAttempts: integer("publish_attempts").default(0).notNull(),
    publishNotBefore: timestamp("publish_not_before", { withTimezone: true }),
    publishDeadLetteredAt: timestamp("publish_dead_lettered_at", { withTimezone: true }),
    publishLastError: text("publish_last_error"),
    statisticsAttempts: integer("statistics_attempts").default(0).notNull(),
    statisticsNotBefore: timestamp("statistics_not_before", { withTimezone: true }),
    statisticsDeadLetteredAt: timestamp("statistics_dead_lettered_at", {
      withTimezone: true,
    }),
    statisticsLastError: text("statistics_last_error"),
```

Und in der Indexliste derselben Tabelle ergänzen:

```ts
    // Dead Letter sind selten; der partielle Index hält die Zählung im
    // Health-Endpunkt von der wachsenden Tabelle fern.
    index("outbox_events_dead_lettered_idx")
      .on(table.occurredAt)
      .where(
        sql`${table.publishDeadLetteredAt} is not null or ${table.statisticsDeadLetteredAt} is not null`,
      ),
```

`integer`, `text`, `timestamp`, `index` und `sql` sind in `schema.ts` bereits importiert.

- [ ] **Step 4: Migration erzeugen und benennen**

```bash
cd /home/sut/projects/darts-platform && pnpm db:generate
```

Erwartet: neue Datei `packages/database/drizzle/0025_<zufallsname>.sql` mit acht `ALTER TABLE ... ADD COLUMN` und einem `CREATE INDEX ... WHERE ...`, dazu `meta/0025_snapshot.json` und ein neuer Eintrag in `meta/_journal.json`.

Datei umbenennen und den Journal-Tag angleichen (Vorbild `0022_board_in_progress_unique`):

```bash
cd /home/sut/projects/darts-platform/packages/database/drizzle
mv 0025_*.sql 0025_outbox_dead_letter.sql
```

Danach in `meta/_journal.json` im Eintrag mit `"idx": 25` den `"tag"` auf `"0025_outbox_dead_letter"` setzen.

Die erzeugte SQL soll inhaltlich so aussehen (kein Bestandscheck nötig — alle Spalten sind entweder nullable oder haben einen Default):

```sql
ALTER TABLE "outbox_events" ADD COLUMN "publish_attempts" integer DEFAULT 0 NOT NULL;
ALTER TABLE "outbox_events" ADD COLUMN "publish_not_before" timestamp with time zone;
ALTER TABLE "outbox_events" ADD COLUMN "publish_dead_lettered_at" timestamp with time zone;
ALTER TABLE "outbox_events" ADD COLUMN "publish_last_error" text;
ALTER TABLE "outbox_events" ADD COLUMN "statistics_attempts" integer DEFAULT 0 NOT NULL;
ALTER TABLE "outbox_events" ADD COLUMN "statistics_not_before" timestamp with time zone;
ALTER TABLE "outbox_events" ADD COLUMN "statistics_dead_lettered_at" timestamp with time zone;
ALTER TABLE "outbox_events" ADD COLUMN "statistics_last_error" text;
CREATE INDEX "outbox_events_dead_lettered_idx" ON "outbox_events" USING btree ("occurred_at") WHERE "outbox_events"."publish_dead_lettered_at" IS NOT NULL OR "outbox_events"."statistics_dead_lettered_at" IS NOT NULL;
```

- [ ] **Step 5: Migration anwenden und Bestand prüfen**

```bash
cd /home/sut/projects/darts-platform && pnpm db:migrate
```

```bash
cd /home/sut/projects/darts-platform && npx dotenv -e .env -- node -e "const p=require('postgres');const s=p(process.env.DATABASE_URL);s\`select column_name from information_schema.columns where table_name='outbox_events' and column_name like '%attempts' or table_name='outbox_events' and column_name like '%dead_lettered_at' order by column_name\`.then(r=>{console.log(r.map(x=>x.column_name).join(', '));return s.end();})"
```

Erwartet: `publish_attempts, publish_dead_lettered_at, statistics_attempts, statistics_dead_lettered_at`.

- [ ] **Step 6: Hilfsschicht implementieren**

Datei `packages/database/src/outbox.ts`:

```ts
import { and, eq, isNull, lte, or, type SQL } from "drizzle-orm";

import type { Database } from "./client.js";
import { outboxEvents, type OutboxEvent } from "./schema.js";

/** Ereignistyp, den der Statistik-Konsument als einziger verarbeitet. */
export const STATISTICS_OUTBOX_EVENT_TYPE = "MATCH_COMPLETED";

/** Nach dem fünften Fehlversuch wandert ein Ereignis ins Dead Letter. */
export const OUTBOX_MAX_ATTEMPTS = 5;
export const OUTBOX_BACKOFF_BASE_MS = 1_000;
export const OUTBOX_BACKOFF_CAP_MS = 300_000;

const MAX_ERROR_LENGTH = 500;

export type OutboxConsumer = "publish" | "statistics";

/**
 * Schmale Log-Schnittstelle, damit dieses Paket ohne Abhängigkeit auf
 * `@darts-platform/config` auskommt. Ein `StructuredLogEmitter` erfüllt sie.
 */
export interface OutboxLogger {
  emit(
    level: "error" | "warn" | "debug",
    fields: Readonly<Record<string, unknown>>,
  ): void;
}

export interface OutboxFailureInput {
  readonly database: Database;
  readonly consumer: OutboxConsumer;
  readonly event: OutboxEvent;
  readonly error: unknown;
  readonly now: Date;
  readonly maxAttempts: number;
  readonly logger: OutboxLogger;
}

/** Exponentiell wachsende Wartezeit, gedeckelt bei fünf Minuten. */
export function outboxRetryDelayMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(OUTBOX_BACKOFF_BASE_MS * 2 ** exponent, OUTBOX_BACKOFF_CAP_MS);
}

/**
 * Auswahlprädikat eines Konsumenten: noch nicht verarbeitet, nicht im Dead
 * Letter, und die Backoff-Sperre ist abgelaufen. Ohne Organisationsfilter —
 * beide Poller sind Systemprozesse ohne Benutzeranfrage und verteilen bzw.
 * verrechnen jedes Ereignis in dessen eigener Organisation weiter.
 */
export function outboxPending(consumer: OutboxConsumer, now: Date): SQL | undefined {
  switch (consumer) {
    case "publish":
      return and(
        isNull(outboxEvents.publishedAt),
        isNull(outboxEvents.publishDeadLetteredAt),
        or(
          isNull(outboxEvents.publishNotBefore),
          lte(outboxEvents.publishNotBefore, now),
        ),
      );
    case "statistics":
      return and(
        isNull(outboxEvents.statisticsProcessedAt),
        isNull(outboxEvents.statisticsDeadLetteredAt),
        or(
          isNull(outboxEvents.statisticsNotBefore),
          lte(outboxEvents.statisticsNotBefore, now),
        ),
      );
    default: {
      const exhaustive: never = consumer;
      throw new Error(`Unbekannter Outbox-Konsument: ${String(exhaustive)}`);
    }
  }
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_ERROR_LENGTH);
}

/**
 * Bucht einen Fehlversuch: Zähler hoch, Fehlermeldung (ohne Payload und
 * ohne Personendaten) festhalten, entweder Backoff setzen oder ins Dead
 * Letter legen. Eine Dead-Letter-Zeile wird von keinem Poller mehr gezogen
 * und blockiert damit die nachfolgenden Ereignisse nicht.
 */
export async function recordOutboxFailure(
  input: OutboxFailureInput,
): Promise<"retry" | "dead_letter"> {
  const { consumer, event, logger, maxAttempts, now } = input;
  const previous =
    consumer === "publish" ? event.publishAttempts : event.statisticsAttempts;
  const attempts = previous + 1;
  const lastError = describeError(input.error);
  const deadLettered = attempts >= maxAttempts;
  const notBefore = deadLettered
    ? null
    : new Date(now.getTime() + outboxRetryDelayMs(attempts));

  const values: Partial<typeof outboxEvents.$inferInsert> =
    consumer === "publish"
      ? {
          publishAttempts: attempts,
          publishLastError: lastError,
          publishNotBefore: notBefore,
          publishDeadLetteredAt: deadLettered ? now : null,
        }
      : {
          statisticsAttempts: attempts,
          statisticsLastError: lastError,
          statisticsNotBefore: notBefore,
          statisticsDeadLetteredAt: deadLettered ? now : null,
        };

  await input.database
    .update(outboxEvents)
    .set(values)
    .where(eq(outboxEvents.id, event.id));

  logger.emit(deadLettered ? "error" : "warn", {
    event: deadLettered ? "outbox.dead_letter" : "outbox.retry_scheduled",
    consumer,
    eventId: event.id,
    eventType: event.eventType,
    aggregateId: event.aggregateId,
    organizationId: event.organizationId,
    attempts,
    lastError,
    ...(notBefore === null ? {} : { nextAttemptAt: notBefore.toISOString() }),
  });

  return deadLettered ? "dead_letter" : "retry";
}
```

In `packages/database/src/index.ts` ergänzen (nach dem `migration-runner`-Export):

```ts
export {
  OUTBOX_BACKOFF_BASE_MS,
  OUTBOX_BACKOFF_CAP_MS,
  OUTBOX_MAX_ATTEMPTS,
  STATISTICS_OUTBOX_EVENT_TYPE,
  outboxPending,
  outboxRetryDelayMs,
  recordOutboxFailure,
  type OutboxConsumer,
  type OutboxFailureInput,
  type OutboxLogger,
} from "./outbox.js";
```

- [ ] **Step 7: Test laufen lassen und grün bestätigen**

```bash
cd /home/sut/projects/darts-platform && npx dotenv -e .env -- pnpm --filter @darts-platform/database test
```

Erwartet: PASS.

- [ ] **Step 8: `DATABASE_SCHEMA.md` §18 auf den tatsächlichen Stand bringen**

Abschnitt `# 18. Transactional Outbox` (ab Zeile 965) vollständig ersetzen:

````markdown
# 18. Transactional Outbox

## outbox_events

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
aggregate_type varchar(100) NOT NULL
aggregate_id uuid NOT NULL
event_type varchar(100) NOT NULL
payload jsonb NOT NULL
occurred_at timestamptz NOT NULL DEFAULT now()

published_at timestamptz
publish_attempts integer NOT NULL DEFAULT 0
publish_not_before timestamptz
publish_dead_lettered_at timestamptz
publish_last_error text

statistics_processed_at timestamptz
statistics_attempts integer NOT NULL DEFAULT 0
statistics_not_before timestamptz
statistics_dead_lettered_at timestamptz
statistics_last_error text
```

Zwei Konsumenten teilen sich die Tabelle und führen je einen eigenen Satz
Spalten: der Realtime-Relay im API-Prozess (`publish_*`) und der
Statistik-Poller im Worker (`statistics_*`, ausschliesslich Ereignisse vom
Typ `MATCH_COMPLETED`). Keiner blockiert den anderen.

Index:

```text
outbox_events_unpublished_idx (published_at, occurred_at)
outbox_events_organization_aggregate_idx (organization_id, aggregate_id)
outbox_events_dead_lettered_idx (occurred_at)
  WHERE publish_dead_lettered_at IS NOT NULL
     OR statistics_dead_lettered_at IS NOT NULL
```

Die Outbox-Zeile entsteht in derselben Transaktion wie die Domänenmutation;
verteilt wird erst nach dem Commit (Migration `0025_outbox_dead_letter` für
die Wiederholungs- und Dead-Letter-Spalten).
````

- [ ] **Step 9: Qualitätstore und Commit**

```bash
cd /home/sut/projects/darts-platform && pnpm lint && pnpm typecheck && pnpm test
```

```bash
cd /home/sut/projects/darts-platform
git add packages/database/src/schema.ts packages/database/src/outbox.ts packages/database/src/outbox.spec.ts packages/database/src/index.ts packages/database/drizzle DATABASE_SCHEMA.md
git commit -m "feat(database): Wiederholungszaehler und Dead Letter fuer Outbox-Konsumenten"
```

---

## Task 3: Realtime-Relay überspringt Dead Letter statt zu blockieren

**Files:**
- Modify: `apps/api/src/realtime/publish-outbox.ts:69-96`
- Modify: `apps/api/src/realtime/realtime.service.ts:69-80`
- Test: `apps/api/src/realtime/publish-outbox.integration.spec.ts` (fünf bestehende Aufrufe umstellen, drei Fälle ergänzen)
- Modify: `DATABASE_SCHEMA.md` (§18, Betriebsabschnitt anhängen)
- Modify: `ARCHITECTURE.md:877-900` (§25)

**Interfaces:**
- Consumes: `outboxPending`, `recordOutboxFailure`, `OUTBOX_MAX_ATTEMPTS`, `type OutboxLogger` aus `@darts-platform/database` (Task 2).
- Produces: `publishOutboxBatch(database: Database, broadcaster: RealtimeBroadcaster, options: PublishOutboxOptions): Promise<number>` mit `interface PublishOutboxOptions { readonly logger: OutboxLogger; readonly limit?: number; readonly maxAttempts?: number; readonly now?: () => Date }`. `logger` ist Pflicht — ein stiller Standard würde genau die Alarmierung verschlucken, um die es hier geht.

**Merge-Hinweis zu Teil A:** Teil A (C-I8) baut dieselbe Funktion auf `FOR UPDATE SKIP LOCKED` innerhalb einer Transaktion um und sortiert nach einer Sequenzspalte statt nach `occurred_at`. Trifft dieser Task auf die bereits umgebaute Fassung: deren Struktur behalten, das Prädikat `outboxPending("publish", now())` zusätzlich in die `where`-Kette hängen, `orderBy` **nicht** anfassen, und `recordOutboxFailure` nach dem Abbruch der Claim-Transaktion in einer eigenen Anweisung aufrufen (die abgebrochene Transaktion kann nicht mehr schreiben). Die partiellen Indexe aus Teil A bleiben nutzbar: die neuen Prädikate verengen die Auswahl nur zusätzlich.

- [ ] **Step 1: Failing tests schreiben**

In `apps/api/src/realtime/publish-outbox.integration.spec.ts` zuerst den Import erweitern:

```ts
import {
  OUTBOX_MAX_ATTEMPTS,
  competitions,
  encounterSlots,
  encounters,
  matches,
  organizations,
  outboxEvents,
  teams,
  tournamentMatches,
  tournamentStages,
  tournaments,
  type OutboxLogger,
} from "@darts-platform/database";
```

Nach der `recorder()`-Hilfsfunktion ergänzen:

```ts
interface LoggedRecord {
  readonly level: "error" | "warn" | "debug";
  readonly fields: Readonly<Record<string, unknown>>;
}

function logRecorder(): OutboxLogger & { readonly records: LoggedRecord[] } {
  const records: LoggedRecord[] = [];
  return {
    records,
    emit(level, fields) {
      records.push({ level, fields });
    },
  };
}

const silentLogger: OutboxLogger = { emit: () => undefined };

/** Broadcaster, der genau ein Ereignis nicht zustellen kann. */
function poisonedRecorder(
  poisonEventId: string,
): RealtimeBroadcaster & { readonly sent: Recorded[] } {
  const sent: Recorded[] = [];
  return {
    sent,
    emit(room, event, payload) {
      if (payload.eventId === poisonEventId) {
        throw new Error("Zustellung fehlgeschlagen");
      }
      sent.push({ room, event, payload });
    },
  };
}
```

Alle fünf bestehenden Aufrufe `await publishOutboxBatch(database, <broadcaster>)` auf `await publishOutboxBatch(database, <broadcaster>, { logger: silentLogger })` umstellen.

Am Ende der `describe`-Blöcke einen neuen Block anfügen:

```ts
describe("publishOutboxBatch — Fehlerbehandlung", () => {
  it("verteilt nachfolgende Ereignisse, obwohl eines fehlschlägt", async () => {
    const [poison] = await database
      .insert(outboxEvents)
      .values({
        organizationId,
        aggregateType: "Encounter",
        aggregateId: encounterId,
        eventType: "ENCOUNTER_STARTED",
        payload: { encounterId },
        occurredAt: new Date("2026-09-06T10:00:00.000Z"),
      })
      .returning();
    const [healthy] = await database
      .insert(outboxEvents)
      .values({
        organizationId,
        aggregateType: "Encounter",
        aggregateId: encounterId,
        eventType: "ENCOUNTER_COMPLETED",
        payload: { encounterId },
        occurredAt: new Date("2026-09-06T10:00:01.000Z"),
      })
      .returning();
    const broadcaster = poisonedRecorder(poison?.id ?? "");
    const logger = logRecorder();

    await publishOutboxBatch(database, broadcaster, { logger, limit: 500 });

    expect(
      broadcaster.sent.some((entry) => entry.payload.eventId === healthy?.id),
    ).toBe(true);
    const [storedHealthy] = await database
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, healthy?.id ?? ""));
    expect(storedHealthy?.publishedAt).not.toBeNull();
    const [storedPoison] = await database
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, poison?.id ?? ""));
    expect(storedPoison?.publishedAt).toBeNull();
    expect(storedPoison?.publishAttempts).toBe(1);
    expect(storedPoison?.publishNotBefore).not.toBeNull();
    expect(storedPoison?.publishLastError).toBe("Zustellung fehlgeschlagen");
    expect(logger.records.map((entry) => entry.fields.event)).toContain(
      "outbox.retry_scheduled",
    );
  });

  it("legt ein dauerhaft fehlschlagendes Ereignis nach fuenf Versuchen ins Dead Letter", async () => {
    const start = new Date("2026-09-06T11:00:00.000Z");
    const [poison] = await database
      .insert(outboxEvents)
      .values({
        organizationId,
        aggregateType: "Encounter",
        aggregateId: encounterId,
        eventType: "ENCOUNTER_STARTED",
        payload: { encounterId },
        occurredAt: start,
      })
      .returning();
    const broadcaster = poisonedRecorder(poison?.id ?? "");
    const logger = logRecorder();

    for (let attempt = 1; attempt <= OUTBOX_MAX_ATTEMPTS; attempt += 1) {
      const clock = new Date(start.getTime() + attempt * 600_000);
      await publishOutboxBatch(database, broadcaster, {
        logger,
        limit: 500,
        now: () => clock,
      });
    }

    const [stored] = await database
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, poison?.id ?? ""));
    expect(stored?.publishAttempts).toBe(OUTBOX_MAX_ATTEMPTS);
    expect(stored?.publishDeadLetteredAt).not.toBeNull();
    expect(stored?.publishNotBefore).toBeNull();
    const deadLetter = logger.records.find(
      (entry) => entry.fields.event === "outbox.dead_letter",
    );
    expect(deadLetter?.level).toBe("error");
    expect(deadLetter?.fields).toMatchObject({
      consumer: "publish",
      eventId: poison?.id,
      eventType: "ENCOUNTER_STARTED",
      aggregateId: encounterId,
      attempts: OUTBOX_MAX_ATTEMPTS,
      lastError: "Zustellung fehlgeschlagen",
    });
  });

  it("zieht ein Ereignis im Dead Letter nicht mehr", async () => {
    const [dead] = await database
      .insert(outboxEvents)
      .values({
        organizationId,
        aggregateType: "Encounter",
        aggregateId: encounterId,
        eventType: "ENCOUNTER_COMPLETED",
        payload: { encounterId },
        publishAttempts: OUTBOX_MAX_ATTEMPTS,
        publishDeadLetteredAt: new Date("2026-09-06T12:00:00.000Z"),
        publishLastError: "Zustellung fehlgeschlagen",
      })
      .returning();
    const broadcaster = recorder();

    await publishOutboxBatch(database, broadcaster, {
      logger: silentLogger,
      limit: 500,
    });

    expect(
      broadcaster.sent.filter((entry) => entry.payload.eventId === dead?.id),
    ).toEqual([]);
    const [stored] = await database
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, dead?.id ?? ""));
    expect(stored?.publishedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Tests laufen lassen und Fehlschlag bestätigen**

```bash
cd /home/sut/projects/darts-platform/apps/api && npx dotenv -e ../../.env -- npx vitest run src/realtime/publish-outbox.integration.spec.ts
```

Erwartet: FAIL — die drei neuen Fälle brechen ab (`Zustellung fehlgeschlagen` verlässt `publishOutboxBatch` ungefangen; `publishAttempts` existiert im Aufrufobjekt noch nicht).

- [ ] **Step 3: Relay implementieren**

In `apps/api/src/realtime/publish-outbox.ts` den Import-Kopf ersetzen:

```ts
import { and, asc, eq, isNull } from "drizzle-orm";

import {
  OUTBOX_MAX_ATTEMPTS,
  encounterSlots,
  outboxEvents,
  outboxPending,
  recordOutboxFailure,
  tournamentMatches,
  type OutboxLogger,
} from "@darts-platform/database";
```

Und `publishOutboxBatch` samt Kommentar ersetzen:

```ts
export interface PublishOutboxOptions {
  readonly logger: OutboxLogger;
  readonly limit?: number;
  readonly maxAttempts?: number;
  readonly now?: () => Date;
}

/**
 * Verteilt einen Stapel unpublizierter Ereignisse und stempelt jedes einzeln.
 * Der Stempel fällt auch dann, wenn kein Raum zuständig ist — sonst liefe der
 * Poller ewig gegen dieselbe Zeile.
 *
 * Scheitert die Verarbeitung eines Ereignisses, wird der Fehlversuch auf der
 * Zeile gebucht und der Stapel fortgesetzt: ein einzelnes kaputtes Ereignis
 * darf die gesamte Verteilung nicht anhalten. Nach `maxAttempts` Versuchen
 * wandert die Zeile ins Dead Letter und wird nicht mehr gezogen.
 *
 * Der Poller liest organisationsübergreifend. Das ist zulässig, weil er ein
 * Systemprozess ohne Benutzeranfrage ist und jedes Ereignis ausschliesslich
 * in den Raum seines eigenen Aggregats verteilt.
 */
export async function publishOutboxBatch(
  database: Database,
  broadcaster: RealtimeBroadcaster,
  options: PublishOutboxOptions,
): Promise<number> {
  const now = options.now ?? ((): Date => new Date());
  const maxAttempts = options.maxAttempts ?? OUTBOX_MAX_ATTEMPTS;

  const events = await database
    .select()
    .from(outboxEvents)
    .where(outboxPending("publish", now()))
    .orderBy(asc(outboxEvents.occurredAt))
    .limit(options.limit ?? 100);

  for (const event of events) {
    try {
      const broadcast = toBroadcast(event, await resolveScope(database, event));
      if (broadcast !== null) {
        broadcaster.emit(broadcast.room, broadcast.event, broadcast.payload);
      }
      await database
        .update(outboxEvents)
        .set({ publishedAt: now() })
        .where(and(eq(outboxEvents.id, event.id), isNull(outboxEvents.publishedAt)));
    } catch (error) {
      await recordOutboxFailure({
        database,
        consumer: "publish",
        event,
        error,
        now: now(),
        maxAttempts,
        logger: options.logger,
      });
    }
  }
  return events.length;
}
```

- [ ] **Step 4: Aufrufer im API-Prozess anschliessen**

In `apps/api/src/realtime/realtime.service.ts` den Import erweitern:

```ts
import type { OutboxLogger } from "@darts-platform/database";
```

Und `publishOutbox()` ersetzen:

```ts
  /**
   * Bindet die Fehlerbuchung des Relays an den Anwendungslogger. In der
   * Produktion schreibt dieser JSON-Records; `outbox.dead_letter` ist damit
   * in den Railway-Logs auffindbar.
   */
  private readonly outboxLogger: OutboxLogger = {
    emit: (level, fields) => {
      if (level === "error") this.logger.error(fields);
      else if (level === "warn") this.logger.warn(fields);
      else this.logger.debug(fields);
    },
  };

  private async publishOutbox(): Promise<void> {
    if (this.publishing || this.io === null) return;
    this.publishing = true;
    try {
      await publishOutboxBatch(this.database.database, this, {
        logger: this.outboxLogger,
      });
    } catch (error) {
      this.logger.error("Outbox konnte nicht publiziert werden", error);
    } finally {
      this.publishing = false;
    }
  }
```

Das Feld `outboxLogger` gehört zu den übrigen Feldern am Klassenkopf (vor dem Konstruktor).

- [ ] **Step 5: Tests laufen lassen und grün bestätigen**

```bash
cd /home/sut/projects/darts-platform/apps/api && npx dotenv -e ../../.env -- npx vitest run src/realtime/publish-outbox.integration.spec.ts
```

Erwartet: PASS, alle acht Fälle.

- [ ] **Step 6: Betriebsanleitung dokumentieren**

An `DATABASE_SCHEMA.md` §18 (nach dem in Task 2 ergänzten Text, vor dem `---`) anfügen:

````markdown
## Dead Letter finden und erneut einreihen

Nach fünf Fehlversuchen mit exponentiellem Backoff (1 s, 2 s, 4 s, 8 s,
gedeckelt bei 5 min) setzt der betroffene Konsument `*_dead_lettered_at` und
überspringt die Zeile fortan. Das Log-Ereignis `outbox.dead_letter` nennt
`eventId`, `eventType`, `aggregateId`, `attempts` und die letzte Fehlermeldung.

Dead Letter auflisten:

```sql
SELECT id, organization_id, event_type, aggregate_type, aggregate_id, occurred_at,
       publish_attempts, publish_dead_lettered_at, publish_last_error,
       statistics_attempts, statistics_dead_lettered_at, statistics_last_error
FROM outbox_events
WHERE publish_dead_lettered_at IS NOT NULL
   OR statistics_dead_lettered_at IS NOT NULL
ORDER BY occurred_at;
```

Nach behobener Ursache wieder einreihen (Realtime-Konsument):

```sql
UPDATE outbox_events
SET publish_dead_lettered_at = NULL,
    publish_not_before = NULL,
    publish_attempts = 0
WHERE id = '<event-id>';
```

Statistik-Konsument analog mit `statistics_dead_lettered_at`,
`statistics_not_before` und `statistics_attempts`. Beide Poller ziehen die
Zeile beim nächsten Durchlauf erneut. Ein erneut eingereihtes Ereignis ist
ungefährlich: der Realtime-Broadcast ist für die Clients eine Aufforderung
zum Nachladen, und die Statistik wird je Person vollständig neu berechnet.
````

In `ARCHITECTURE.md` §25 nach dem Block „Worker verteilt anschliessend" ergänzen:

```markdown
Beide Konsumenten führen je Zeile einen Versuchszähler und einen
Dead-Letter-Stempel. Ein Ereignis, das fünfmal scheitert, wird übersprungen
und als `outbox.dead_letter` protokolliert, statt die Schlange anzuhalten.
```

- [ ] **Step 7: Qualitätstore und Commit**

```bash
cd /home/sut/projects/darts-platform && pnpm lint && pnpm typecheck && pnpm test
```

```bash
cd /home/sut/projects/darts-platform
git add apps/api/src/realtime/publish-outbox.ts apps/api/src/realtime/publish-outbox.integration.spec.ts apps/api/src/realtime/realtime.service.ts DATABASE_SCHEMA.md ARCHITECTURE.md
git commit -m "fix(api): Realtime-Relay ueberspringt dauerhaft fehlschlagende Ereignisse"
```

---

## Task 4: Statistik-Poller testbar machen und gegen Poison-Events absichern

**Files:**
- Create: `apps/worker/src/statistics/rebuild-player-statistics.ts`
- Create: `apps/worker/src/statistics/process-statistics-outbox.ts`
- Create: `apps/worker/src/statistics/process-statistics-outbox.integration.spec.ts`
- Create: `apps/worker/vitest.config.mts`
- Modify: `apps/worker/src/main.ts` (vollständig ersetzt)

**Interfaces:**
- Consumes: `outboxPending`, `recordOutboxFailure`, `OUTBOX_MAX_ATTEMPTS`, `STATISTICS_OUTBOX_EVENT_TYPE`, `type OutboxLogger`, `type Database` aus `@darts-platform/database`; `createStructuredLogEmitter` aus `@darts-platform/config` (Task 1).
- Produces: `rebuildPlayerStatistics(database: Database, playerId: string, organizationId: string): Promise<void>`; `type RebuildPlayerStatistics = (playerId: string, organizationId: string) => Promise<void>`; `processStatisticsOutbox(options: ProcessStatisticsOutboxOptions): Promise<number>` mit `interface ProcessStatisticsOutboxOptions { readonly database: Database; readonly rebuild: RebuildPlayerStatistics; readonly logger: OutboxLogger; readonly limit?: number; readonly maxAttempts?: number; readonly now?: () => Date }`.

**Warum die Extraktion:** `apps/worker/src/main.ts` startet heute beim Import einen `setInterval` und hält Verbindung und Zustand als Modulvariablen — so ist keine Zeile davon testbar. Die Poll-Runde zieht deshalb in ein eigenes Modul mit `rebuild` als Parameter; der Test schiebt dort eine Neuberechnung ein, die für genau eine Person wirft. `main.ts` bleibt reine Verdrahtung.

**Fachliche Falle, die hier mit erledigt wird:** Der Statistik-Konsument verarbeitet ausschliesslich `MATCH_COMPLETED`. Für jedes andere Ereignis bleibt `statistics_processed_at` auf Dauer leer — das ist Absicht und kein Rückstand. Jede Abfrage auf den Statistik-Rückstand muss deshalb zusätzlich auf `event_type = 'MATCH_COMPLETED'` filtern (gilt auch für den Health-Sondierer in Task 5 und für den partiellen Index aus Teil A).

- [ ] **Step 1: Failing test schreiben**

Datei `apps/worker/src/statistics/process-statistics-outbox.integration.spec.ts`:

```ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  OUTBOX_MAX_ATTEMPTS,
  createDatabaseConnection,
  matchParticipantPlayers,
  matchParticipants,
  matches,
  organizations,
  outboxEvents,
  players,
  type DatabaseConnection,
  type OutboxLogger,
} from "@darts-platform/database";

import { processStatisticsOutbox } from "./process-statistics-outbox.js";

const environment = parseApplicationEnvironment(process.env);
let connection: DatabaseConnection;

interface LoggedRecord {
  readonly level: "error" | "warn" | "debug";
  readonly fields: Readonly<Record<string, unknown>>;
}

function logRecorder(): OutboxLogger & { readonly records: LoggedRecord[] } {
  const records: LoggedRecord[] = [];
  return {
    records,
    emit(level, fields) {
      records.push({ level, fields });
    },
  };
}

const organizationId = randomUUID();
let poisonPlayerId = "";
let healthyPlayerId = "";
let poisonMatchId = "";
let healthyMatchId = "";

async function createCompletedMatch(playerId: string): Promise<string> {
  const database = connection.database;
  const [match] = await database
    .insert(matches)
    .values({
      organizationId,
      bestOfLegs: 3,
      startingSeat: 1,
      status: "COMPLETED",
      winnerSeat: 1,
      completedAt: new Date("2026-09-06T09:00:00.000Z"),
    })
    .returning();
  const [participant] = await database
    .insert(matchParticipants)
    .values({ organizationId, matchId: match?.id ?? "", seat: 1, legsWon: 2 })
    .returning();
  await database.insert(matchParticipantPlayers).values({
    organizationId,
    matchId: match?.id ?? "",
    participantId: participant?.id ?? "",
    playerId,
    position: 1,
  });
  return match?.id ?? "";
}

beforeAll(async () => {
  connection = createDatabaseConnection(environment.DATABASE_URL);
  const database = connection.database;
  await database.insert(organizations).values({
    id: organizationId,
    name: "Statistik Test",
    slug: `statistik-${organizationId.slice(0, 8)}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });
  const [poisonPlayer] = await database
    .insert(players)
    .values({ organizationId, displayName: "Poison Person", status: "ACTIVE" })
    .returning();
  poisonPlayerId = poisonPlayer?.id ?? "";
  const [healthyPlayer] = await database
    .insert(players)
    .values({ organizationId, displayName: "Zweite Person", status: "ACTIVE" })
    .returning();
  healthyPlayerId = healthyPlayer?.id ?? "";
  poisonMatchId = await createCompletedMatch(poisonPlayerId);
  healthyMatchId = await createCompletedMatch(healthyPlayerId);
});

afterAll(async () => {
  await connection.database
    .delete(organizations)
    .where(eq(organizations.id, organizationId));
  await connection.close();
});

describe("processStatisticsOutbox", () => {
  it("verarbeitet nachfolgende Ereignisse, obwohl eines fehlschlägt", async () => {
    const database = connection.database;
    const [poison] = await database
      .insert(outboxEvents)
      .values({
        organizationId,
        aggregateType: "Match",
        aggregateId: poisonMatchId,
        eventType: "MATCH_COMPLETED",
        payload: { matchId: poisonMatchId },
        occurredAt: new Date("2026-09-06T09:00:00.000Z"),
      })
      .returning();
    const [healthy] = await database
      .insert(outboxEvents)
      .values({
        organizationId,
        aggregateType: "Match",
        aggregateId: healthyMatchId,
        eventType: "MATCH_COMPLETED",
        payload: { matchId: healthyMatchId },
        occurredAt: new Date("2026-09-06T09:00:01.000Z"),
      })
      .returning();
    const logger = logRecorder();
    const rebuilt: string[] = [];

    await processStatisticsOutbox({
      database,
      logger,
      limit: 500,
      rebuild: async (playerId) => {
        if (playerId === poisonPlayerId) {
          throw new Error("Aggregat nicht berechenbar");
        }
        rebuilt.push(playerId);
      },
    });

    expect(rebuilt).toContain(healthyPlayerId);
    const [storedHealthy] = await database
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, healthy?.id ?? ""));
    expect(storedHealthy?.statisticsProcessedAt).not.toBeNull();
    const [storedPoison] = await database
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, poison?.id ?? ""));
    expect(storedPoison?.statisticsProcessedAt).toBeNull();
    expect(storedPoison?.statisticsAttempts).toBe(1);
    expect(storedPoison?.statisticsNotBefore).not.toBeNull();
    expect(storedPoison?.statisticsLastError).toBe("Aggregat nicht berechenbar");
  });

  it("legt ein dauerhaft fehlschlagendes Ereignis nach fuenf Versuchen ins Dead Letter", async () => {
    const database = connection.database;
    const start = new Date("2026-09-06T11:00:00.000Z");
    const [poison] = await database
      .insert(outboxEvents)
      .values({
        organizationId,
        aggregateType: "Match",
        aggregateId: poisonMatchId,
        eventType: "MATCH_COMPLETED",
        payload: { matchId: poisonMatchId },
        occurredAt: start,
      })
      .returning();
    const logger = logRecorder();

    for (let attempt = 1; attempt <= OUTBOX_MAX_ATTEMPTS; attempt += 1) {
      const clock = new Date(start.getTime() + attempt * 600_000);
      await processStatisticsOutbox({
        database,
        logger,
        limit: 500,
        now: () => clock,
        rebuild: async (playerId) => {
          if (playerId === poisonPlayerId) {
            throw new Error("Aggregat nicht berechenbar");
          }
        },
      });
    }

    const [stored] = await database
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, poison?.id ?? ""));
    expect(stored?.statisticsAttempts).toBe(OUTBOX_MAX_ATTEMPTS);
    expect(stored?.statisticsDeadLetteredAt).not.toBeNull();
    const deadLetter = logger.records.find(
      (entry) => entry.fields.event === "outbox.dead_letter",
    );
    expect(deadLetter?.level).toBe("error");
    expect(deadLetter?.fields).toMatchObject({
      consumer: "statistics",
      eventId: poison?.id,
      eventType: "MATCH_COMPLETED",
      aggregateId: poisonMatchId,
      attempts: OUTBOX_MAX_ATTEMPTS,
      lastError: "Aggregat nicht berechenbar",
    });
  });

  it("protokolliert jede Verarbeitung mit Ereigniskennung", async () => {
    const database = connection.database;
    const [event] = await database
      .insert(outboxEvents)
      .values({
        organizationId,
        aggregateType: "Match",
        aggregateId: healthyMatchId,
        eventType: "MATCH_COMPLETED",
        payload: { matchId: healthyMatchId },
      })
      .returning();
    const logger = logRecorder();

    await processStatisticsOutbox({
      database,
      logger,
      limit: 500,
      rebuild: async () => undefined,
    });

    const processed = logger.records.find(
      (entry) => entry.fields.eventId === event?.id,
    );
    expect(processed?.fields).toMatchObject({
      event: "statistics.event_processed",
      eventType: "MATCH_COMPLETED",
      aggregateId: healthyMatchId,
    });
  });
});
```

Hinweis zur Testumgebung: Der Poller arbeitet organisationsübergreifend, deshalb stempelt er auch fremde offene `MATCH_COMPLETED`-Zeilen der Entwicklungsdatenbank mit — bei eingeschobener `rebuild`-Funktion ohne fachliche Wirkung. Der bestehende Relay-Test (`publish-outbox.integration.spec.ts`) verfährt seit jeher genauso; Zusicherungen werden nur über die eigenen Ereignisse getroffen.

Datei `apps/worker/vitest.config.mts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 10_000,
  },
});
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

```bash
cd /home/sut/projects/darts-platform/apps/worker && npx dotenv -e ../../.env -- npx vitest run src/statistics/process-statistics-outbox.integration.spec.ts
```

Erwartet: FAIL — `Failed to resolve import "./process-statistics-outbox.js"`.

- [ ] **Step 3: Neuberechnung extrahieren**

Datei `apps/worker/src/statistics/rebuild-player-statistics.ts` — der Rumpf ist die heutige Funktion `rebuild` aus `apps/worker/src/main.ts:12-48`, mit `database` als Parameter statt Modulvariable:

```ts
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  legs,
  matchParticipantPlayers,
  matchParticipants,
  matches,
  playerStatisticAggregates,
  players,
  visits,
  type Database,
} from "@darts-platform/database";
import { calculatePlayerStatistics } from "@darts-platform/statistics";

import { buildStatisticsMatches } from "./build-statistics-matches.js";

export type RebuildPlayerStatistics = (
  playerId: string,
  organizationId: string,
) => Promise<void>;

/**
 * Rechnet die Karriereaggregate einer Person vollständig neu (ADR 0009:
 * Aggregate sind nie die einzige Wahrheit). Die volle Neuberechnung macht
 * einen wiederholten Lauf über dasselbe Ereignis unschädlich.
 */
export async function rebuildPlayerStatistics(
  database: Database,
  playerId: string,
  organizationId: string,
): Promise<void> {
  const matchRows = await database
    .select({
      id: matches.id,
      winnerSeat: matches.winnerSeat,
      completedAt: matches.completedAt,
    })
    .from(matchParticipantPlayers)
    .innerJoin(
      matches,
      and(
        eq(matches.id, matchParticipantPlayers.matchId),
        eq(matches.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(matchParticipantPlayers.organizationId, organizationId),
        eq(matchParticipantPlayers.playerId, playerId),
        eq(matches.status, "COMPLETED"),
      ),
    );
  const completed = matchRows.filter(
    (match): match is typeof match & { winnerSeat: number; completedAt: Date } =>
      match.winnerSeat !== null && match.completedAt !== null,
  );
  const ids = completed.map((match) => match.id);
  if (ids.length === 0) return;

  const [participantRows, legRows, visitRows] = await Promise.all([
    database
      .select({
        matchId: matchParticipants.matchId,
        seat: matchParticipants.seat,
        playerId: matchParticipantPlayers.playerId,
        displayName: players.displayName,
        legsWon: matchParticipants.legsWon,
      })
      .from(matchParticipants)
      .innerJoin(
        matchParticipantPlayers,
        and(
          eq(matchParticipantPlayers.participantId, matchParticipants.id),
          eq(matchParticipantPlayers.organizationId, organizationId),
        ),
      )
      .innerJoin(
        players,
        and(
          eq(players.id, matchParticipantPlayers.playerId),
          eq(players.organizationId, organizationId),
        ),
      )
      .where(
        and(
          eq(matchParticipants.organizationId, organizationId),
          inArray(matchParticipants.matchId, ids),
        ),
      )
      .orderBy(asc(matchParticipants.seat), asc(matchParticipantPlayers.position)),
    database
      .select()
      .from(legs)
      .where(and(eq(legs.organizationId, organizationId), inArray(legs.matchId, ids))),
    database
      .select()
      .from(visits)
      .where(
        and(eq(visits.organizationId, organizationId), inArray(visits.matchId, ids)),
      ),
  ]);

  const statisticsMatches = buildStatisticsMatches({
    matches: completed,
    participants: participantRows,
    legs: legRows.map((leg) => ({
      id: leg.id,
      matchId: leg.matchId,
      winnerSeat: leg.winnerSeat,
    })),
    visits: visitRows.map((visit) => ({
      matchId: visit.matchId,
      legId: visit.legId,
      throwerPlayerId: visit.throwerPlayerId,
      appliedPoints: visit.appliedPoints,
      dartsThrown: visit.dartsThrown,
      checkoutAttempts: visit.checkoutAttempts,
      outcome: visit.outcome,
      revertedAt: visit.revertedAt,
    })),
  });

  const aggregate = calculatePlayerStatistics(playerId, statisticsMatches);
  const now = new Date();
  await database
    .insert(playerStatisticAggregates)
    .values({
      playerId,
      organizationId,
      payload: aggregate.career,
      sourceUpdatedAt: now,
    })
    .onConflictDoUpdate({
      target: playerStatisticAggregates.playerId,
      set: { payload: aggregate.career, sourceUpdatedAt: now, updatedAt: now },
    });
}
```

- [ ] **Step 4: Poll-Runde implementieren**

Datei `apps/worker/src/statistics/process-statistics-outbox.ts`:

```ts
import { and, asc, eq } from "drizzle-orm";
import {
  OUTBOX_MAX_ATTEMPTS,
  STATISTICS_OUTBOX_EVENT_TYPE,
  matchParticipantPlayers,
  outboxEvents,
  outboxPending,
  recordOutboxFailure,
  type Database,
  type OutboxLogger,
} from "@darts-platform/database";

import type { RebuildPlayerStatistics } from "./rebuild-player-statistics.js";

export interface ProcessStatisticsOutboxOptions {
  readonly database: Database;
  readonly rebuild: RebuildPlayerStatistics;
  readonly logger: OutboxLogger;
  readonly limit?: number;
  readonly maxAttempts?: number;
  readonly now?: () => Date;
}

/**
 * Eine Runde des Statistik-Konsumenten. Verarbeitet ausschliesslich
 * `MATCH_COMPLETED`; für jeden anderen Ereignistyp bleibt
 * `statistics_processed_at` bewusst leer.
 *
 * Scheitert ein Ereignis, wird der Fehlversuch auf der Zeile gebucht und die
 * Runde fortgesetzt — ein kaputtes Ereignis darf die Aggregation nicht
 * anhalten. Nach `maxAttempts` Versuchen wandert es ins Dead Letter.
 *
 * Der Poller liest organisationsübergreifend: ein Systemprozess ohne
 * Benutzeranfrage, der je Ereignis mit dessen eigener `organizationId`
 * weiterrechnet.
 */
export async function processStatisticsOutbox(
  options: ProcessStatisticsOutboxOptions,
): Promise<number> {
  const { database, logger } = options;
  const now = options.now ?? ((): Date => new Date());
  const maxAttempts = options.maxAttempts ?? OUTBOX_MAX_ATTEMPTS;

  const events = await database
    .select()
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.eventType, STATISTICS_OUTBOX_EVENT_TYPE),
        outboxPending("statistics", now()),
      ),
    )
    .orderBy(asc(outboxEvents.occurredAt))
    .limit(options.limit ?? 20);

  for (const event of events) {
    try {
      const participantRows = await database
        .select({
          playerId: matchParticipantPlayers.playerId,
          participantId: matchParticipantPlayers.participantId,
        })
        .from(matchParticipantPlayers)
        .where(
          and(
            eq(matchParticipantPlayers.organizationId, event.organizationId),
            eq(matchParticipantPlayers.matchId, event.aggregateId),
          ),
        );

      // Ein Doppel traegt je Sitz mehr als eine Person und zaehlt in der
      // Einzelrangliste nicht mit (Spec "Statistik"). Das Ereignis gilt
      // trotzdem als verarbeitet, sonst laeuft der Poller ewig dagegen.
      const seats = new Set(participantRows.map((participant) => participant.participantId));
      if (seats.size === participantRows.length) {
        for (const participant of participantRows) {
          await options.rebuild(participant.playerId, event.organizationId);
        }
      }

      await database
        .update(outboxEvents)
        .set({ statisticsProcessedAt: now() })
        .where(eq(outboxEvents.id, event.id));

      logger.emit("debug", {
        event: "statistics.event_processed",
        eventId: event.id,
        eventType: event.eventType,
        aggregateId: event.aggregateId,
        organizationId: event.organizationId,
        players: participantRows.length,
      });
    } catch (error) {
      await recordOutboxFailure({
        database,
        consumer: "statistics",
        event,
        error,
        now: now(),
        maxAttempts,
        logger,
      });
    }
  }

  return events.length;
}
```

- [ ] **Step 5: Test laufen lassen und grün bestätigen**

```bash
cd /home/sut/projects/darts-platform/apps/worker && npx dotenv -e ../../.env -- npx vitest run src/statistics/process-statistics-outbox.integration.spec.ts
```

Erwartet: PASS, drei Fälle.

- [ ] **Step 6: `main.ts` auf reine Verdrahtung reduzieren**

`apps/worker/src/main.ts` vollständig ersetzen:

```ts
import { createStructuredLogEmitter, parseApplicationEnvironment } from "@darts-platform/config";
import { createDatabaseConnection, type OutboxLogger } from "@darts-platform/database";

import { processStatisticsOutbox } from "./statistics/process-statistics-outbox.js";
import { rebuildPlayerStatistics } from "./statistics/rebuild-player-statistics.js";

const environment = parseApplicationEnvironment(process.env);
const connection = createDatabaseConnection(environment.DATABASE_URL);
const logger = createStructuredLogEmitter("worker", environment.LOG_LEVEL);
const outboxLogger: OutboxLogger = {
  emit: (level, fields) => logger.emit(level, fields),
};

let working = false;

async function tick(): Promise<void> {
  if (working) return;
  working = true;
  try {
    await processStatisticsOutbox({
      database: connection.database,
      logger: outboxLogger,
      rebuild: (playerId, organizationId) =>
        rebuildPlayerStatistics(connection.database, playerId, organizationId),
    });
  } catch (error) {
    // Hierher kommen nur Fehler ausserhalb der Ereignisschleife, etwa eine
    // abgerissene Verbindung beim Lesen des Stapels. Fehler einzelner
    // Ereignisse werden in der Schleife gebucht.
    logger.emit("error", {
      event: "statistics.tick_failed",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    working = false;
  }
}

setInterval(() => void tick(), 1_000);
void tick();

process.on("SIGTERM", () => void connection.close().finally(() => process.exit(0)));
process.on("SIGINT", () => void connection.close().finally(() => process.exit(0)));
```

- [ ] **Step 7: Worker-Suite und Build prüfen**

```bash
cd /home/sut/projects/darts-platform && npx dotenv -e .env -- pnpm --filter @darts-platform/worker test
cd /home/sut/projects/darts-platform && pnpm build:worker
```

Erwartet: alle Worker-Tests PASS (inklusive `module-format.spec.ts`, das `.spec.ts` weiterhin aus dem Build ausschliesst), Build ohne Fehler.

- [ ] **Step 8: Qualitätstore und Commit**

```bash
cd /home/sut/projects/darts-platform && pnpm lint && pnpm typecheck && pnpm test
```

```bash
cd /home/sut/projects/darts-platform
git add apps/worker/src/main.ts apps/worker/src/statistics/rebuild-player-statistics.ts apps/worker/src/statistics/process-statistics-outbox.ts apps/worker/src/statistics/process-statistics-outbox.integration.spec.ts apps/worker/vitest.config.mts
git commit -m "fix(worker): Statistik-Poller mit Dead Letter und strukturierten Logs"
```

---

## Task 5: Health-Endpunkt meldet Outbox-Rückstand

**Files:**
- Modify: `packages/schemas/src/health.ts`
- Modify: `packages/schemas/src/index.ts:1-6`
- Create: `apps/api/src/health/outbox-health.service.ts`
- Create: `apps/api/src/health/outbox-health.integration.spec.ts`
- Modify: `apps/api/src/health/health.service.ts`
- Modify: `apps/api/src/health/health.controller.ts:17-26`
- Modify: `apps/api/src/health/health.module.ts`
- Test: `apps/api/src/health/health.controller.spec.ts`
- Modify: `infrastructure/railway.md:390-400`
- Modify: `ARCHITECTURE.md:1013-1032` (§31)

**Interfaces:**
- Consumes: `STATISTICS_OUTBOX_EVENT_TYPE` aus `@darts-platform/database` (Task 2).
- Produces (`@darts-platform/schemas`): `outboxHealthSchema`, `type OutboxHealth = { publishLagSeconds: number | null; statisticsLagSeconds: number | null; deadLettered: number }`, `HealthResponse` um `outbox: OutboxHealth` erweitert, `status` erweitert auf `"ok" | "degraded" | "unhealthy"`.
- Produces (API): `class OutboxHealthService { read(): Promise<OutboxHealth> }`, Konstante `OUTBOX_LAG_DEGRADED_SECONDS = 60` in `health.service.ts`.

**Statusabbildung und warum sie so aussehen muss:** `.railway/railway.ts:63` setzt `healthcheck: "/api/v1/health"` mit `healthcheckTimeout: 120` — Railway lässt ein Deployment erst live gehen, wenn dieser Pfad HTTP 200 liefert, und `infrastructure/railway.md:392-396` schreibt genau das als Prüfschritt fest. Auch `apps/web/playwright.config.ts:34` wartet vor der E2E-Suite auf 200 an derselben URL. Ein Outbox-Rückstand darf deshalb nie 503 auslösen: sonst scheitert ein Deployment oder ein E2E-Lauf, weil Realtime hinterherhinkt. Der Statuswert wird dreistufig:

- `ok` — Abhängigkeiten erreichbar, kein Rückstand über der Schwelle, kein Dead Letter → HTTP 200
- `degraded` — Abhängigkeiten erreichbar, aber Rückstand ≥ 60 s bei einem Konsumenten oder mindestens ein Dead Letter → **HTTP 200**
- `unhealthy` — Datenbank oder Redis nicht erreichbar → HTTP 503 (das ist der Fall, den `railway.md` heute mit „degraded" beschreibt)

- [ ] **Step 1: Failing tests schreiben**

`apps/api/src/health/health.controller.spec.ts` erweitern. Import ergänzen:

```ts
import type { HealthResponse, OutboxHealth } from "@darts-platform/schemas";

import { OutboxHealthService } from "./outbox-health.service.js";
```

Im `describe`-Kopf neben den bestehenden Stubs:

```ts
  const healthyOutbox: OutboxHealth = {
    publishLagSeconds: 0,
    statisticsLagSeconds: null,
    deadLettered: 0,
  };
  const readOutbox = vi.fn(async (): Promise<OutboxHealth> => healthyOutbox);
```

In `beforeEach` vor dem Modulaufbau `readOutbox.mockClear(); readOutbox.mockResolvedValue(healthyOutbox);` ergänzen und den Provider anhängen:

```ts
        {
          provide: OutboxHealthService,
          useValue: { read: readOutbox },
        },
```

Den bestehenden Fall „reports healthy database and Redis dependencies" auf den neuen Rumpf anheben:

```ts
    expect(response.json<HealthResponse>()).toEqual({
      status: "ok",
      services: { database: "ok", redis: "ok" },
      outbox: { publishLagSeconds: 0, statisticsLagSeconds: null, deadLettered: 0 },
    });
```

Den Fall „reports a degraded state when a dependency is unavailable" auf `unhealthy` umstellen:

```ts
    expect(response.statusCode).toBe(503);
    expect(response.json<HealthResponse>()).toMatchObject({
      status: "unhealthy",
      services: { database: "ok", redis: "error" },
    });
```

Und zwei Fälle anfügen:

```ts
  it("meldet degraded bei Outbox-Rueckstand, ohne den Container abzuwerten", async () => {
    readOutbox.mockResolvedValue({
      publishLagSeconds: 120,
      statisticsLagSeconds: 0,
      deadLettered: 0,
    });

    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/api/v1/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<HealthResponse>()).toEqual({
      status: "degraded",
      services: { database: "ok", redis: "ok" },
      outbox: { publishLagSeconds: 120, statisticsLagSeconds: 0, deadLettered: 0 },
    });
  });

  it("meldet degraded, sobald ein Ereignis im Dead Letter liegt", async () => {
    readOutbox.mockResolvedValue({
      publishLagSeconds: 1,
      statisticsLagSeconds: 1,
      deadLettered: 2,
    });

    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/api/v1/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<HealthResponse>().status).toBe("degraded");
  });
```

Datei `apps/api/src/health/outbox-health.integration.spec.ts`:

```ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { organizations, outboxEvents } from "@darts-platform/database";

import { DatabaseService } from "../database/database.service.js";
import { OutboxHealthService } from "./outbox-health.service.js";

const databaseService = new DatabaseService(parseApplicationEnvironment(process.env));
const database = databaseService.database;
const service = new OutboxHealthService(databaseService);
const organizationId = randomUUID();

beforeAll(async () => {
  await database.insert(organizations).values({
    id: organizationId,
    name: "Outbox Health",
    slug: `outbox-health-${organizationId.slice(0, 8)}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });
});

afterAll(async () => {
  await database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.onApplicationShutdown();
});

describe("OutboxHealthService", () => {
  it("misst das Alter des aeltesten offenen Ereignisses je Konsument", async () => {
    await database.insert(outboxEvents).values({
      organizationId,
      aggregateType: "Match",
      aggregateId: randomUUID(),
      eventType: "MATCH_COMPLETED",
      payload: {},
      occurredAt: new Date(Date.now() - 3_600_000),
    });

    const health = await service.read();

    expect(health.publishLagSeconds).not.toBeNull();
    expect(health.publishLagSeconds ?? 0).toBeGreaterThanOrEqual(3_600);
    expect(health.statisticsLagSeconds ?? 0).toBeGreaterThanOrEqual(3_600);
  });

  it("zaehlt Dead Letter und laesst sie nicht als Rueckstand gelten", async () => {
    const before = await service.read();
    await database.insert(outboxEvents).values({
      organizationId,
      aggregateType: "Match",
      aggregateId: randomUUID(),
      eventType: "MATCH_COMPLETED",
      payload: {},
      occurredAt: new Date("2020-01-01T00:00:00.000Z"),
      publishDeadLetteredAt: new Date(),
      statisticsDeadLetteredAt: new Date(),
      publishAttempts: 5,
      statisticsAttempts: 5,
    });

    const after = await service.read();

    expect(after.deadLettered).toBe(before.deadLettered + 1);
    // Die Dead-Letter-Zeile ist aelter als alles andere; taeuchte sie im
    // Rueckstand auf, waere der Wert jetzt jenseits von 2020.
    expect(after.publishLagSeconds).toBe(before.publishLagSeconds);
  });

  it("ignoriert Ereignistypen, die der Statistik-Konsument nie verarbeitet", async () => {
    const before = await service.read();
    await database.insert(outboxEvents).values({
      organizationId,
      aggregateType: "Encounter",
      aggregateId: randomUUID(),
      eventType: "ENCOUNTER_STARTED",
      payload: {},
      occurredAt: new Date("2019-01-01T00:00:00.000Z"),
      statisticsProcessedAt: null,
      publishedAt: new Date(),
    });

    const after = await service.read();

    expect(after.statisticsLagSeconds).toBe(before.statisticsLagSeconds);
  });
});
```

- [ ] **Step 2: Tests laufen lassen und Fehlschlag bestätigen**

```bash
cd /home/sut/projects/darts-platform/apps/api && npx dotenv -e ../../.env -- npx vitest run src/health
```

Erwartet: FAIL — `Failed to resolve import "./outbox-health.service.js"`.

- [ ] **Step 3: Schema erweitern**

`packages/schemas/src/health.ts` ersetzen:

```ts
import { z } from "zod";

export const serviceHealthStatusSchema = z.enum(["ok", "error"]);

export const outboxHealthSchema = z.object({
  /** Alter des ältesten unverteilten Ereignisses in Sekunden, null wenn keines offen ist. */
  publishLagSeconds: z.number().nonnegative().nullable(),
  /** Dasselbe für den Statistik-Konsumenten (nur MATCH_COMPLETED). */
  statisticsLagSeconds: z.number().nonnegative().nullable(),
  /** Zeilen, die ein Konsument nach zu vielen Fehlversuchen übersprungen hat. */
  deadLettered: z.number().int().nonnegative(),
});

export const healthResponseSchema = z.object({
  // "unhealthy" bedeutet: eine Abhängigkeit fehlt, HTTP 503. "degraded"
  // bleibt HTTP 200 — Railway und Playwright warten auf 200, und ein
  // Outbox-Rückstand darf kein Deployment blockieren.
  status: z.enum(["ok", "degraded", "unhealthy"]),
  services: z.object({
    database: serviceHealthStatusSchema,
    redis: serviceHealthStatusSchema,
  }),
  outbox: outboxHealthSchema,
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type OutboxHealth = z.infer<typeof outboxHealthSchema>;
export type ServiceHealthStatus = z.infer<typeof serviceHealthStatusSchema>;
```

`packages/schemas/src/index.ts` — den ersten Export-Block ersetzen:

```ts
export {
  healthResponseSchema,
  outboxHealthSchema,
  serviceHealthStatusSchema,
  type HealthResponse,
  type OutboxHealth,
  type ServiceHealthStatus,
} from "./health";
```

- [ ] **Step 4: Sondierer implementieren**

Datei `apps/api/src/health/outbox-health.service.ts`:

```ts
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";

import { STATISTICS_OUTBOX_EVENT_TYPE, outboxEvents } from "@darts-platform/database";
import type { OutboxHealth } from "@darts-platform/schemas";

import { DatabaseService } from "../database/database.service.js";

/**
 * Misst den Rückstand beider Outbox-Konsumenten. Die Abfragen laufen ohne
 * Organisationsfilter: ein Betriebssignal über den gesamten Prozess, keine
 * Benutzeranfrage — herausgegeben werden nur Zahlen, keine Organisationsdaten.
 *
 * Das Alter wird in der Datenbank gerechnet (`now()`), damit eine Abweichung
 * der Anwendungsuhr das Signal nicht verfälscht. Dead-Letter-Zeilen zählen
 * nicht als Rückstand — sie warten auf eine Entscheidung, nicht auf den
 * Poller. Der Statistik-Rückstand filtert zusätzlich auf
 * `MATCH_COMPLETED`, weil `statistics_processed_at` für jeden anderen
 * Ereignistyp planmässig für immer leer bleibt.
 */
@Injectable()
export class OutboxHealthService {
  public constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
  ) {}

  public async read(): Promise<OutboxHealth> {
    const database = this.databaseService.database;
    const lagSeconds = sql<string>`extract(epoch from (now() - ${outboxEvents.occurredAt}))`;

    const [publishOldest] = await database
      .select({ lagSeconds })
      .from(outboxEvents)
      .where(
        and(
          isNull(outboxEvents.publishedAt),
          isNull(outboxEvents.publishDeadLetteredAt),
        ),
      )
      .orderBy(asc(outboxEvents.occurredAt))
      .limit(1);

    const [statisticsOldest] = await database
      .select({ lagSeconds })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.eventType, STATISTICS_OUTBOX_EVENT_TYPE),
          isNull(outboxEvents.statisticsProcessedAt),
          isNull(outboxEvents.statisticsDeadLetteredAt),
        ),
      )
      .orderBy(asc(outboxEvents.occurredAt))
      .limit(1);

    const [deadLettered] = await database
      .select({ total: sql<string>`count(*)` })
      .from(outboxEvents)
      .where(
        or(
          isNotNull(outboxEvents.publishDeadLetteredAt),
          isNotNull(outboxEvents.statisticsDeadLetteredAt),
        ),
      );

    return {
      publishLagSeconds: toSeconds(publishOldest?.lagSeconds),
      statisticsLagSeconds: toSeconds(statisticsOldest?.lagSeconds),
      deadLettered: Number(deadLettered?.total ?? "0"),
    };
  }
}

function toSeconds(value: string | undefined): number | null {
  if (value === undefined) return null;
  return Math.max(0, Math.round(Number(value)));
}
```

- [ ] **Step 5: Health-Dienst, Controller und Modul anschliessen**

`apps/api/src/health/health.service.ts` ersetzen:

```ts
import { Inject, Injectable } from "@nestjs/common";

import type {
  HealthResponse,
  OutboxHealth,
  ServiceHealthStatus,
} from "@darts-platform/schemas";

import { DatabaseService } from "../database/database.service.js";
import { RedisService } from "../redis/redis.service.js";
import { OutboxHealthService } from "./outbox-health.service.js";

/** Ab dieser Rückstandsdauer je Konsument gilt der Dienst als beeinträchtigt. */
export const OUTBOX_LAG_DEGRADED_SECONDS = 60;

const unknownOutbox: OutboxHealth = {
  publishLagSeconds: null,
  statisticsLagSeconds: null,
  deadLettered: 0,
};

@Injectable()
export class HealthService {
  public constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(RedisService) private readonly redisService: RedisService,
    @Inject(OutboxHealthService)
    private readonly outboxHealthService: OutboxHealthService,
  ) {}

  private async check(checker: () => Promise<void>): Promise<ServiceHealthStatus> {
    try {
      await checker();
      return "ok";
    } catch {
      return "error";
    }
  }

  /**
   * Ist die Datenbank weg, scheitert auch diese Abfrage — das meldet bereits
   * `services.database`. Der Rückstand wird dann als unbekannt ausgewiesen,
   * statt die ganze Antwort scheitern zu lassen.
   */
  private async readOutbox(): Promise<OutboxHealth> {
    try {
      return await this.outboxHealthService.read();
    } catch {
      return unknownOutbox;
    }
  }

  public async getHealth(): Promise<HealthResponse> {
    const [database, redis, outbox] = await Promise.all([
      this.check(() => this.databaseService.checkConnection()),
      this.check(() => this.redisService.checkConnection()),
      this.readOutbox(),
    ]);

    const dependenciesAvailable = database === "ok" && redis === "ok";
    const outboxDegraded =
      outbox.deadLettered > 0 ||
      exceedsThreshold(outbox.publishLagSeconds) ||
      exceedsThreshold(outbox.statisticsLagSeconds);

    return {
      status: !dependenciesAvailable ? "unhealthy" : outboxDegraded ? "degraded" : "ok",
      services: {
        database,
        redis,
      },
      outbox,
    };
  }
}

function exceedsThreshold(lagSeconds: number | null): boolean {
  return lagSeconds !== null && lagSeconds >= OUTBOX_LAG_DEGRADED_SECONDS;
}
```

`apps/api/src/health/health.controller.ts` — die Statusabbildung ersetzen:

```ts
    const health = await this.healthService.getHealth();
    // Nur eine fehlende Abhängigkeit ist ein 503. Ein Outbox-Rückstand
    // bleibt 200: Railway nutzt diesen Pfad als Deploy-Gate
    // (.railway/railway.ts) und dürfte deswegen kein Deployment abweisen.
    if (health.status === "unhealthy") {
      reply.status(503);
    }
    return health;
```

`apps/api/src/health/health.module.ts` — Provider ergänzen:

```ts
import { Module } from "@nestjs/common";

import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";
import { OutboxHealthService } from "./outbox-health.service.js";

@Module({
  controllers: [HealthController],
  providers: [HealthService, OutboxHealthService],
})
export class HealthModule {}
```

- [ ] **Step 6: Tests laufen lassen und grün bestätigen**

```bash
cd /home/sut/projects/darts-platform/apps/api && npx dotenv -e ../../.env -- npx vitest run src/health
```

Erwartet: PASS, sieben Fälle (vier Controller, drei Integration).

- [ ] **Step 7: Betriebsdokumentation nachziehen**

In `infrastructure/railway.md` beim Health-Abschnitt (um Zeile 392) den Absatz „Der Health-Endpunkt muss HTTP 200 liefern …" ersetzen:

````markdown
Der Health-Endpunkt muss HTTP 200 liefern. HTTP 503 kommt ausschliesslich bei
`status: "unhealthy"`, also wenn PostgreSQL oder Redis nicht erreichbar sind;
Railway nutzt denselben Pfad als Deploy-Gate (`.railway/railway.ts`,
`healthcheck: "/api/v1/health"`).

`status: "degraded"` antwortet bewusst mit HTTP 200. Der Wert erscheint, wenn
der Outbox-Rückstand eines Konsumenten 60 Sekunden erreicht oder mindestens
ein Ereignis im Dead Letter liegt:

```json
{
  "status": "degraded",
  "services": { "database": "ok", "redis": "ok" },
  "outbox": { "publishLagSeconds": 184, "statisticsLagSeconds": 0, "deadLettered": 1 }
}
```

Realtime hinkt dann nach, der Spielbetrieb über HTTP läuft weiter — ein
Neustart oder ein abgewiesenes Deployment würde die Lage nur verschlimmern.
Vorgehen: Logs nach `outbox.dead_letter` durchsuchen und die betroffenen
Zeilen nach `DATABASE_SCHEMA.md` §18 behandeln.
```

In `ARCHITECTURE.md` §31 die Aufzählung ergänzen:

```markdown
- Health Endpoints inklusive Outbox-Rückstand je Konsument
````

- [ ] **Step 8: Qualitätstore und Commit**

```bash
cd /home/sut/projects/darts-platform && pnpm lint && pnpm typecheck && pnpm test
```

```bash
cd /home/sut/projects/darts-platform
git add packages/schemas/src/health.ts packages/schemas/src/index.ts apps/api/src/health infrastructure/railway.md ARCHITECTURE.md
git commit -m "feat(api): Outbox-Rueckstand im Health-Endpunkt melden"
```

---

## Task 6: Abschluss — Gesamtprüfung

**Files:** keine Änderung, sofern die Prüfungen grün sind.

- [ ] **Step 1: Vollständige Suite**

```bash
cd /home/sut/projects/darts-platform && pnpm lint && pnpm typecheck && pnpm test
```

Erwartet: alles grün.

- [ ] **Step 2: Build aller Deployment-Artefakte**

```bash
cd /home/sut/projects/darts-platform && pnpm build
```

Erwartet: API, Worker und Web bauen durch (`NODE_ENV=production` setzt das Skript selbst).

- [ ] **Step 3: E2E mit einem Worker**

```bash
cd /home/sut/projects/darts-platform && pnpm test:e2e
```

Erwartet: grün. Playwright wartet auf HTTP 200 an `/api/v1/health` — mit dem dreistufigen Status bleibt das auch bei Rückstand in der Entwicklungsdatenbank erfüllt.

- [ ] **Step 4: Migration gegen eine frische Datenbank prüfen**

```bash
cd /home/sut/projects/darts-platform && npx dotenv -e .env -- node -e "const p=require('postgres');const s=p(process.env.DATABASE_URL);s\`select indexname from pg_indexes where tablename='outbox_events' order by indexname\`.then(r=>{console.log(r.map(x=>x.indexname).join('\n'));return s.end();})"
```

Erwartet: unter anderem `outbox_events_dead_lettered_idx`.

- [ ] **Step 5: Abschluss-Commit, falls Prüfungen Anpassungen erzwangen**

```bash
cd /home/sut/projects/darts-platform
git add -A
git commit -m "chore(betrieb): Abschlusspruefung Tier 2 Teil D"
```

Ohne Änderungen entfällt dieser Schritt.

---

## Self-Review

**Spec-Deckung**

| Anforderung | Task |
| --- | --- |
| F-1 Versuchszähler und Dead-Letter-Zustand je Konsument (Spalten, Begründung der Struktur) | Task 2, Steps 3–6 |
| F-1 exponentielles Backoff (`now() + backoff(attempts)`) | Task 2 (`outboxRetryDelayMs`, `*_not_before`), angewendet in Tasks 3 und 4 |
| F-1 Dead Letter nach N=5 Versuchen, Zeile wird übersprungen | Task 2 (`recordOutboxFailure`), Tasks 3/4 (Auswahlprädikat) |
| F-1 strukturiertes Log `outbox.dead_letter` mit `eventId`, `eventType`, `aggregateId`, `attempts`, letztem Fehler | Task 2 Step 6, getestet in Task 3 Step 1 und Task 4 Step 1 |
| F-1 Dead Letter per SQL auffindbar und wieder einreihbar, dokumentiert in `DATABASE_SCHEMA.md` §`outbox_events` | Task 3 Step 6 |
| F-1 Migration als Vorwärtsmigration mit nächster freier Nummer und Abhängigkeitsvermerk | Task 2 (Merge-Hinweis, Steps 4–5) |
| F-1 Integrationstest: nachfolgende Ereignisse laufen weiter, Dead Letter nach N, Log-Ereignis sichtbar — beide Pfade | Task 3 Step 1 (API/Relay), Task 4 Step 1 (Worker) |
| F-M10 Rückstand je Konsument im Health-Body als `outbox: { publishLagSeconds, statisticsLagSeconds, deadLettered }` | Task 5 Steps 3–5 |
| F-M10 `degraded` ab benannter Schwelle, nie `unhealthy` allein deswegen; Railway-Verhalten geprüft | Task 5 Kopfabschnitt, Steps 5 und 7 |
| F-M10 Test im Stil von `health.controller.spec.ts` | Task 5 Step 1 |
| F-M9 derselbe strukturierte JSON-Logger wie in der API, ohne NestJS-Abhängigkeit | Task 1 (Kern in `packages/config`, kein neues Paket) |
| F-M9 `eventId`/`eventType` je Verarbeitung | Task 4 Step 4 (`statistics.event_processed`), getestet in Task 4 Step 1 |
| Tenant-Begründung für die organisationsübergreifenden Systemabfragen | Global Constraints, Kommentare in Task 2 Step 6, Task 3 Step 3, Task 4 Step 4, Task 5 Step 4 |

**Platzhalter-Kontrolle:** Kein „TBD", kein „analog zu Task N" — die Worker-Tests wiederholen den Backoff-Aufbau vollständig, weil die Aufgaben getrennt ausgeführt werden. Jeder Codeschritt enthält den einzusetzenden Text.

**Typkonsistenz:** `OutboxLogger.emit(level: "error" | "warn" | "debug", fields)` wird von `StructuredLogEmitter.emit(level: ApplicationLogLevel, fields: LogFields)` über Arrow-Zuweisung erfüllt (Task 4 Step 6) beziehungsweise vom Nest-Logger-Adapter (Task 3 Step 4). `outboxPending` liefert `SQL | undefined` und wird ausschliesslich an `.where(...)` übergeben, das diesen Typ akzeptiert. `recordOutboxFailure` bekommt in beiden Konsumenten die vollständige Zeile (`select()` ohne Projektion, Typ `OutboxEvent`), weshalb `publishAttempts`/`statisticsAttempts` dort vorhanden sind. `RebuildPlayerStatistics` wird in `rebuild-player-statistics.ts` definiert und in `process-statistics-outbox.ts` sowie in `main.ts` unter demselben Namen verwendet. `OutboxHealth` stammt aus `@darts-platform/schemas` und wird im Sondierer, im Health-Dienst und im Controller-Test identisch verwendet.

**Offene Kopplung, die beim Ausführen zu prüfen ist:** Trifft Teil A vor diesem Plan im Branch ein, sind `publishOutboxBatch` (Claim-Transaktion, Sortierung) und der Statistik-Poll (partieller Index) bereits umgebaut. Die Merge-Hinweise in Task 2 und Task 3 sagen, welche Zeilen dann übernommen statt ersetzt werden.
