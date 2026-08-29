# Railway-Produktivdeployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Dart-Turnierplattform unter `app.dartbase.ch` und `api.dartbase.ch` produktiv auf Railway betreiben, inklusive eines auditierbaren Erstzugangs für den ersten Live-Test im Dartraum.

**Architecture:** Ein Railway-Environment `production` mit fünf Ressourcen (web, api, worker, PostgreSQL, Redis), deklariert über Railway Infrastructure as Code in `.railway/railway.ts`. Web und API liegen als Subdomains unter derselben registrierbaren Domain, damit die bestehenden `SameSite=Lax`-Sessioncookies ohne Codeänderung funktionieren. Der Erstzugang entsteht durch einen expliziten CLI-Befehl im API-Image, der Organisation, Admin-Einladung und Audit-Eintrag in einer Transaktion anlegt.

**Tech Stack:** TypeScript, pnpm 11, Turborepo, NestJS/Fastify, Next.js 16, Drizzle ORM, PostgreSQL 17, Redis 8, Better Auth, Vitest, Docker, Railway IaC.

**Zugehöriges Spec:** [2026-08-29-railway-production-deployment-design.md](../specs/2026-08-29-railway-production-deployment-design.md)

## Global Constraints

- Node `>=24.0.0`, pnpm `>=11.0.0`, Paketmanager exakt `pnpm@11.24.0`.
- `strict: true` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`. Kein `any`.
- Optionale Objektfelder werden per Spread gesetzt (`...(x === undefined ? {} : { key: x })`), nie als `key: undefined`. `exactOptionalPropertyTypes` verbietet Letzteres.
- ESM: relative Importe innerhalb von `apps/` tragen die Endung `.js`. Importe aus `packages/schemas/src/index.ts` heraus tragen keine Endung — dort dem Bestandsstil folgen.
- Jede tenant-bezogene Query wird nach `organization_id` eingeschränkt.
- Kritische Mutationen laufen in einer Transaktion mit Audit-Eintrag.
- Audit-Konvention: `action` in SCREAMING_SNAKE_CASE, `entityType` in PascalCase, `correlationId` immer gesetzt (NOT NULL).
- Migrationen ausschliesslich über `drizzle-kit generate`, niemals von Hand geschrieben, nach Deployment nie rückwirkend geändert.
- Conventional Commits, kleine Commits, Branch `feature/railway-production-deployment`.
- Vor Abschluss laufen `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- Keine privaten E-Mail-Adressen in Code, Tests, Dokumentation oder Commit-Nachrichten. Tests verwenden `@example.test`.
- Feste Werte für die Inbetriebnahme: Domain `dartbase.ch`, Hosts `app.dartbase.ch` und `api.dartbase.ch`, Organisation `Dart Ost`, Slug `dart-ost`, Rolle `ADMIN`.

---

## File Structure

**Neu:**

| Datei | Verantwortung |
| --- | --- |
| `apps/api/src/cli/bootstrap-organization.service.ts` | reine Domänenlogik des Bootstraps gegen ein `Database`-Handle; kennt weder Prozess noch Argumente |
| `apps/api/src/cli/bootstrap-organization.ts` | CLI-Entrypoint: Argumente, Validierung, Verbindung, Ausgabe, Exit-Codes |
| `apps/api/src/cli/bootstrap-organization.integration.spec.ts` | Integrationstests des Service gegen eine echte Datenbank |
| `docs/adr/0011-railway-production-deployment.md` | Architekturentscheid |

**Geändert:**

| Datei | Änderung |
| --- | --- |
| `packages/database/src/schema.ts:217` | `invitedByUserId` verliert `.notNull()` |
| `packages/database/drizzle/0010_*.sql` | generierte Migration |
| `packages/schemas/src/organization.ts` | `bootstrapOrganizationSchema` ergänzen |
| `packages/schemas/src/index.ts` | neues Schema und Typ exportieren |
| `apps/api/src/auth/auth.integration.spec.ts` | Testfall für Einladung ohne Einlader |
| `.railway/railway.ts` | worker-Service, Domains, vollständige Env |
| `package.json` | `railway` als devDependency |
| `infrastructure/railway.md` | Runbook auf den umgesetzten Stand bringen |

Die Trennung von `bootstrap-organization.service.ts` und `bootstrap-organization.ts` ist bewusst: Die Logik ist ohne Prozessumgebung testbar, der Entrypoint bleibt dünn genug, um ihn beim Lesen ganz zu erfassen.

---

## Task 0: Toolchain herstellen

Ohne diesen Schritt schlägt jeder folgende fehl. Auf dieser Maschine sind Node 24.12.0 und corepack 0.34.5 vorhanden, aber weder pnpm noch die Railway CLI.

**Files:** keine

- [ ] **Step 1: pnpm über corepack aktivieren**

```bash
corepack enable pnpm
corepack prepare pnpm@11.24.0 --activate
pnpm --version
```

Erwartet: `11.24.0`

- [ ] **Step 2: Abhängigkeiten installieren**

```bash
pnpm install --frozen-lockfile
```

Erwartet: Installation ohne Fehler. `strict-peer-dependencies=true` ist gesetzt; bei Peer-Konflikten abbrechen und melden, nicht mit `--no-strict-peer-dependencies` übergehen.

- [ ] **Step 3: `.env` anlegen**

```bash
cp .env.example .env
```

Die Werte aus `.env.example` passen zur lokalen Docker-Infrastruktur und reichen für Tests aus.

- [ ] **Step 4: Lokale Infrastruktur starten**

```bash
pnpm infra:up
```

Erwartet: Container `postgres` und `redis` laufen und sind healthy. Voraussetzung ist ein laufender Docker-Daemon.

- [ ] **Step 5: Migrationen einspielen**

```bash
pnpm db:migrate
```

Erwartet: Läuft durch, Datenbank `darts` enthält alle Tabellen aus `packages/database/drizzle`.

- [ ] **Step 6: Ausgangslage verifizieren**

```bash
pnpm typecheck && pnpm test
```

Erwartet: beides grün. Ist es das nicht, liegt das an der Umgebung, nicht an diesem Plan. Ursache klären, bevor es weitergeht.

- [ ] **Step 7: Railway CLI installieren**

```bash
npm install -g @railway/cli
railway --version
```

Erwartet: eine Versionsnummer. Die CLI wird erst in Task 4 und 6 gebraucht, die Installation hier vermeidet einen Abbruch mitten in der Inbetriebnahme.

---

## Task 1: Migration — `invited_by_user_id` nullable

Die Spalte ist NOT NULL mit Fremdschlüssel auf `users`. Eine Einladung braucht damit einen einladenden Benutzer, ein Benutzer aber eine Einladung. Ohne diese Änderung kann der Bootstrap keine Einladung anlegen.

**Files:**
- Modify: `packages/database/src/schema.ts:215-217`
- Create: `packages/database/drizzle/0010_*.sql` (Name wird generiert)
- Test: `apps/api/src/auth/auth.integration.spec.ts`

**Interfaces:**
- Produces: `organizationInvitations.invitedByUserId` ist ab jetzt `string | null` beim Einfügen.

- [ ] **Step 1: Failing test schreiben**

In `apps/api/src/auth/auth.integration.spec.ts`. Ganz oben neben den bestehenden Konstanten ergänzen:

```ts
const systemInvitedEmail = `auth-system-${randomUUID()}@example.test`;
```

Im `beforeAll`, nach dem bestehenden `insert(organizationInvitations)`, ergänzen:

```ts
  await connection.database.insert(organizationInvitations).values({
    organizationId,
    email: systemInvitedEmail,
    role: "ADMIN",
    invitedByUserId: null,
    expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
  });
```

Im `afterAll` die Aufräumzeile für `users` um die neue Adresse erweitern:

```ts
  await connection.database
    .delete(users)
    .where(inArray(users.email, [email, uninvitedEmail, systemInvitedEmail]));
```

Und als neuen Fall innerhalb von `describe("Better Auth integration", ...)`:

```ts
  it("accepts registration against a system invitation without an inviter", async () => {
    const response = await auth.handler(
      new Request(`${environment.BETTER_AUTH_URL}/api/v1/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: systemInvitedEmail,
          password: "bootstrap-password-123",
          name: "System Invited Admin",
        }),
      }),
    );

    expect(response.status).toBe(200);
  });
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

```bash
pnpm --filter @darts-platform/api test -- auth.integration
```

Erwartet: FAIL bereits im `beforeAll`, mit einer Postgres-Meldung in der Art `null value in column "invited_by_user_id" ... violates not-null constraint`.

Schlägt der Test aus einem anderen Grund fehl, ist die Testumgebung nicht in Ordnung — erst das klären.

- [ ] **Step 3: Schema anpassen**

In `packages/database/src/schema.ts`, im Block `organizationInvitations`, `.notNull()` von `invitedByUserId` entfernen:

```ts
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
```

`onDelete: "restrict"` bleibt: Ein Benutzer, der eingeladen hat, darf weiterhin nicht gelöscht werden, solange die Einladung existiert.

- [ ] **Step 4: Migration generieren**

```bash
pnpm db:generate
```

Erwartet: eine neue Datei `packages/database/drizzle/0010_<name>.sql` mit genau dieser Anweisung:

```sql
ALTER TABLE "organization_invitations" ALTER COLUMN "invited_by_user_id" DROP NOT NULL;
```

Enthält die Datei mehr als das, wurde versehentlich eine andere Schemaänderung mitgenommen. Dann Datei und Snapshot verwerfen und den Arbeitsstand prüfen.

- [ ] **Step 5: Migration anwenden**

```bash
pnpm db:migrate
```

- [ ] **Step 6: Test laufen lassen und Erfolg bestätigen**

```bash
pnpm --filter @darts-platform/api test -- auth.integration
```

Erwartet: PASS, auch der bestehende Fall `rejects registration without a valid invitation`.

- [ ] **Step 7: Commit**

```bash
git add packages/database/src/schema.ts packages/database/drizzle apps/api/src/auth/auth.integration.spec.ts
git commit -m "feat: allow system invitations without an inviting user"
```

---

## Task 2: Bootstrap-Schema und -Service

**Files:**
- Modify: `packages/schemas/src/organization.ts`
- Modify: `packages/schemas/src/index.ts`
- Create: `apps/api/src/cli/bootstrap-organization.service.ts`
- Test: `apps/api/src/cli/bootstrap-organization.integration.spec.ts`

**Interfaces:**
- Consumes: `createOrganizationSchema` aus `@darts-platform/schemas`; `Database`, `organizations`, `organizationInvitations`, `auditEvents` aus `@darts-platform/database`.
- Produces:
  - `bootstrapOrganizationSchema` und `BootstrapOrganizationInput` aus `@darts-platform/schemas`
  - `assertNoExistingOrganization(database: Database): Promise<void>`
  - `createBootstrapOrganization(database: Database, input: BootstrapOrganizationInput): Promise<BootstrapOrganizationResult>`
  - `OrganizationAlreadyExistsError`
  - `BootstrapOrganizationResult` mit den Feldern `organizationId`, `name`, `slug`, `invitationId`, `email`, `role`, `expiresAt`

Die Aufteilung in zwei Funktionen ist Absicht: `assertNoExistingOrganization` ist gegen eine belegte Datenbank testbar, `createBootstrapOrganization` gegen eine beliebige. Zusammen ergeben sie den Schutz, einzeln sind sie prüfbar, ohne dass ein Test eine leere Datenbank voraussetzen muss.

- [ ] **Step 1: Schema ergänzen**

In `packages/schemas/src/organization.ts`, direkt nach `createOrganizationSchema`:

```ts
export const bootstrapOrganizationSchema = createOrganizationSchema.extend({
  email: z.email().trim().toLowerCase(),
  expiresInDays: z.coerce.number().int().min(1).max(90).default(7),
});
```

Und bei den Typexporten am Dateiende:

```ts
export type BootstrapOrganizationInput = z.infer<
  typeof bootstrapOrganizationSchema
>;
```

- [ ] **Step 2: Schema exportieren**

In `packages/schemas/src/index.ts`, im `export { ... } from "./organization";`-Block, alphabetisch einsortiert:

```ts
  bootstrapOrganizationSchema,
```

und bei den Typen:

```ts
  type BootstrapOrganizationInput,
```

- [ ] **Step 3: Failing tests schreiben**

Neue Datei `apps/api/src/cli/bootstrap-organization.integration.spec.ts`:

```ts
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  auditEvents,
  createDatabaseConnection,
  organizationInvitations,
  organizations,
} from "@darts-platform/database";
import { bootstrapOrganizationSchema } from "@darts-platform/schemas";

import {
  assertNoExistingOrganization,
  createBootstrapOrganization,
  OrganizationAlreadyExistsError,
} from "./bootstrap-organization.service.js";

const environment = parseApplicationEnvironment(process.env);
const connection = createDatabaseConnection(environment.DATABASE_URL);
const createdOrganizationIds: string[] = [];

afterEach(async () => {
  for (const id of createdOrganizationIds.splice(0)) {
    await connection.database.delete(organizations).where(eq(organizations.id, id));
  }
});

afterAll(async () => {
  await connection.close();
});

describe("createBootstrapOrganization", () => {
  it("creates organization, admin invitation and audit event in one go", async () => {
    const slug = `bootstrap-${randomUUID()}`;
    const email = `bootstrap-${randomUUID()}@example.test`;

    const result = await createBootstrapOrganization(connection.database, {
      name: "Bootstrap Test Organization",
      slug,
      email,
      timezone: "Europe/Zurich",
      locale: "de-CH",
      expiresInDays: 7,
    });
    createdOrganizationIds.push(result.organizationId);

    expect(result.slug).toBe(slug);
    expect(result.email).toBe(email);
    expect(result.role).toBe("ADMIN");

    const [invitation] = await connection.database
      .select()
      .from(organizationInvitations)
      .where(eq(organizationInvitations.id, result.invitationId));

    expect(invitation?.invitedByUserId).toBeNull();
    expect(invitation?.status).toBe("PENDING");
    expect(invitation?.role).toBe("ADMIN");
    expect(invitation?.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const [audit] = await connection.database
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, result.organizationId),
          eq(auditEvents.action, "ORGANIZATION_BOOTSTRAPPED"),
        ),
      );

    expect(audit).toBeDefined();
    expect(audit?.entityType).toBe("Organization");
    expect(audit?.actorUserId).toBeNull();
  });

  it("normalises the invited email and applies schema defaults", async () => {
    const slug = `bootstrap-${randomUUID()}`;
    const local = `bootstrap-${randomUUID()}`;

    const parsed = bootstrapOrganizationSchema.parse({
      name: "Bootstrap Case Organization",
      slug,
      email: `${local}@example.test`.toUpperCase(),
    });

    const result = await createBootstrapOrganization(
      connection.database,
      parsed,
    );
    createdOrganizationIds.push(result.organizationId);

    expect(result.email).toBe(`${local}@example.test`.toLowerCase());

    const [organization] = await connection.database
      .select()
      .from(organizations)
      .where(eq(organizations.id, result.organizationId));

    expect(organization?.timezone).toBe("Europe/Zurich");
    expect(organization?.locale).toBe("de-CH");
  });
});

describe("assertNoExistingOrganization", () => {
  it("rejects when at least one organization exists", async () => {
    const [organization] = await connection.database
      .insert(organizations)
      .values({
        name: "Existing Organization",
        slug: `existing-${randomUUID()}`,
        timezone: "Europe/Zurich",
        locale: "de-CH",
      })
      .returning();

    expect(organization).toBeDefined();
    if (organization === undefined) return;
    createdOrganizationIds.push(organization.id);

    await expect(
      assertNoExistingOrganization(connection.database),
    ).rejects.toBeInstanceOf(OrganizationAlreadyExistsError);
  });
});
```

Der zweite Test normalisiert die E-Mail bewusst über das Schema, nicht im Service — deshalb erwartet er die kleingeschriebene Adresse, obwohl der Service sie gross bekommt. Das schlägt zunächst fehl und wird in Step 5 aufgelöst.

- [ ] **Step 4: Tests laufen lassen und Fehlschlag bestätigen**

```bash
pnpm --filter @darts-platform/api test -- bootstrap-organization
```

Erwartet: FAIL mit `Failed to resolve import "./bootstrap-organization.service.js"`.

- [ ] **Step 5: Service implementieren**

Neue Datei `apps/api/src/cli/bootstrap-organization.service.ts`:

```ts
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

import {
  auditEvents,
  organizationInvitations,
  organizations,
  type Database,
} from "@darts-platform/database";
import type { BootstrapOrganizationInput } from "@darts-platform/schemas";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;

export class OrganizationAlreadyExistsError extends Error {
  public readonly count: number;

  public constructor(count: number) {
    super(
      `Refusing to bootstrap: the database already contains ${String(count)} organization(s).`,
    );
    this.name = "OrganizationAlreadyExistsError";
    this.count = count;
  }
}

export interface BootstrapOrganizationResult {
  readonly organizationId: string;
  readonly name: string;
  readonly slug: string;
  readonly invitationId: string;
  readonly email: string;
  readonly role: "ADMIN";
  readonly expiresAt: Date;
}

export async function assertNoExistingOrganization(
  database: Database,
): Promise<void> {
  const [row] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(organizations);

  const count = row?.count ?? 0;

  if (count > 0) {
    throw new OrganizationAlreadyExistsError(count);
  }
}

export async function createBootstrapOrganization(
  database: Database,
  input: BootstrapOrganizationInput,
): Promise<BootstrapOrganizationResult> {
  return database.transaction(async (transaction) => {
    const [organization] = await transaction
      .insert(organizations)
      .values({
        name: input.name,
        slug: input.slug,
        timezone: input.timezone,
        locale: input.locale,
      })
      .returning();

    if (organization === undefined) {
      throw new Error("Organization insert did not return a row.");
    }

    const [invitation] = await transaction
      .insert(organizationInvitations)
      .values({
        organizationId: organization.id,
        email: input.email,
        role: "ADMIN",
        invitedByUserId: null,
        expiresAt: new Date(
          Date.now() + input.expiresInDays * MILLISECONDS_PER_DAY,
        ),
      })
      .returning();

    if (invitation === undefined) {
      throw new Error("Invitation insert did not return a row.");
    }

    await transaction.insert(auditEvents).values({
      organizationId: organization.id,
      actorUserId: null,
      action: "ORGANIZATION_BOOTSTRAPPED",
      entityType: "Organization",
      entityId: organization.id,
      newValue: {
        name: organization.name,
        slug: organization.slug,
        invitedEmail: invitation.email,
        invitedRole: invitation.role,
      },
      correlationId: randomUUID(),
    });

    return {
      organizationId: organization.id,
      name: organization.name,
      slug: organization.slug,
      invitationId: invitation.id,
      email: invitation.email,
      role: "ADMIN",
      expiresAt: invitation.expiresAt,
    };
  });
}
```

- [ ] **Step 6: Tests laufen lassen und Erfolg bestätigen**

```bash
pnpm --filter @darts-platform/api test -- bootstrap-organization
```

Erwartet: PASS, drei Tests.

- [ ] **Step 7: Commit**

```bash
git add packages/schemas/src apps/api/src/cli
git commit -m "feat: add bootstrap organization service"
```

---

## Task 3: CLI-Entrypoint

**Files:**
- Create: `apps/api/src/cli/bootstrap-organization.ts`

**Interfaces:**
- Consumes: `assertNoExistingOrganization`, `createBootstrapOrganization`, `OrganizationAlreadyExistsError` aus Task 2; `bootstrapOrganizationSchema` aus `@darts-platform/schemas`; `parseApplicationEnvironment` aus `@darts-platform/config`; `createDatabaseConnection` aus `@darts-platform/database`.
- Produces: ausführbare Datei `apps/api/dist/cli/bootstrap-organization.js`. `tsconfig.build.json` schliesst nur `*.spec.ts` und `*.test.ts` aus, der Entrypoint wird also ohne weitere Konfiguration mitgebaut.

Dieser Entrypoint erhält keinen eigenen Test. Er enthält keine Logik ausser Argumentübergabe und Ausgabe; die Logik ist in Task 2 abgedeckt. Verifiziert wird er in Step 3 durch einen echten Lauf gegen die lokale Datenbank.

- [ ] **Step 1: Entrypoint schreiben**

Neue Datei `apps/api/src/cli/bootstrap-organization.ts`:

```ts
import { parseArgs } from "node:util";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { createDatabaseConnection } from "@darts-platform/database";
import { bootstrapOrganizationSchema } from "@darts-platform/schemas";

import {
  assertNoExistingOrganization,
  createBootstrapOrganization,
  OrganizationAlreadyExistsError,
} from "./bootstrap-organization.service.js";

const USAGE = `Usage: node apps/api/dist/cli/bootstrap-organization.js \\
  --name "Dart Ost" --slug "dart-ost" --email "admin@example.test" \\
  [--timezone Europe/Zurich] [--locale de-CH] [--expires-in-days 7]`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      slug: { type: "string" },
      email: { type: "string" },
      timezone: { type: "string" },
      locale: { type: "string" },
      "expires-in-days": { type: "string" },
    },
    strict: true,
  });

  const expiresInDays = values["expires-in-days"];

  const parsed = bootstrapOrganizationSchema.safeParse({
    name: values.name,
    slug: values.slug,
    email: values.email,
    ...(values.timezone === undefined ? {} : { timezone: values.timezone }),
    ...(values.locale === undefined ? {} : { locale: values.locale }),
    ...(expiresInDays === undefined ? {} : { expiresInDays }),
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || "input"}: ${issue.message}`)
      .join("\n");
    process.stderr.write(`Ungueltige Eingabe:\n${issues}\n\n${USAGE}\n`);
    return 1;
  }

  const environment = parseApplicationEnvironment(process.env);
  const connection = createDatabaseConnection(environment.DATABASE_URL);

  try {
    await assertNoExistingOrganization(connection.database);
    const result = await createBootstrapOrganization(
      connection.database,
      parsed.data,
    );

    process.stdout.write(
      [
        "Bootstrap erfolgreich.",
        `  Organisation: ${result.name} (${result.slug})`,
        `  Organisation-ID: ${result.organizationId}`,
        `  Eingeladen: ${result.email} als ${result.role}`,
        `  Einladung gueltig bis: ${result.expiresAt.toISOString()}`,
        "",
        "Naechster Schritt: Mit genau dieser Adresse unter",
        "https://app.dartbase.ch registrieren, anmelden und die Einladung annehmen.",
        "",
      ].join("\n"),
    );
    return 0;
  } catch (error) {
    if (error instanceof OrganizationAlreadyExistsError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }

    process.stderr.write(
      `Bootstrap fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  } finally {
    await connection.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(
      `Bootstrap abgebrochen: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
```

- [ ] **Step 2: Bauen**

```bash
pnpm build:api
```

Erwartet: `apps/api/dist/cli/bootstrap-organization.js` existiert.

```bash
ls apps/api/dist/cli/
```

- [ ] **Step 3: Verweigerungspfad gegen die lokale Datenbank prüfen**

Die lokale Datenbank enthält aus den Tests bereits Organisationen. Genau das soll der Befehl erkennen.

```bash
node apps/api/dist/cli/bootstrap-organization.js \
  --name "Dart Ost" --slug "dart-ost" --email "admin@example.test"
echo "exit=$?"
```

Erwartet: Meldung `Refusing to bootstrap: the database already contains N organization(s).` und `exit=1`.

Ist die lokale Datenbank leer und der Befehl läuft durch, ist das ebenfalls korrekt. Dann die erzeugte Organisation wieder entfernen und den Lauf wiederholen, um die Verweigerung zu sehen:

```bash
docker compose exec -T postgres psql -U darts -d darts -c "delete from organizations where slug = 'dart-ost';"
```

- [ ] **Step 4: Fehlerpfad bei ungültigem Slug prüfen**

```bash
node apps/api/dist/cli/bootstrap-organization.js \
  --name "Dart Ost" --slug "dartost.ch" --email "admin@example.test"
echo "exit=$?"
```

Erwartet: `slug: Invalid string: must match pattern ...` (Wortlaut kann abweichen) und `exit=1`. Damit ist belegt, dass die Validierung greift, bevor eine Verbindung geöffnet wird.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/cli/bootstrap-organization.ts
git commit -m "feat: add bootstrap organization cli entrypoint"
```

---

## Task 4: Railway-Konfiguration

**Files:**
- Modify: `package.json`
- Modify: `.railway/railway.ts`

**Interfaces:**
- Consumes: `defineRailway`, `github`, `group`, `postgres`, `project`, `redis`, `service` aus `railway/iac`.
- Produces: eine Konfiguration mit fünf Ressourcen, die `railway config plan` fehlerfrei rendert.

Zwei Punkte, die beim Schreiben leicht falsch laufen:

Die Domains werden **ohne** Portangabe deklariert. `apps/api/src/main.ts:41` bindet an `PORT ?? API_PORT`, und Railway setzt `PORT` selbst. Ein festes `port: 3001` würde am tatsächlichen Listen-Port vorbeirouten.

Der Worker braucht **alle** Variablen aus `applicationEnvironmentSchema`, nicht nur `DATABASE_URL`. `apps/worker/src/main.ts:6` ruft `parseApplicationEnvironment(process.env)` auf, und das Schema verlangt `REDIS_URL`, `BETTER_AUTH_SECRET` und `BETTER_AUTH_URL` als Pflichtfelder — auch wenn der Worker sie nie liest. Fehlen sie, wirft der Container beim Start einen `EnvironmentValidationError`.

- [ ] **Step 1: `railway` als devDependency ergänzen**

```bash
pnpm add -D -w railway
```

Erwartet: Eintrag unter `devDependencies` in der Wurzel-`package.json` und ein aktualisiertes Lockfile.

- [ ] **Step 2: Konfiguration schreiben**

`.railway/railway.ts` vollständig ersetzen durch:

```ts
import {
  defineRailway,
  github,
  group,
  postgres,
  project,
  redis,
  service,
} from "railway/iac";

export default defineRailway((context) => {
  const database = postgres("postgres");
  const cache = redis("redis");
  const source = github("BitWhatElse/darts-platform", { branch: "main" });

  const api = service("api", {
    source,
    healthcheck: "/api/v1/health",
    healthcheckTimeout: 120,
    replicas: 1,
    domains: ["api.dartbase.ch"],
    env: {
      NODE_ENV: "production",
      LOG_LEVEL: "log",
      RAILWAY_DOCKERFILE_PATH: "/Dockerfile.api",
      DATABASE_URL: database.env.DATABASE_URL,
      REDIS_URL: cache.env.REDIS_URL,
      BETTER_AUTH_SECRET: context.shared.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: context.shared.BETTER_AUTH_URL,
      WEB_ORIGIN: context.shared.WEB_ORIGIN,
    },
  });

  const web = service("web", {
    source,
    healthcheck: "/",
    healthcheckTimeout: 120,
    replicas: 1,
    domains: ["app.dartbase.ch"],
    env: {
      NODE_ENV: "production",
      RAILWAY_DOCKERFILE_PATH: "/Dockerfile.web",
      NEXT_PUBLIC_API_URL: context.shared.NEXT_PUBLIC_API_URL,
    },
  });

  const worker = service("worker", {
    source,
    replicas: 1,
    env: {
      NODE_ENV: "production",
      LOG_LEVEL: "log",
      RAILWAY_DOCKERFILE_PATH: "/Dockerfile.worker",
      DATABASE_URL: database.env.DATABASE_URL,
      REDIS_URL: cache.env.REDIS_URL,
      BETTER_AUTH_SECRET: context.shared.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: context.shared.BETTER_AUTH_URL,
    },
  });

  return project("darts-platform", {
    resources: [
      group("Applications", [web, api, worker]),
      group("Data", [database, cache]),
    ],
  });
});
```

- [ ] **Step 3: Typprüfung**

```bash
pnpm typecheck
```

Erwartet: grün. Meldet TypeScript, dass `domains` an `service()` unbekannt ist, weicht die installierte Version der `railway`-Typen von der Referenz ab — dann `pnpm why railway` prüfen und die Optionsnamen an den mitgelieferten Typen ausrichten, statt sie zu erraten.

- [ ] **Step 4: Lint**

```bash
pnpm lint
```

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml .railway/railway.ts
git commit -m "feat: add worker service and custom domains to railway config"
```

---

## Task 5: ADR und Runbook

**Files:**
- Create: `docs/adr/0011-railway-production-deployment.md`
- Modify: `infrastructure/railway.md`
- Modify: `.railway/README.md`

- [ ] **Step 1: ADR schreiben**

Neue Datei `docs/adr/0011-railway-production-deployment.md`. Aufbau und Ton den bestehenden ADRs angleichen — zuerst `docs/adr/0003-phase-0-production-operations.md` lesen und dessen Gliederung übernehmen. Inhaltlich müssen diese vier Entscheide samt Begründung enthalten sein:

1. **Eigene Domain statt Railway-Subdomains.** `up.railway.app` steht auf der Public Suffix List. Zwei Railway-Subdomains sind damit verschiedene Sites, und die `SameSite=Lax`-Sessioncookies von Better Auth würden bei API-Anfragen nicht mitgesendet. `app.dartbase.ch` und `api.dartbase.ch` teilen sich die registrierbare Domain und lösen das ohne Codeänderung. Die Alternative `SameSite=None` wurde verworfen, weil Safari Third-Party-Cookies blockiert und im Dartraum iPhones zu erwarten sind.
2. **Eine API-Replik.** `scripts/start-api.mjs` migriert vor jedem Start. Mehrere Repliken würden gleichzeitig migrieren. Skalierung setzt einen eigenständigen Migrationsjob voraus.
3. **Bootstrap als expliziter Befehl.** Der Erstzugang entsteht durch einen einmalig ausgeführten CLI-Befehl mit Audit-Eintrag, nicht durch Startlogik. Startlogik bliebe dauerhaft im Produktionspfad und wäre eine stehende Umgehung der Einladungspflicht aus ADR 0010.
4. **`invited_by_user_id` nullable.** NULL modelliert eine vom System erzeugte Einladung. Ein Pseudo-Benutzer als Einlader wurde verworfen, weil er dauerhaft in `users` stünde.

- [ ] **Step 2: Runbook aktualisieren**

In `infrastructure/railway.md`:

- Der Abschnitt «Zielarchitektur» nennt vier Ressourcen und den Worker als noch zu ergänzen. Auf fünf Ressourcen umschreiben, den Satz über den fehlenden Worker streichen.
- Im Abschnitt «Erstinstallation» die Beispielwerte durch die echten ersetzen: `BETTER_AUTH_URL` = `https://api.dartbase.ch`, `WEB_ORIGIN` = `https://app.dartbase.ch`, `NEXT_PUBLIC_API_URL` = `https://api.dartbase.ch/api/v1`.
- Im Abschnitt «Smoke-Test nach Deployment» den Absatz ersetzen, der besagt, das Repository enthalte noch keinen Erstbenutzer-Befehl. Neuer Inhalt: der Bootstrap-Befehl, sein Aufruf über `railway ssh --service api`, und dass er den zweiten Lauf verweigert.
- Die `curl`-Beispiele auf die echten Hosts umstellen.
- Einen Abschnitt «Backups» ergänzen: PITR im Backups-Tab des Postgres-Service aktivieren, Restore-Fenster rund vier Wochen, Restore erzeugt einen neuen Postgres-Service.

- [ ] **Step 3: `.railway/README.md` aktualisieren**

Die Aufzählung der Ressourcen um den Worker ergänzen und den Verweis auf die Shared Variables beibehalten.

- [ ] **Step 4: Commit**

```bash
git add docs/adr/0011-railway-production-deployment.md infrastructure/railway.md .railway/README.md
git commit -m "docs: document railway production deployment decisions"
```

---

## Task 6: Vollständige Verifikation

**Files:** keine

- [ ] **Step 1: Gesamte Prüfkette**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Erwartet: alle vier grün. Fehlschläge werden behoben, nicht übergangen.

- [ ] **Step 2: Änderungsumfang durchsehen**

```bash
git log --oneline main..HEAD
git diff main...HEAD --stat
```

Erwartet: die Commits aus Task 1 bis 5 und keine Datei, die nicht in der File Structure oben steht.

- [ ] **Step 3: Auf keine private Adresse im Verlauf prüfen**

```bash
git diff main...HEAD | grep -i "gmail\|gietz" || echo "sauber"
```

Erwartet: `sauber`.

- [ ] **Step 4: Push und Pull Request**

```bash
git push -u origin feature/railway-production-deployment
```

Danach einen Pull Request mit Problem, Lösung, Architektur-Auswirkung, DB-Migration, Tests und Security-Auswirkungen gemäss AGENTS.md §23 eröffnen. Der CI-Workflow muss grün sein, bevor gemergt wird — Railway baut auf Push nach `main`.

---

## Task 7: Inbetriebnahme (manuell, nach dem Merge)

Diese Schritte laufen gegen die echte Infrastruktur und sind nicht automatisierbar. Sie werden von einem Menschen ausgeführt und einzeln bestätigt. Reihenfolge einhalten.

- [ ] **Step 1: Railway-Projekt verknüpfen**

```bash
railway login
railway link
```

Environment `production` wählen.

- [ ] **Step 2: Shared Variables anlegen**

Im Railway-Dashboard unter dem Environment `production`, nicht am einzelnen Service. Die IaC verwaltet Shared Variables nicht; sie müssen vor dem ersten `plan` existieren.

```text
BETTER_AUTH_SECRET   Ausgabe von: openssl rand -base64 32
BETTER_AUTH_URL      https://api.dartbase.ch
WEB_ORIGIN           https://app.dartbase.ch
NEXT_PUBLIC_API_URL  https://api.dartbase.ch/api/v1
```

`BETTER_AUTH_SECRET` niemals ins Repository, in eine Commit-Nachricht oder in ein Ticket. Rotation macht alle Sessions ungültig.

- [ ] **Step 3: Plan prüfen**

```bash
railway config plan
```

Erwartet: fünf Ressourcen, zwei Custom Domains, keine Löschung bestehender Ressourcen. Zeigt der Plan Löschungen, nicht anwenden, sondern Ursache klären.

- [ ] **Step 4: Anwenden**

```bash
railway config apply
```

- [ ] **Step 5: DNS bei cyon setzen**

```bash
railway domain status api.dartbase.ch
railway domain status app.dartbase.ch
```

Die genannten CNAME- und TXT-Einträge im cyon-DNS-Editor für `dartbase.ch` anlegen. Anschliessend warten, bis Railway die Domains als verifiziert und die Zertifikate als ausgestellt meldet. Das kann bis zu einer Stunde dauern.

- [ ] **Step 6: API-Health prüfen**

```bash
curl --fail https://api.dartbase.ch/api/v1/health
```

Erwartet: HTTP 200. Bei 503 sind Postgres oder Redis nicht erreichbar. Startet der Container gar nicht, im Railway-Log nach `event = deployment_start_failed` suchen — das deutet auf eine fehlgeschlagene Migration.

- [ ] **Step 7: API-URL im Browser-Bundle verifizieren**

Der wichtigste Einzelschritt. Railway reicht Service-Variablen nicht automatisch als Docker-Build-Args durch; sie müssen im Dockerfile per `ARG` deklariert sein. `Dockerfile.web` tut das im Build-Stage, aber ob der Wert tatsächlich ankommt, zeigt erst das gebaute Artefakt.

```bash
curl -s https://app.dartbase.ch/ | grep -o "https://api.dartbase.ch" | head -1
```

Erwartet: `https://api.dartbase.ch`

Zur Gegenprobe:

```bash
curl -s https://app.dartbase.ch/ | grep -c "localhost:3001"
```

Erwartet: `0`

Findet die Gegenprobe Treffer, ist der Build mit dem ARG-Standardwert gelaufen. Dann `NEXT_PUBLIC_API_URL` als Build-Arg am Web-Service setzen und neu bauen. Ohne diesen Fix funktioniert im Browser keine einzige API-Anfrage, obwohl die Seite lädt und der Healthcheck grün ist.

- [ ] **Step 8: Bootstrap ausführen**

```bash
railway ssh --service api
```

Und in der Sitzung, mit der eigenen Adresse anstelle des Platzhalters:

```bash
node apps/api/dist/cli/bootstrap-organization.js \
  --name "Dart Ost" --slug "dart-ost" --email "<eigene-adresse>"
```

Erwartet: `Bootstrap erfolgreich.` mit Organisation-ID und Ablaufdatum. Ablaufdatum notieren — die Registrierung muss davor erfolgen.

- [ ] **Step 9: Erstzugang herstellen**

Auf `https://app.dartbase.ch`:

1. Mit exakt der eingeladenen Adresse registrieren. Passwort mindestens 10 Zeichen.
2. Anmelden.
3. Die offene Einladung annehmen.
4. Prüfen, dass die Organisation «Dart Ost» mit Rolle `ADMIN` erscheint.

Wird die Registrierung mit `Registration requires a valid invitation.` abgewiesen, weicht die eingegebene Adresse von der eingeladenen ab oder die Einladung ist abgelaufen.

- [ ] **Step 10: Smoke-Test**

Nach `infrastructure/railway.md`: Spieler anlegen, bearbeiten und archivieren; zweiten Benutzer einladen und dessen Einladung annehmen; prüfen, dass ein Viewer keinen Link «Turnierleitung» erhält; tenant-fremden Zugriff prüfen, erwartet HTTP 403.

Zusätzlich Realtime prüfen, weil das über eine andere Verbindung läuft als die übrigen Anfragen: Zwei Geräte auf dieselbe Live-Ansicht, auf einem eine Änderung auslösen, auf dem anderen muss sie ohne Neuladen erscheinen. Bleibt sie aus, ist die Socket.IO-Verbindung das Problem, nicht die API — im Browser-Log nach `connect_error` sehen.

- [ ] **Step 11: PITR aktivieren**

Im Railway-Dashboard, Postgres-Service, Tab «Backups», «Enable PITR» bestätigen. Railway legt einen Bucket an, setzt `WAL_ARCHIVE_*`-Variablen und deployt den Service neu. Danach erneut `curl --fail https://api.dartbase.ch/api/v1/health` prüfen.

- [ ] **Step 12: Restore einmal durchspielen**

Einen Zeitpunkt wenige Minuten in der Vergangenheit wählen und wiederherstellen. Railway stellt dabei einen **neuen** Postgres-Service bereit; die produktive Datenbank bleibt unberührt. Im wiederhergestellten Service prüfen, dass die Organisation «Dart Ost» vorhanden ist. Danach den Test-Service wieder löschen.

Ein Backup, das nie zurückgespielt wurde, ist kein Backup. Dieser Schritt ist der Grund, warum «Betriebsabsicherung» im Umfang steht.

- [ ] **Step 13: Rollback einmal auslösen**

Im Railway-Dashboard beim Web-Service ein früheres Deployment redeployen, warten, bis es läuft, dann wieder auf den aktuellen Stand zurück. Damit ist der Weg im Ernstfall bekannt und nicht erst am Turnierabend zu suchen.

- [ ] **Step 14: Logfilter vorbereiten**

Im Railway-Log-Explorer diese Abfragen einmal ausführen und als Lesezeichen ablegen:

```text
event = http_request_completed AND statusCode >= 500
event = deployment_start_failed
event = api_started
```

---

## Offene Punkte für später

Nicht Teil dieses Plans, aber bewusst festgehalten:

- Der Apex `dartbase.ch` bleibt unbelegt. Wer ihn eintippt, landet nicht auf der Anwendung. Ob cyon ALIAS, ANAME oder eine URL-Weiterleitung anbietet, ist ungeprüft.
- Kein E-Mail-Versand für Einladungen. Sie werden mündlich oder manuell weitergegeben.
- Kein staging-Environment.
- Kein eigenständiger Migrationsjob; die API bleibt bei einer Replik.
- Keine Generalprobe mit vollständigem Testturnier vor dem Termin. Die Offline-Queue aus Phase 5 ist im Smoke-Test nicht abgedeckt.
