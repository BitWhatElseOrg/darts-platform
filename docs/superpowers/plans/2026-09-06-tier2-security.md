# Tier 2 — Teil B: Security und Autorisierung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die fünf Important-Befunde I-5, I-6, I-3, I-1a und I-4 aus dem Sicherheitsaudit werden mit begrenztem, getestetem Eingriff behoben: Security Headers, Rate Limiting, ein Freigabe-Flag für die Mandantenanlage, eine öffentliche Turnier-Projektion ohne Betriebsinterna und ein Endpunkt, der Rollen ändert und Zugriff entzieht.

**Architecture:** Von aussen nach innen. Zuerst zwei Querschnitts-Plugins am Fastify-Rand (Header, Rate Limit) samt einem wiederverwendbaren Test-Harness, das die echte Nest-Anwendung mit `inject()` befragt — danach ändert sich an keiner Domänenschicht etwas. Dann die drei fachlichen Befunde: ein Zod-validiertes Umgebungs-Flag vor `POST /organizations`, das Trimmen der öffentlichen Turnier-Projektion in `packages/schemas` plus Service, und zuletzt der neue Mitgliedschafts-Endpunkt mit Permission, Transaktion und Audit. Business-Regeln bleiben in Service und Repository; Controller bleiben dünn.

**Tech Stack:** TypeScript strict, pnpm, Turborepo, NestJS, Fastify, `@fastify/helmet`, `@fastify/rate-limit`, Better Auth, Drizzle ORM, PostgreSQL, Redis (node-redis), Zod, Next.js, React, Vitest, Playwright.

**Spec:** `/tmp/claude-1000/-home-sut-projects-darts-platform/70688d40-4244-406a-b67f-18e37ab90b1a/scratchpad/audit/B-security-tenancy.md` — Auditbericht „B — Security, Autorisierung, Multi-Tenancy" gegen `main@d2b06e6`, mit Autorisierungs-Matrix, Tenant-Filter-Tabelle und den Befunden I-1 … I-7 samt `file:line`, Szenario und Fix. Ergänzend verbindlich: `AGENTS.md` §4, §13, §14, §15; `ARCHITECTURE.md` §6, §7, §18, §29, §30; ADR `docs/adr/0002-identity-tenancy.md`, `docs/adr/0010-invite-only-registration.md`, `docs/adr/0012-production-owner-bootstrap.md`.

## Neue Abhängigkeiten

Beide sind eine bewusste Entscheidung eines Menschen und werden nur mit dessen Zustimmung installiert. Beide liegen in `apps/api/package.json` unter `dependencies`.

| Paket | Version | Grund | Kompatibilität |
| --- | --- | --- | --- |
| `@fastify/helmet` | `^13.1.1` | I-5: setzt HSTS, `nosniff`, Referrer-Policy und Cross-Origin-Resource-Policy an einer Stelle statt in handgeschriebenen Hooks. Zieht `helmet@^8` als eigene Abhängigkeit. | Baut auf `fastify-plugin@^6`, also Fastify 5. Installiert ist Fastify `5.12.1`. |
| `@fastify/rate-limit` | `^11.2.0` | I-6: bremst die Einladungs- und die öffentlichen Routen, liefert das einheitliche Fehlerformat über `errorResponseBuilder`. | Baut ebenfalls auf `fastify-plugin@^6`, also Fastify 5. Keine Peer-Dependencies — `.npmrc` hat `strict-peer-dependencies=true`. |

Beide Pakete sind CommonJS (`"type": "commonjs"`, `export =`). Unter `moduleResolution: NodeNext` und `esModuleInterop: true` ist der Default-Import (`import helmet from "@fastify/helmet";`) korrekt.

**Ausdrücklich nicht aufgenommen:** `ioredis`. `@fastify/rate-limit` kann seinen Zähler nur über einen ioredis-kompatiblen Client teilen; das Projekt nutzt `node-redis`. Der Fastify-Zähler bleibt deshalb prozesslokal (siehe Task 4, „Bewusste Grenze"). Der verteilte Zähler sitzt dort, wo der Audit ihn verlangt: bei Better Auth auf `/sign-in/email` und `/sign-up/email`, über eine Redis-gestützte `customStorage` auf dem vorhandenen `RedisService` (Task 3).

## Global Constraints

- `strict: true`; kein `any`, kein `as any`. `unknown` statt `any`, discriminated unions, exhaustive `switch`.
- Kommentare und Oberflächentexte auf Deutsch (Schweizer Rechtschreibung, kein ß), Code-Bezeichner auf Englisch.
- Server entscheidet: jede geschäftliche Mutation läuft durch `OrganizationAccessService.requirePermission`, jede tenant-bezogene Query nennt `organizationId` explizit, jeder `@Body()` läuft durch `parseBody(<zodSchema>, body)`, jeder `@Param` durch `ParseUUIDPipe`.
- Fehlerformat bleibt `{ "error": { "code", "message", "correlationId" } }`. Keine Stacktraces an Clients. Eigene Codes werden als Objekt an die `HttpException` übergeben (`new ForbiddenException({ code, message })`) — `api-exception.filter.ts` liest `code` daraus.
- Kritische Aktionen werden auditiert; der Audit-Eintrag liegt in **derselben** Transaktion wie die Domänenmutation. Muster: `apps/api/src/organizations/organizations.repository.ts`, `createInvitation`.
- Keine Secrets im Quellcode. Jede neue Umgebungsvariable steht in `packages/config/src/environment.ts` (Zod, fail-fast), in `.env.example` **und** in der Variablen-Tabelle von `infrastructure/railway.md`.
- Conventional Commits mit deutschem Betreff, kleine Commits. Commit-Nachrichten tragen **keinen** `Co-Authored-By`-Trailer (Repo-Regel in `CLAUDE.md`).
- Integrationstests brauchen laufende Infrastruktur: `pnpm infra:up`. Einzelne API-Testdatei: aus `apps/api` heraus `npx dotenv -e ../../.env -- npx vitest run <pfad>` — `pnpm --filter … test -- <pfad>` filtert nicht.
- Jeder Task endet mit `pnpm lint`, `pnpm typecheck`, `pnpm test` (grün) und mindestens einem Commit. Am Planende zusätzlich `NODE_ENV=production pnpm build` und `pnpm test:e2e` (ein Worker).

## Nicht in diesem Plan

- **I-2** (Realtime-Kanäle unauthentifiziert, Räume auf internen IDs) — Tier 3, gemeinsam mit `public_id`.
- **I-7** (einspaltige Fremdschlüssel, keine Mandanten-Kohärenz in der Datenbank) — Tier 3.
- **I-1 Teil b** (`tournaments.public_id` und ein Sichtbarkeits-Flag) — Tier 3, Programm. Dieser Plan trimmt nur die Nutzlast der bestehenden öffentlichen Route.
- **M-1** (zwei `update(legs)` ohne Tenant-Prädikat) — passt zu keinem Task hier, bleibt liegen.
- **M-2, M-3, M-4, M-5, M-7** — nicht Tier 2. M-7 (`organization:manage_roles` ohne Prüfstelle) löst sich als Nebenwirkung von Task 7 auf, weil die Permission dort erstmals geprüft wird.
- **UI für I-4.** Task 7 baut ausschliesslich die API. Es gibt in diesem Plan **keine** Mitglieder-Oberfläche, keine Rollen-Auswahl, keinen Deaktivieren-Knopf. Die Verwaltungsoberfläche gehört zu „Organization Settings" (ROADMAP Phase 7) und ist bewusst nicht Teil dieses Sicherheits-Fixes.

**Mitgenommene Minor:** M-6 (`REDIS_URL` verbietet `rediss://`) wird in Task 3 miterledigt, weil dort ohnehin an `packages/config/src/environment.ts` und am Redis-Pfad gearbeitet wird.

## Nicht mehr zutreffend

Keiner. Alle fünf Befunde wurden vor dem Schreiben dieses Plans gegen den Arbeitsstand auf `fix/audit-tier2` nachgeprüft (der Audit lief gegen `main@d2b06e6`, Tier 1 aus PR #14 ist eingeflossen):

- I-5: `apps/api/src/main.ts` registriert weiterhin nur `enableCors`, Filter und Interceptor; `apps/web/next.config.ts` hat weiterhin keine `headers()`-Funktion.
- I-6: `apps/api/src/auth/auth.factory.ts` hat weiterhin keinen `rateLimit`-Block; weder `@fastify/rate-limit` noch `@nestjs/throttler` sind installiert.
- I-3: `OrganizationsService.create` prüft weiterhin keine Permission.
- I-1a: `publicTournamentDashboardSchema` erweitert weiterhin das volle `tournamentDashboardSchema` und trimmt nur `participants`.
- I-4: Der Organisations-Controller kennt weiterhin nur `list`, `create`, `invite`; `organization:manage_roles` hat weiterhin null Prüfstellen.

## File Structure

**Neu:**

| Datei | Verantwortung |
| --- | --- |
| `apps/api/src/common/security-headers.ts` | Registriert `@fastify/helmet` mit der API-Policy |
| `apps/api/src/common/rate-limit.ts` | Registriert `@fastify/rate-limit`, entscheidet die Obergrenze je Pfad, baut den 429-Fehlerkörper |
| `apps/api/src/common/security-headers.integration.spec.ts` | Prüft die Header auf `GET /api/v1/health` |
| `apps/api/src/common/rate-limit.integration.spec.ts` | Prüft 429 im einheitlichen Fehlerformat |
| `apps/api/src/testing/api-harness.ts` | Baut die echte Nest-Anwendung mit überschriebener Umgebung für `inject()`-Tests |
| `apps/api/src/auth/auth-rate-limit-storage.ts` | Redis-gestützte `customStorage` für Better Auth, fail-open mit Protokoll |
| `apps/api/src/auth/auth-rate-limit-storage.integration.spec.ts` | Prüft Zählen, Sperren und `retryAfter` gegen echtes Redis |
| `apps/api/src/organizations/organizations.integration.spec.ts` | Prüft `POST /organizations` in beiden Flag-Stellungen |
| `apps/api/src/organizations/memberships.integration.spec.ts` | Prüft Rollenwechsel, Deaktivierung, Owner-Schutz, fremde Organisation, `VIEWER` |
| `apps/web/tests/security-headers.spec.ts` | Playwright-Prüfung der Response-Header auf `/` |

**Geändert:**

| Datei | Änderung |
| --- | --- |
| `apps/api/package.json` | `@fastify/helmet`, `@fastify/rate-limit` |
| `apps/api/src/main.ts` | Registriert Header- und Rate-Limit-Plugin vor `listen` |
| `apps/api/src/common/api-exception.filter.ts` | `429 → RATE_LIMIT_EXCEEDED` in der Code-Tabelle |
| `apps/api/src/redis/redis.service.ts` | `consumeRateLimit` — atomarer Zähler mit Fenster-TTL |
| `apps/api/src/auth/auth.factory.ts` | `rateLimit`-Block mit `customRules` und optionaler `customStorage` |
| `apps/api/src/auth/auth.service.ts` | Reicht die Redis-Storage an `createAuth` |
| `apps/api/src/organizations/organizations.service.ts` | Flag-Prüfung vor `create`, neue `updateMembership` |
| `apps/api/src/organizations/organizations.controller.ts` | `PATCH :organizationId/members/:userId` |
| `apps/api/src/organizations/organizations.repository.ts` | `updateMembership` mit Owner-Schutz und Audit in einer Transaktion |
| `apps/api/src/tournaments/tournaments.service.ts` | Öffentliche Projektion baut die Felder explizit |
| `packages/config/src/environment.ts` | `ALLOW_SELF_SERVICE_ORGANIZATIONS`, drei Rate-Limit-Werte, `rediss://` erlaubt |
| `packages/config/src/environment.spec.ts` | Tests für Flag, Rate-Limit-Vorgaben und `rediss://` |
| `packages/domain/src/membership.ts` | `isMembershipStatus` |
| `packages/domain/src/index.ts` | Export von `isMembershipStatus` |
| `packages/schemas/src/organization.ts` | `membershipStatusSchema`, `assignableMembershipStatusSchema`, `updateMembershipSchema`, `organizationMemberSchema` |
| `packages/schemas/src/organization.spec.ts` | Tests dazu |
| `packages/schemas/src/tournament.ts` | `publicBoardSlotSchema`, `publicQueueEntrySchema`, getrimmtes `publicTournamentDashboardSchema` |
| `packages/schemas/src/tournament.spec.ts` | Test, dass die öffentliche Form die drei Felder nicht kennt |
| `packages/schemas/src/index.ts` | Exporte der neuen Schemas und Typen |
| `apps/web/next.config.ts` | `headers()` mit CSP-Report-Only, HSTS, `nosniff`, Referrer- und Permissions-Policy |
| `apps/web/playwright.config.ts` | Grosszügige Rate-Limit-Werte und `ALLOW_SELF_SERVICE_ORGANIZATIONS=true` für den API-Testserver |
| `apps/web/src/lib/api-client.ts` | Deutsche Meldungen für `RATE_LIMIT_EXCEEDED` und `SELF_SERVICE_ORGANIZATIONS_DISABLED` |
| `apps/web/src/components/tenant-dashboard.tsx` | Das Formular „Organisation erstellen" reagiert ehrlich auf die Sperre |
| `apps/web/src/components/live/live-tournament.tsx` | Nutzt `PublicBoardSlot` statt `BoardSlot` |
| `.env.example` | Vier neue Variablen mit Kommentar |
| `infrastructure/railway.md` | Vier neue Zeilen in der Variablen-Tabelle |

---

### Task 1: Security Headers der API (I-5, Teil 1)

**Files:**
- Modify: `apps/api/package.json`
- Create: `apps/api/src/common/security-headers.ts`
- Create: `apps/api/src/testing/api-harness.ts`
- Test: `apps/api/src/common/security-headers.integration.spec.ts`
- Modify: `apps/api/src/main.ts:34-47`

**Interfaces:**
- Consumes: `AppModule` (`apps/api/src/app.module.ts`), `APPLICATION_ENVIRONMENT` (`apps/api/src/config/environment.module.ts`), `ApiExceptionFilter` (`apps/api/src/common/api-exception.filter.ts`), `parseApplicationEnvironment` / `ApplicationEnvironment` (`@darts-platform/config`).
- Produces:
  - `registerSecurityHeaders(app: NestFastifyApplication): Promise<void>` aus `apps/api/src/common/security-headers.ts`
  - `createApiTestApplication(overrides?: Partial<ApplicationEnvironment>): Promise<NestFastifyApplication>` aus `apps/api/src/testing/api-harness.ts` — liefert eine initialisierte, **nicht** lauschende Anwendung; Aufrufer schliesst sie mit `await app.close()`.

- [ ] **Step 1: Die zwei Fastify-Plugins als Abhängigkeit eintragen**

Beide Pakete kommen jetzt hinein, damit Task 4 keine zweite Installationsrunde braucht. In `apps/api/package.json` unter `dependencies`, alphabetisch vor `@nestjs/common`:

```json
    "@darts-platform/tournament-engine": "workspace:*",
    "@fastify/helmet": "^13.1.1",
    "@fastify/rate-limit": "^11.2.0",
    "@nestjs/common": "^11.1.0",
```

Danach im Repo-Wurzelverzeichnis:

```bash
pnpm install
```

- [ ] **Step 2: Das Test-Harness schreiben**

`apps/api/src/testing/api-harness.ts`:

```ts
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";

import {
  parseApplicationEnvironment,
  type ApplicationEnvironment,
} from "@darts-platform/config";

import { AppModule } from "../app.module.js";
import { ApiExceptionFilter } from "../common/api-exception.filter.js";
import { registerSecurityHeaders } from "../common/security-headers.js";
import { APPLICATION_ENVIRONMENT } from "../config/environment.module.js";

/**
 * Baut die echte Anwendung — dieselben Module, derselbe globale Prefix,
 * derselbe Fehlerfilter, dieselben Fastify-Plugins wie in `main.ts` — und
 * gibt sie initialisiert, aber nicht lauschend zurueck. Tests befragen sie
 * ueber `app.inject(...)`. Ueber `overrides` laesst sich die Umgebung
 * punktuell veraendern, ohne `process.env` anzufassen.
 *
 * Aufrufer schliesst die Anwendung im `afterAll` mit `await app.close()`;
 * das faehrt Datenbank- und Redis-Verbindungen mit herunter.
 */
export async function createApiTestApplication(
  overrides: Partial<ApplicationEnvironment> = {},
): Promise<NestFastifyApplication> {
  const environment: ApplicationEnvironment = {
    ...parseApplicationEnvironment(process.env),
    ...overrides,
  };
  const moduleReference = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APPLICATION_ENVIRONMENT)
    .useValue(environment)
    .compile();
  const app = moduleReference.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
    { logger: false },
  );

  app.setGlobalPrefix("api/v1");
  await registerSecurityHeaders(app);
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
```

- [ ] **Step 3: Den fehlschlagenden Test schreiben**

`apps/api/src/common/security-headers.integration.spec.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

import { createApiTestApplication } from "../testing/api-harness.js";

let app: NestFastifyApplication;

beforeAll(async () => {
  app = await createApiTestApplication();
}, 60_000);

afterAll(async () => {
  await app.close();
});

describe("Security Headers", () => {
  it("liefert die Mindest-Header auf dem oeffentlichen Health-Endpunkt", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/health" });

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["strict-transport-security"]).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["cross-origin-resource-policy"]).toBe("same-site");
    expect(response.headers["x-frame-options"]).toBe("DENY");
  }, 30_000);

  it("nennt keine Server-Kennung", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/health" });

    expect(response.headers["x-powered-by"]).toBeUndefined();
  }, 30_000);
});
```

- [ ] **Step 4: Test laufen lassen und Fehlschlag bestätigen**

Voraussetzung: `pnpm infra:up` läuft (Health prüft Datenbank und Redis).

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/common/security-headers.integration.spec.ts`
Expected: FAIL — der erste Fall bricht mit `expected undefined to be 'nosniff'` ab, weil `registerSecurityHeaders` noch nicht existiert. Legt der Import bereits einen Modulfehler hin (`Cannot find module '../common/security-headers.js'`), ist das ebenfalls der erwartete rote Zustand.

- [ ] **Step 5: `registerSecurityHeaders` implementieren**

`apps/api/src/common/security-headers.ts`:

```ts
import helmet from "@fastify/helmet";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

/**
 * Sicherheits-Header der API (ARCHITECTURE §29). Die CORS-Allowlist aus
 * `main.ts` bleibt unangetastet; helmet ergaenzt sie, es ersetzt sie nicht.
 *
 * `same-site` bei der Cross-Origin-Resource-Policy passt zum Betrieb:
 * `dartbase.ch` und `api.dartbase.ch` teilen sich denselben registrierbaren
 * Namen, lokal teilen sich Web und API `localhost`. `cross-origin` waere die
 * Einladung an beliebige fremde Seiten, API-Antworten einzubetten.
 *
 * Die Content Security Policy ist hier hart: die API liefert ausschliesslich
 * JSON, es gibt kein Dokument, das Skripte oder Stile nachladen duerfte.
 */
export async function registerSecurityHeaders(
  app: NestFastifyApplication,
): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        "default-src": ["'none'"],
        "frame-ancestors": ["'none'"],
        "base-uri": ["'none'"],
        "form-action": ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "same-site" },
    // Ein Jahr, Subdomains eingeschlossen. `preload` bleibt aus: die Aufnahme
    // in die Browser-Liste ist praktisch unumkehrbar und gehoert nicht in
    // einen Sicherheits-Fix, sondern in eine bewusste Betriebsentscheidung.
    hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: false },
    referrerPolicy: { policy: "no-referrer" },
    xFrameOptions: { action: "deny" },
    // `xContentTypeOptions` (nosniff) ist in helmet standardmaessig aktiv und
    // wird hier nur der Vollstaendigkeit halber ausgeschrieben.
    xContentTypeOptions: true,
  });
}
```

- [ ] **Step 6: Test laufen lassen und Grün bestätigen**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/common/security-headers.integration.spec.ts`
Expected: PASS, 2/2.

- [ ] **Step 7: `main.ts` auf dieselbe Funktion umstellen**

In `apps/api/src/main.ts` den Import ergänzen:

```ts
import { ApiLoggingInterceptor } from "./common/api-logging.interceptor.js";
import { registerSecurityHeaders } from "./common/security-headers.js";
import { StructuredLogger } from "./common/structured-logger.js";
```

und die Registrierung direkt nach `app.enableCors({ … });` einsetzen:

```ts
  await registerSecurityHeaders(app);
  app.useGlobalFilters(new ApiExceptionFilter());
```

- [ ] **Step 8: Vollständige Prüfung**

```bash
pnpm lint
pnpm typecheck
pnpm test
```
Expected: alle drei grün.

- [ ] **Step 9: Commit**

```bash
git add apps/api/package.json apps/api/src/common/security-headers.ts apps/api/src/common/security-headers.integration.spec.ts apps/api/src/testing/api-harness.ts apps/api/src/main.ts pnpm-lock.yaml
git commit -m "feat(api): Sicherheits-Header ueber @fastify/helmet setzen"
```

---

### Task 2: Security Headers der Weboberfläche (I-5, Teil 2)

**Files:**
- Modify: `apps/web/next.config.ts:1-24`
- Test: `apps/web/tests/security-headers.spec.ts`

**Interfaces:**
- Consumes: `process.env.NEXT_PUBLIC_API_URL` (bereits in `apps/web/playwright.config.ts` für den E2E-Webserver gesetzt).
- Produces: nichts, was ein späterer Task importiert.

**Entscheidung: `'unsafe-inline'` statt Nonce, und zunächst nur Report-Only.**
Next.js schreibt seinen Bootstrap und die Flight-Daten als Inline-`<script>`. Eine Nonce müsste pro Antwort neu erzeugt und in denselben Header geschrieben werden — `headers()` in `next.config.ts` ist aber statisch je Pfad und kennt die einzelne Anfrage nicht. Ein Nonce bedeutet also `middleware.ts`, also eine neue Laufzeitschicht auf **jeder** Anfrage — zu viel für eine Policy, die noch gar nicht erzwingt. Report-Only mit `script-src 'self' 'unsafe-inline'` liefert dagegen sofort verwertbare Meldungen für alles andere (`frame-ancestors`, `connect-src`, `img-src`, `object-src`, `form-action`), ohne dass Next.js' eigene Skripte den Kanal zufluten. Der Wechsel auf Nonce plus erzwingende CSP gehört zu Tier 3 und ist dann eine Änderung an genau einer Stelle.

- [ ] **Step 1: Den fehlschlagenden Playwright-Test schreiben**

`apps/web/tests/security-headers.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("die Weboberflaeche liefert die Sicherheits-Header", async ({ page }) => {
  const response = await page.goto("/");
  if (response === null) {
    throw new Error("Für die Startseite kam keine Antwort zurück.");
  }
  const headers = response.headers();

  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["strict-transport-security"]).toContain("max-age=31536000");
  expect(headers["permissions-policy"]).toContain("camera=()");

  const contentSecurityPolicy = headers["content-security-policy-report-only"];
  expect(contentSecurityPolicy).toBeDefined();
  expect(contentSecurityPolicy).toContain("frame-ancestors 'none'");
  expect(contentSecurityPolicy).toContain("object-src 'none'");
  // Erzwungen wird noch nicht: der harte Header darf nicht gesetzt sein.
  expect(headers["content-security-policy"]).toBeUndefined();
});
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `pnpm test:e2e -- security-headers`
Expected: FAIL mit `expected undefined to be 'nosniff'`.

- [ ] **Step 3: `headers()` in `next.config.ts` implementieren**

`apps/web/next.config.ts` vollständig:

```ts
import type { NextConfig } from "next";

const configuredWebOrigin = process.env.WEB_ORIGIN;
const configuredWebHostname =
  configuredWebOrigin === undefined
    ? undefined
    : new URL(configuredWebOrigin).hostname;

// Die Seite spricht ausser mit sich selbst nur mit der API — per HTTP und per
// WebSocket. Beide Ziele stammen aus derselben konfigurierten URL, damit die
// Policy in Development, Preview und Production automatisch stimmt.
const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL;
const apiOrigin =
  configuredApiUrl === undefined
    ? "http://localhost:3001"
    : new URL(configuredApiUrl).origin;
const websocketOrigin = apiOrigin.replace(/^http/u, "ws");

/**
 * Erste Stufe: nur berichten, nicht erzwingen. `script-src` erlaubt vorerst
 * `'unsafe-inline'`, weil Next.js seinen Bootstrap inline ausliefert und eine
 * Nonce eine eigene Middleware auf jeder Anfrage voraussetzen wuerde. Alle
 * uebrigen Direktiven sind bereits scharf gestellt und liefern damit ab
 * sofort brauchbare Verstoss-Meldungen.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // QR-Codes der Board-Ansicht sind `data:`-URLs.
  "img-src 'self' data:",
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigin} ${websocketOrigin}`,
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  allowedDevOrigins: [
    "host.docker.internal",
    ...(configuredWebHostname === undefined ? [] : [configuredWebHostname]),
  ],
  experimental: {
    useTypeScriptCli: false,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  reactStrictMode: true,
  transpilePackages: [
    "@darts-platform/config",
    "@darts-platform/schemas",
    "@darts-platform/ui",
  ],
};

export default nextConfig;
```

- [ ] **Step 4: Test laufen lassen und Grün bestätigen**

Run: `pnpm test:e2e -- security-headers`
Expected: PASS, 1/1.

Hinweis für die Konsole: im Entwicklungsmodus übersetzt Webpack mit `eval`, die Report-Only-Policy meldet deshalb lokal `script-src`-Verstösse. Das ist erwartet und genau der Grund, warum die Policy noch nicht erzwingt.

- [ ] **Step 5: Vollständige Prüfung**

```bash
pnpm lint
pnpm typecheck
pnpm test
```
Expected: alle drei grün.

- [ ] **Step 6: Commit**

```bash
git add apps/web/next.config.ts apps/web/tests/security-headers.spec.ts
git commit -m "feat(web): Sicherheits-Header und CSP im Report-Only-Modus setzen"
```

---

### Task 3: Rate Limiting der Anmeldung über Better Auth und Redis (I-6, Teil 1; M-6)

**Files:**
- Modify: `packages/config/src/environment.ts:24-36`
- Modify: `packages/config/src/environment.spec.ts`
- Modify: `apps/api/src/redis/redis.service.ts`
- Create: `apps/api/src/auth/auth-rate-limit-storage.ts`
- Test: `apps/api/src/auth/auth-rate-limit-storage.integration.spec.ts`
- Modify: `apps/api/src/auth/auth.factory.ts:24-94`
- Modify: `apps/api/src/auth/auth.service.ts`
- Modify: `.env.example`
- Modify: `infrastructure/railway.md:127-137`

**Interfaces:**
- Consumes: `RedisService` (`apps/api/src/redis/redis.service.ts`, `@Global` über `RedisModule`), `ApplicationEnvironment` (`@darts-platform/config`).
- Produces:
  - `ApplicationEnvironment` erhält `RATE_LIMIT_MAX_PER_MINUTE: number`, `RATE_LIMIT_PUBLIC_MAX_PER_MINUTE: number`, `RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: number` (alle mit Vorgabe, alle `number` nach dem Parsen).
  - `RedisService.consumeRateLimit(key: string, windowSeconds: number, max: number): Promise<{ readonly allowed: boolean; readonly retryAfter: number | null }>`
  - `createRedisRateLimitStorage(redisService: RedisService): RateLimitStorage` und `interface RateLimitStorage` aus `apps/api/src/auth/auth-rate-limit-storage.ts`
  - `createAuth(database, environment, rateLimitStorage?: RateLimitStorage)` — der dritte Parameter ist optional, damit `apps/api/src/auth/auth.integration.spec.ts` unverändert weiterläuft.

**Entscheidung: `customStorage` statt `secondaryStorage`.**
Better Auth würde bei gesetztem `secondaryStorage` auch Sessions dorthin verlagern. ADR 0002 sagt ausdrücklich: „Redis is not used as the source of truth for sessions or permissions", und AGENTS.md §4 verbietet, kritische Zustände ausschliesslich in Redis zu halten. `rateLimit.customStorage` berührt nur den Zähler — ein flüchtiger Wert, der genau dort hingehört.

- [ ] **Step 1: Den fehlschlagenden Umgebungstest schreiben**

In `packages/config/src/environment.spec.ts` innerhalb von `describe("parseApplicationEnvironment", …)` ergänzen:

```ts
  it("erlaubt eine TLS-Redis-Verbindung", () => {
    const environment = parseApplicationEnvironment({
      ...validEnvironment,
      REDIS_URL: "rediss://cache.example.test:6380",
    });

    expect(environment.REDIS_URL).toBe("rediss://cache.example.test:6380");
  });

  it("weist ein Redis-Schema ausserhalb von redis und rediss ab", () => {
    expect(() =>
      parseApplicationEnvironment({
        ...validEnvironment,
        REDIS_URL: "http://localhost:6379",
      }),
    ).toThrow(EnvironmentValidationError);
  });

  it("setzt die Rate-Limit-Vorgaben, wenn nichts konfiguriert ist", () => {
    const environment = parseApplicationEnvironment(validEnvironment);

    expect(environment.RATE_LIMIT_MAX_PER_MINUTE).toBe(300);
    expect(environment.RATE_LIMIT_PUBLIC_MAX_PER_MINUTE).toBe(120);
    expect(environment.RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE).toBe(10);
  });

  it("uebernimmt konfigurierte Rate-Limit-Werte als Zahlen", () => {
    const environment = parseApplicationEnvironment({
      ...validEnvironment,
      RATE_LIMIT_MAX_PER_MINUTE: "50",
      RATE_LIMIT_PUBLIC_MAX_PER_MINUTE: "20",
      RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: "3",
    });

    expect(environment.RATE_LIMIT_MAX_PER_MINUTE).toBe(50);
    expect(environment.RATE_LIMIT_PUBLIC_MAX_PER_MINUTE).toBe(20);
    expect(environment.RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE).toBe(3);
  });
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `pnpm --filter @darts-platform/config test`
Expected: FAIL — „erlaubt eine TLS-Redis-Verbindung" wirft `EnvironmentValidationError`, die drei Rate-Limit-Fälle liefern `undefined`.

- [ ] **Step 3: Das Umgebungsschema erweitern**

In `packages/config/src/environment.ts` oberhalb von `applicationEnvironmentSchema` ergänzen:

```ts
const rateLimitMaxSchema = z.coerce.number().int().min(1).max(1_000_000);
```

und in `applicationEnvironmentSchema` die `REDIS_URL`-Zeile ersetzen sowie die drei Werte anhängen:

```ts
  // `rediss://` ist die TLS-Variante; Railway bietet sie an, und die
  // Realtime- und Rate-Limit-Zaehler laufen ueber dieselbe Verbindung.
  REDIS_URL: z.string().url().regex(/^rediss?:\/\//u, {
    message: "must start with redis:// or rediss://",
  }),
```

```ts
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
});
```

- [ ] **Step 4: Umgebungstest laufen lassen und Grün bestätigen**

Run: `pnpm --filter @darts-platform/config test`
Expected: PASS.

- [ ] **Step 5: Den fehlschlagenden Redis-Test schreiben**

`apps/api/src/auth/auth-rate-limit-storage.integration.spec.ts`:

```ts
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { parseApplicationEnvironment } from "@darts-platform/config";

import { RedisService } from "../redis/redis.service.js";
import { createRedisRateLimitStorage } from "./auth-rate-limit-storage.js";

const redisService = new RedisService(parseApplicationEnvironment(process.env));
const storage = createRedisRateLimitStorage(redisService);

afterAll(async () => {
  await redisService.onApplicationShutdown();
});

describe("Redis-gestuetzter Rate-Limit-Zaehler", () => {
  it("laesst genau `max` Anfragen im Fenster durch und sperrt danach", async () => {
    const key = `spec-${randomUUID()}`;
    const rule = { window: 60, max: 2 } as const;

    expect(await storage.consume(key, rule)).toEqual({
      allowed: true,
      retryAfter: null,
    });
    expect(await storage.consume(key, rule)).toEqual({
      allowed: true,
      retryAfter: null,
    });

    const denied = await storage.consume(key, rule);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfter).toBeGreaterThan(0);
    expect(denied.retryAfter).toBeLessThanOrEqual(60);
  }, 30_000);

  it("zaehlt je Schluessel getrennt", async () => {
    const rule = { window: 60, max: 1 } as const;
    const firstKey = `spec-${randomUUID()}`;
    const secondKey = `spec-${randomUUID()}`;

    expect((await storage.consume(firstKey, rule)).allowed).toBe(true);
    expect((await storage.consume(firstKey, rule)).allowed).toBe(false);
    expect((await storage.consume(secondKey, rule)).allowed).toBe(true);
  }, 30_000);
});
```

- [ ] **Step 6: Test laufen lassen und Fehlschlag bestätigen**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/auth/auth-rate-limit-storage.integration.spec.ts`
Expected: FAIL mit `Cannot find module './auth-rate-limit-storage.js'`.

- [ ] **Step 7: Den Zähler in `RedisService` ergänzen**

In `apps/api/src/redis/redis.service.ts` unterhalb von `checkConnection` einfügen:

```ts
  /**
   * Zaehlt eine Anfrage gegen `key` im rollenden Fenster und sagt, ob sie
   * durchgeht. `INCR` ist atomar; die Lebensdauer wird nur beim ersten
   * Treffer gesetzt, damit das Fenster nicht bei jeder Anfrage neu beginnt
   * und ein Dauerbeschuss die Sperre nicht endlos verlaengert.
   */
  public async consumeRateLimit(
    key: string,
    windowSeconds: number,
    max: number,
  ): Promise<{ readonly allowed: boolean; readonly retryAfter: number | null }> {
    await this.ensureConnected();

    const namespacedKey = `rate-limit:${key}`;
    const count = await this.client.incr(namespacedKey);

    if (count === 1) {
      await this.client.expire(namespacedKey, windowSeconds);
    }

    if (count <= max) {
      return { allowed: true, retryAfter: null };
    }

    const remainingSeconds = await this.client.ttl(namespacedKey);
    return {
      allowed: false,
      retryAfter: remainingSeconds > 0 ? remainingSeconds : windowSeconds,
    };
  }
```

- [ ] **Step 8: Die Storage-Adapter-Datei schreiben**

`apps/api/src/auth/auth-rate-limit-storage.ts`:

```ts
import { Logger } from "@nestjs/common";

import type { RedisService } from "../redis/redis.service.js";

export interface RateLimitRule {
  readonly window: number;
  readonly max: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfter: number | null;
}

/**
 * Die Form, die Better Auth als `rateLimit.customStorage` erwartet. Bewusst
 * strukturell nachgebaut statt aus `@better-auth/core` importiert: der Typ
 * liegt dort in einem internen Unterpfad, und die Struktur ist klein genug,
 * dass ein Bruch beim Aktualisieren sofort als Typfehler auffaellt.
 */
export interface RateLimitStorage {
  consume(key: string, rule: RateLimitRule): Promise<RateLimitDecision>;
}

export function createRedisRateLimitStorage(
  redisService: RedisService,
): RateLimitStorage {
  const logger = new Logger("AuthRateLimit");

  return {
    async consume(key, rule) {
      try {
        return await redisService.consumeRateLimit(
          `auth:${key}`,
          rule.window,
          rule.max,
        );
      } catch (error: unknown) {
        // Faellt Redis aus, bremst nichts mehr — die Anmeldung bleibt aber
        // erreichbar. Der Ausfall wird laut protokolliert, damit er nicht
        // stillschweigend zum Dauerzustand wird.
        logger.error(
          "Rate-Limit-Zaehler nicht erreichbar; die Anfrage wird durchgelassen",
          error instanceof Error ? error.stack : undefined,
        );
        return { allowed: true, retryAfter: null };
      }
    },
  };
}
```

- [ ] **Step 9: Redis-Test laufen lassen und Grün bestätigen**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/auth/auth-rate-limit-storage.integration.spec.ts`
Expected: PASS, 2/2.

- [ ] **Step 10: Better Auth konfigurieren**

In `apps/api/src/auth/auth.factory.ts` den Import ergänzen:

```ts
import type { RateLimitStorage } from "./auth-rate-limit-storage.js";
import {
  INVITATION_CLAIM_HEADER,
  invitationClaimMatches,
} from "./invitation-claim.js";
```

Die Signatur erweitern und den `rateLimit`-Block direkt vor `databaseHooks` einsetzen:

```ts
export function createAuth(
  database: Database,
  environment: ApplicationEnvironment,
  rateLimitStorage?: RateLimitStorage,
) {
  return betterAuth({
```

```ts
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
    },
    // Ohne Zaehler skaliert Passwort-Raten mit der Zahl der Instanzen
    // (Audit B, I-6). `customStorage` legt den Zaehler nach Redis, ohne
    // Sessions dorthin zu verschieben — ADR 0002 bleibt gewahrt.
    rateLimit: {
      enabled: true,
      window: 60,
      max: environment.RATE_LIMIT_MAX_PER_MINUTE,
      customRules: {
        "/sign-in/email": {
          window: 60,
          max: environment.RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE,
        },
        "/sign-up/email": {
          window: 60,
          max: environment.RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE,
        },
      },
      ...(rateLimitStorage === undefined
        ? {}
        : { customStorage: rateLimitStorage }),
    },
    databaseHooks: {
```

- [ ] **Step 11: `AuthService` die Storage übergeben lassen**

`apps/api/src/auth/auth.service.ts` — Import und Konstruktor:

```ts
import { APPLICATION_ENVIRONMENT } from "../config/environment.module.js";
import { DatabaseService } from "../database/database.service.js";
import { RedisService } from "../redis/redis.service.js";
import { createRedisRateLimitStorage } from "./auth-rate-limit-storage.js";
import { createAuth, type DartsAuth } from "./auth.factory.js";
import type { AuthContext } from "./auth.types.js";
```

```ts
  public constructor(
    @Inject(DatabaseService) databaseService: DatabaseService,
    @Inject(APPLICATION_ENVIRONMENT)
    environment: ApplicationEnvironment,
    @Inject(RedisService) redisService: RedisService,
  ) {
    this.auth = createAuth(
      databaseService.database,
      environment,
      createRedisRateLimitStorage(redisService),
    );
  }
```

`RedisModule` ist `@Global`, `AuthModule` braucht deshalb keinen zusätzlichen Import.

- [ ] **Step 12: Die neuen Variablen dokumentieren**

In `.env.example` nach der `LOG_LEVEL`-Zeile:

```dotenv
LOG_LEVEL=log

# Rate Limits je IP-Adresse und Minute. Die Vorgaben greifen auch ohne
# Eintrag; für E2E-Läufe setzt playwright.config.ts eigene Werte.
RATE_LIMIT_MAX_PER_MINUTE=300
RATE_LIMIT_PUBLIC_MAX_PER_MINUTE=120
RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE=10
```

In `infrastructure/railway.md` die Variablen-Tabelle um drei Zeilen ergänzen, direkt nach der `REDIS_URL`-Zeile:

```markdown
| `RATE_LIMIT_MAX_PER_MINUTE` | `300` | Obergrenze je IP und Minute für alle übrigen Routen (optional, Vorgabe 300) |
| `RATE_LIMIT_PUBLIC_MAX_PER_MINUTE` | `120` | Obergrenze für `/api/v1/public/**` (optional, Vorgabe 120) |
| `RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE` | `10` | Obergrenze für Anmeldung, Registrierung und Einladungsrouten (optional, Vorgabe 10) |
```

Im selben Abschnitt unter der Tabelle ergänzen:

```markdown
`REDIS_URL` akzeptiert `redis://` und `rediss://`; für die verschlüsselte
Verbindung wird die TLS-Variante der Railway-Referenz eingetragen.
```

- [ ] **Step 13: Vollständige Prüfung**

```bash
pnpm lint
pnpm typecheck
pnpm test
```
Expected: alle drei grün. `apps/api/src/auth/auth.integration.spec.ts` läuft unverändert weiter, weil der dritte `createAuth`-Parameter optional ist.

- [ ] **Step 14: Commit**

```bash
git add packages/config/src/environment.ts packages/config/src/environment.spec.ts apps/api/src/redis/redis.service.ts apps/api/src/auth/auth-rate-limit-storage.ts apps/api/src/auth/auth-rate-limit-storage.integration.spec.ts apps/api/src/auth/auth.factory.ts apps/api/src/auth/auth.service.ts .env.example infrastructure/railway.md
git commit -m "feat(api): Anmeldung und Registrierung ueber Redis-Zaehler begrenzen"
```

---

### Task 4: Rate Limiting der API-Routen (I-6, Teil 2)

**Files:**
- Create: `apps/api/src/common/rate-limit.ts`
- Test: `apps/api/src/common/rate-limit.integration.spec.ts`
- Modify: `apps/api/src/testing/api-harness.ts`
- Modify: `apps/api/src/common/api-exception.filter.ts:13-19`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/web/playwright.config.ts:33-42`
- Modify: `apps/web/src/lib/api-client.ts:15-64`

**Interfaces:**
- Consumes: `registerSecurityHeaders`, `createApiTestApplication` (Task 1); `RATE_LIMIT_MAX_PER_MINUTE`, `RATE_LIMIT_PUBLIC_MAX_PER_MINUTE`, `RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE` (Task 3); `getAuditContext` (`apps/api/src/common/audit-context.ts`).
- Produces: `registerRateLimit(app: NestFastifyApplication, environment: ApplicationEnvironment): Promise<void>` aus `apps/api/src/common/rate-limit.ts`. `createApiTestApplication` ruft sie ab jetzt mit auf.

**Bewusste Grenze.** Der Fastify-Zähler liegt im Prozessspeicher. Hinter mehreren Railway-Instanzen greift er deshalb je Instanz. Das ist bewusst: der verteilte Zähler sitzt bei Better Auth genau auf den Routen, für die der Audit ihn verlangt (`/sign-in/email`, `/sign-up/email`, Task 3). Der Fastify-Zähler ist die grobe Bremse für die übrigen Routen und würde eine `ioredis`-Abhängigkeit verlangen, um geteilt zu werden — das ist es an dieser Stelle nicht wert. Der Punkt gehört in die PR-Beschreibung.

**Zweite bewusste Grenze.** Auf `/api/v1/auth/**` greifen beide Bremsen. Wer zuerst auslöst, bestimmt den Antwortkörper: Fastify antwortet im einheitlichen Format, Better Auth mit seinem eigenen `{ "message": … }`. Die Auth-Routen reichen ohnehin schon Better-Auth-Fehlerkörper unverändert durch (`auth.controller.ts`), die Unschärfe ist dort also nicht neu.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`apps/api/src/common/rate-limit.integration.spec.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

import { apiErrorSchema } from "@darts-platform/schemas";

import { createApiTestApplication } from "../testing/api-harness.js";

let app: NestFastifyApplication;

beforeAll(async () => {
  // Drei Anfragen je Minute auf die oeffentlichen Routen: die vierte muss
  // gebremst werden, ohne dass der Test eine Minute lang warten muss.
  app = await createApiTestApplication({ RATE_LIMIT_PUBLIC_MAX_PER_MINUTE: 3 });
}, 60_000);

afterAll(async () => {
  await app.close();
});

describe("Rate Limiting", () => {
  it("antwortet nach dem Ueberschreiten mit 429 im einheitlichen Fehlerformat", async () => {
    const url = `/api/v1/public/tournaments/${randomUUID()}/live`;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const allowed = await app.inject({ method: "GET", url });
      expect(allowed.statusCode).not.toBe(429);
    }

    const blocked = await app.inject({ method: "GET", url });
    expect(blocked.statusCode).toBe(429);

    const payload: unknown = blocked.json();
    const parsed = apiErrorSchema.parse(payload);
    expect(parsed.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(parsed.error.message.length).toBeGreaterThan(0);
    expect(blocked.headers["retry-after"]).toBeDefined();
  }, 30_000);

  it("bremst den Health-Endpunkt nicht mit der oeffentlichen Grenze", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({ method: "GET", url: "/api/v1/health" });
      expect(response.statusCode).not.toBe(429);
    }
  }, 30_000);
});
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/common/rate-limit.integration.spec.ts`
Expected: FAIL — die vierte Anfrage kommt mit `404` statt `429` zurück, weil kein Limiter registriert ist.

- [ ] **Step 3: `registerRateLimit` implementieren**

`apps/api/src/common/rate-limit.ts`:

```ts
import rateLimit from "@fastify/rate-limit";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyRequest } from "fastify";

import type { ApplicationEnvironment } from "@darts-platform/config";

import { getAuditContext } from "./audit-context.js";

const RATE_LIMIT_WINDOW = "1 minute";
const PUBLIC_PATH_PREFIX = "/api/v1/public/";

/**
 * Routen, die ein Geheimnis ausgeben oder pruefen: die Einladung liefert ein
 * gueltiges Claim-Token zurueck, `accept` prueft eines, und die
 * Auth-Endpunkte pruefen Passwoerter (Audit B, I-6).
 */
const SENSITIVE_PATH_PATTERNS: readonly RegExp[] = [
  /^\/api\/v1\/organizations\/[^/]+\/invitations$/u,
  /^\/api\/v1\/invitations\/[^/]+\/accept$/u,
  /^\/api\/v1\/auth\/sign-in\//u,
  /^\/api\/v1\/auth\/sign-up\//u,
];

function pathOf(request: FastifyRequest): string {
  const queryIndex = request.url.indexOf("?");
  return queryIndex === -1 ? request.url : request.url.slice(0, queryIndex);
}

export async function registerRateLimit(
  app: NestFastifyApplication,
  environment: ApplicationEnvironment,
): Promise<void> {
  await app.register(rateLimit, {
    global: true,
    hook: "onRequest",
    timeWindow: RATE_LIMIT_WINDOW,
    max: (request: FastifyRequest): number => {
      const path = pathOf(request);

      if (SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
        return environment.RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE;
      }

      if (path.startsWith(PUBLIC_PATH_PREFIX)) {
        return environment.RATE_LIMIT_PUBLIC_MAX_PER_MINUTE;
      }

      return environment.RATE_LIMIT_MAX_PER_MINUTE;
    },
    // Der Limiter antwortet vor dem Nest-Fehlerfilter, deshalb baut er den
    // Fehlerkoerper selbst — in derselben Form wie jede andere Fehlerantwort
    // (AGENTS.md §15).
    errorResponseBuilder: (request: FastifyRequest) => ({
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many requests. Try again in a minute.",
        correlationId: getAuditContext(request).correlationId,
      },
    }),
  });
}
```

- [ ] **Step 4: Das Harness den Limiter mit registrieren lassen**

In `apps/api/src/testing/api-harness.ts` den Import ergänzen:

```ts
import { ApiExceptionFilter } from "../common/api-exception.filter.js";
import { registerRateLimit } from "../common/rate-limit.js";
import { registerSecurityHeaders } from "../common/security-headers.js";
```

und die Registrierung ergänzen:

```ts
  app.setGlobalPrefix("api/v1");
  await registerSecurityHeaders(app);
  await registerRateLimit(app, environment);
  app.useGlobalFilters(new ApiExceptionFilter());
```

- [ ] **Step 5: Test laufen lassen und Grün bestätigen**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/common/rate-limit.integration.spec.ts`
Expected: PASS, 2/2.

- [ ] **Step 6: 429 in die Fehlercode-Tabelle aufnehmen**

Damit auch eine später aus Nest geworfene 429 denselben Code trägt, in `apps/api/src/common/api-exception.filter.ts`:

```ts
const errorCodes: Readonly<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: "VALIDATION_ERROR",
  [HttpStatus.UNAUTHORIZED]: "AUTHENTICATION_REQUIRED",
  [HttpStatus.FORBIDDEN]: "PERMISSION_DENIED",
  [HttpStatus.NOT_FOUND]: "RESOURCE_NOT_FOUND",
  [HttpStatus.CONFLICT]: "RESOURCE_CONFLICT",
  [HttpStatus.TOO_MANY_REQUESTS]: "RATE_LIMIT_EXCEEDED",
};
```

- [ ] **Step 7: `main.ts` den Limiter registrieren lassen**

In `apps/api/src/main.ts` den Import ergänzen:

```ts
import { ApiLoggingInterceptor } from "./common/api-logging.interceptor.js";
import { registerRateLimit } from "./common/rate-limit.js";
import { registerSecurityHeaders } from "./common/security-headers.js";
```

und direkt nach `await registerSecurityHeaders(app);`:

```ts
  await registerSecurityHeaders(app);
  await registerRateLimit(app, environment);
  app.useGlobalFilters(new ApiExceptionFilter());
```

- [ ] **Step 8: Den E2E-Server aus dem Limit nehmen**

Ein Playwright-Lauf kommt von einer einzigen IP-Adresse und legt in wenigen Minuten hunderte Anfragen hin, darunter mehrere Registrierungen. In `apps/web/playwright.config.ts` im `env`-Block des API-Servers:

```ts
      env: {
        API_PORT: String(apiPort),
        BETTER_AUTH_URL: apiOrigin,
        PORT: String(apiPort),
        // Der Lauf kommt von einer einzigen Adresse und registriert mehrere
        // Konten; die Produktionsgrenzen wuerden ihn abwuergen.
        RATE_LIMIT_MAX_PER_MINUTE: "100000",
        RATE_LIMIT_PUBLIC_MAX_PER_MINUTE: "100000",
        RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: "100000",
        WEB_ORIGIN: webOrigin,
      },
```

- [ ] **Step 9: Die deutsche Meldung im Web-Client ergänzen**

In `apps/web/src/lib/api-client.ts` innerhalb von `localizedMessage`, alphabetisch bei den übrigen Einträgen:

```ts
    RATE_LIMIT_EXCEEDED:
      "Zu viele Anfragen in kurzer Zeit. Warte eine Minute und versuche es erneut.",
```

- [ ] **Step 10: Vollständige Prüfung**

```bash
pnpm lint
pnpm typecheck
pnpm test
```
Expected: alle drei grün.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/common/rate-limit.ts apps/api/src/common/rate-limit.integration.spec.ts apps/api/src/testing/api-harness.ts apps/api/src/common/api-exception.filter.ts apps/api/src/main.ts apps/web/playwright.config.ts apps/web/src/lib/api-client.ts
git commit -m "feat(api): API-Routen mit @fastify/rate-limit bremsen"
```

---

### Task 5: Mandantenanlage hinter ein Freigabe-Flag (I-3)

**Files:**
- Modify: `packages/config/src/environment.ts`
- Modify: `packages/config/src/environment.spec.ts`
- Modify: `apps/api/src/organizations/organizations.service.ts:51-69`
- Test: `apps/api/src/organizations/organizations.integration.spec.ts`
- Modify: `apps/web/playwright.config.ts`
- Modify: `apps/web/src/lib/api-client.ts`
- Modify: `apps/web/src/components/tenant-dashboard.tsx:198-270`
- Modify: `.env.example`
- Modify: `infrastructure/railway.md`

**Interfaces:**
- Consumes: `OrganizationsRepository.create`, `OrganizationAccessService`, `APPLICATION_ENVIRONMENT`.
- Produces:
  - `ApplicationEnvironment` erhält `ALLOW_SELF_SERVICE_ORGANIZATIONS: boolean` (Vorgabe `false`).
  - `OrganizationsService` erhält einen dritten Konstruktor-Parameter `environment: ApplicationEnvironment`. **Achtung:** `apps/api/src/players/tenant-isolation.integration.spec.ts` und `apps/api/src/auth/auth.integration.spec.ts` bauen den Service von Hand — beide müssen den dritten Parameter mitgeben.
  - Fehlercode `SELF_SERVICE_ORGANIZATIONS_DISABLED` (HTTP 403).

**Warum ein Flag und keine Systemrolle.** ARCHITECTURE §7 nennt `SUPER_ADMIN`, die Rolle existiert aber nicht. Sie jetzt zu bauen wäre ein eigenes Vorhaben mit eigenem Datenmodell. Bis dahin gilt ADR 0012: Mandanten entstehen über den Bootstrap-CLI. Das Flag schliesst die Selbstbedienung, ohne eine Parallelstruktur einzuführen, und ist die kleinste Änderung, die den Befund tatsächlich schliesst.

- [ ] **Step 1: Den fehlschlagenden Umgebungstest schreiben**

In `packages/config/src/environment.spec.ts` innerhalb von `describe("parseApplicationEnvironment", …)`:

```ts
  it("verbietet die Selbstbedienung bei der Mandantenanlage standardmaessig", () => {
    const environment = parseApplicationEnvironment(validEnvironment);

    expect(environment.ALLOW_SELF_SERVICE_ORGANIZATIONS).toBe(false);
  });

  it("erlaubt die Selbstbedienung nur bei genau 'true'", () => {
    expect(
      parseApplicationEnvironment({
        ...validEnvironment,
        ALLOW_SELF_SERVICE_ORGANIZATIONS: "true",
      }).ALLOW_SELF_SERVICE_ORGANIZATIONS,
    ).toBe(true);

    expect(() =>
      parseApplicationEnvironment({
        ...validEnvironment,
        ALLOW_SELF_SERVICE_ORGANIZATIONS: "yes",
      }),
    ).toThrow(EnvironmentValidationError);
  });
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `pnpm --filter @darts-platform/config test`
Expected: FAIL — `expected undefined to be false`.

- [ ] **Step 3: Das Flag ins Schema aufnehmen**

In `packages/config/src/environment.ts` oberhalb von `applicationEnvironmentSchema`:

```ts
/**
 * Freigabe-Flags werden bewusst hart geparst: nur die Zeichenketten `true`
 * und `false` sind zulaessig. Ein Tippfehler bricht den Start ab, statt
 * stillschweigend als „aus" durchzugehen.
 */
const booleanFlagSchema = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");
```

und im Schema hinter `LOG_LEVEL`:

```ts
  LOG_LEVEL: logLevelSchema.default("log"),
  /**
   * Erlaubt `POST /organizations` fuer jede angemeldete Person. Vorgabe
   * `false`: Mandanten entstehen ueber den Bootstrap-Pfad (ADR 0012).
   */
  ALLOW_SELF_SERVICE_ORGANIZATIONS: booleanFlagSchema,
```

- [ ] **Step 4: Umgebungstest laufen lassen und Grün bestätigen**

Run: `pnpm --filter @darts-platform/config test`
Expected: PASS.

- [ ] **Step 5: Den fehlschlagenden Integrationstest schreiben**

`apps/api/src/organizations/organizations.integration.spec.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import {
  parseApplicationEnvironment,
  type ApplicationEnvironment,
} from "@darts-platform/config";
import { organizations, users } from "@darts-platform/database";

import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { OrganizationAccessService } from "./organization-access.service.js";
import { OrganizationsRepository } from "./organizations.repository.js";
import { OrganizationsService } from "./organizations.service.js";

const baseEnvironment = parseApplicationEnvironment(process.env);
const databaseService = new DatabaseService(baseEnvironment);
const repository = new OrganizationsRepository(databaseService);
const access = new OrganizationAccessService(repository);

function serviceWithFlag(allow: boolean): OrganizationsService {
  const environment: ApplicationEnvironment = {
    ...baseEnvironment,
    ALLOW_SELF_SERVICE_ORGANIZATIONS: allow,
  };
  return new OrganizationsService(repository, access, environment);
}

const userId = randomUUID();
const auth: AuthContext = {
  user: {
    id: userId,
    email: `self-service-${userId}@example.test`,
    name: "Self Service",
  },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const audit = {
  correlationId: randomUUID(),
  ip: "127.0.0.1",
  userAgent: "vitest",
} as const;
const createdOrganizationIds: string[] = [];

beforeAll(async () => {
  await databaseService.database.insert(users).values({
    id: userId,
    email: auth.user.email,
    displayName: auth.user.name,
  });
});

afterAll(async () => {
  for (const organizationId of createdOrganizationIds) {
    await databaseService.database
      .delete(organizations)
      .where(eq(organizations.id, organizationId));
  }
  await databaseService.database.delete(users).where(eq(users.id, userId));
  await databaseService.onApplicationShutdown();
});

describe("Mandantenanlage", () => {
  it("weist die Selbstbedienung ab, solange das Flag aus ist", async () => {
    const slug = `denied-${randomUUID()}`;

    await expect(
      serviceWithFlag(false).create({
        data: {
          name: "Nicht erlaubt",
          slug,
          timezone: "Europe/Zurich",
          locale: "de-CH",
        },
        auth,
        audit,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const rows = await databaseService.database
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, slug));
    expect(rows).toHaveLength(0);
  }, 30_000);

  it("nennt den eigenen Fehlercode", async () => {
    try {
      await serviceWithFlag(false).create({
        data: {
          name: "Nicht erlaubt",
          slug: `denied-${randomUUID()}`,
          timezone: "Europe/Zurich",
          locale: "de-CH",
        },
        auth,
        audit,
      });
      throw new Error("Die Anlage hätte abgewiesen werden müssen.");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ForbiddenException);
      const response = (error as ForbiddenException).getResponse();
      expect(response).toMatchObject({
        code: "SELF_SERVICE_ORGANIZATIONS_DISABLED",
      });
    }
  }, 30_000);

  it("legt den Mandanten an, wenn das Flag gesetzt ist", async () => {
    const organization = await serviceWithFlag(true).create({
      data: {
        name: "Erlaubter Verein",
        slug: `allowed-${randomUUID()}`,
        timezone: "Europe/Zurich",
        locale: "de-CH",
      },
      auth,
      audit,
    });
    createdOrganizationIds.push(organization.id);

    expect(organization.role).toBe("OWNER");
  }, 30_000);
});
```

- [ ] **Step 6: Test laufen lassen und Fehlschlag bestätigen**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/organizations/organizations.integration.spec.ts`
Expected: FAIL — der Konstruktor nimmt nur zwei Argumente (TypeScript-Fehler beim Übersetzen des Tests).

- [ ] **Step 7: Die Flag-Prüfung im Service umsetzen**

In `apps/api/src/organizations/organizations.service.ts` Imports ergänzen:

```ts
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import type { ApplicationEnvironment } from "@darts-platform/config";
```

```ts
import type { AuthContext } from "../auth/auth.types.js";
import type { AuditContext } from "../common/audit-context.js";
import { APPLICATION_ENVIRONMENT } from "../config/environment.module.js";
import { OrganizationAccessService } from "./organization-access.service.js";
import { OrganizationsRepository } from "./organizations.repository.js";
```

Konstruktor erweitern:

```ts
  public constructor(
    @Inject(OrganizationsRepository)
    private readonly organizationsRepository: OrganizationsRepository,
    @Inject(OrganizationAccessService)
    private readonly organizationAccessService: OrganizationAccessService,
    @Inject(APPLICATION_ENVIRONMENT)
    private readonly environment: ApplicationEnvironment,
  ) {}
```

und `create` um die Prüfung ergänzen:

```ts
  public async create(input: {
    readonly data: CreateOrganizationInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<OrganizationSummary> {
    // Ohne diese Sperre macht sich jede angemeldete Person zum OWNER eines
    // eigenen Mandanten und darf von dort aus beliebig einladen — die
    // einladungsgebundene Registrierung aus ADR 0010 waere damit umgangen
    // (Audit B, I-3). Mandanten entstehen ueber den Bootstrap-Pfad
    // (ADR 0012), solange es keine Systemrolle `SUPER_ADMIN` gibt.
    if (!this.environment.ALLOW_SELF_SERVICE_ORGANIZATIONS) {
      throw new ForbiddenException({
        code: "SELF_SERVICE_ORGANIZATIONS_DISABLED",
        message: "New organizations are created by platform operations.",
      });
    }

    try {
```

- [ ] **Step 8: Die beiden bestehenden Testdateien nachziehen**

In `apps/api/src/players/tenant-isolation.integration.spec.ts` die Service-Erzeugung erweitern:

```ts
const environment = parseApplicationEnvironment(process.env);
const databaseService = new DatabaseService(environment);
const organizationsRepository = new OrganizationsRepository(databaseService);
const accessService = new OrganizationAccessService(organizationsRepository);
const organizationsService = new OrganizationsService(
  organizationsRepository,
  accessService,
  { ...environment, ALLOW_SELF_SERVICE_ORGANIZATIONS: true },
);
```

In `apps/api/src/auth/auth.integration.spec.ts` an der Stelle, an der `new OrganizationsService(...)` gebaut wird, denselben dritten Parameter ergänzen:

```ts
        const organizationsService = new OrganizationsService(
          repository,
          new OrganizationAccessService(repository),
          { ...environment, ALLOW_SELF_SERVICE_ORGANIZATIONS: true },
        );
```

- [ ] **Step 9: Test laufen lassen und Grün bestätigen**

```bash
cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/organizations/organizations.integration.spec.ts
cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/players/tenant-isolation.integration.spec.ts
cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/auth/auth.integration.spec.ts
```
Expected: alle drei PASS.

- [ ] **Step 10: Das Web-Formular ehrlich machen**

Der Web-Client hat den Pfad: `apps/web/src/components/tenant-dashboard.tsx`, `OrganizationsPanel` schickt `POST /organizations`. Erst die deutsche Meldung in `apps/web/src/lib/api-client.ts`, bei den übrigen Einträgen von `localizedMessage`:

```ts
    SELF_SERVICE_ORGANIZATIONS_DISABLED:
      "Neue Organisationen werden vom Betrieb angelegt. Wende dich an die Plattformverwaltung.",
```

Dann in `apps/web/src/components/tenant-dashboard.tsx` innerhalb von `OrganizationsPanel` den Import ergänzen:

```ts
import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";
import { ApiClientError } from "@/lib/api-error";
```

und das Formular durch einen Hinweis ersetzen, sobald der Server die Anlage gesperrt hat:

```tsx
  const submit = form.handleSubmit((data) => createOrganization.mutate(data));
  // Der Server entscheidet, ob es diesen Weg gibt. Ein Formular, das
  // zuverlaessig scheitert, ist schlechter als ein ehrlicher Satz.
  const selfServiceDisabled =
    createOrganization.error instanceof ApiClientError &&
    createOrganization.error.code === "SELF_SERVICE_ORGANIZATIONS_DISABLED";
```

und weiter unten den `<form>`-Block ersetzen:

```tsx
      {selfServiceDisabled ? (
        <div className="mt-6 space-y-2 border-t border-slate-800 pt-5">
          <h3 className="text-body font-semibold text-slate-200">Organisation erstellen</h3>
          <p className="text-body text-slate-400" role="status">
            {messageFrom(createOrganization.error)}
          </p>
        </div>
      ) : (
        <form className="mt-6 space-y-3 border-t border-slate-800 pt-5" onSubmit={(event) => void submit(event)}>
          <h3 className="text-body font-semibold text-slate-200">Organisation erstellen</h3>
          <div className="space-y-2">
            <label className={labelClassName} htmlFor="organization-name">Organisationsname</label>
            <input id="organization-name" className={inputClassName} placeholder="Vereinsname" {...form.register("name")} />
          </div>
          <div className="space-y-2">
            <label className={labelClassName} htmlFor="organization-slug">Organisationskürzel</label>
            <input id="organization-slug" className={inputClassName} placeholder="club-slug" {...form.register("slug")} />
          </div>
          {createOrganization.isError ? (
            <p role="alert" className="text-body text-rose-300">
              {messageFrom(createOrganization.error)}
            </p>
          ) : null}
          <Button className="w-full" disabled={createOrganization.isPending} type="submit">
            Erstellen
          </Button>
        </form>
      )}
```

Eine Fähigkeitsabfrage, die das Formular schon vor dem ersten Versuch ausblendet, bräuchte einen neuen Endpunkt — das gehört zu „Organization Settings" (Tier 3) und nicht in diesen Fix.

- [ ] **Step 11: Die E2E-Suite freischalten**

Die E2E-Tests legen Organisationen über die Oberfläche an (`apps/web/tests/sign-up.ts`, `apps/web/tests/foundation.spec.ts:228-237`). In `apps/web/playwright.config.ts` im `env`-Block des API-Servers ergänzen:

```ts
      env: {
        // Die E2E-Suite legt ihre Mandanten ueber die Oberflaeche an; in
        // Production bleibt die Selbstbedienung aus (ADR 0012).
        ALLOW_SELF_SERVICE_ORGANIZATIONS: "true",
        API_PORT: String(apiPort),
        BETTER_AUTH_URL: apiOrigin,
        PORT: String(apiPort),
        RATE_LIMIT_MAX_PER_MINUTE: "100000",
        RATE_LIMIT_PUBLIC_MAX_PER_MINUTE: "100000",
        RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: "100000",
        WEB_ORIGIN: webOrigin,
      },
```

- [ ] **Step 12: Die Variable dokumentieren**

In `.env.example` direkt nach dem Rate-Limit-Block:

```dotenv
# Erlaubt "Organisation erstellen" in der Oberfläche. Vorgabe false:
# Mandanten entstehen über pnpm db:bootstrap:production (ADR 0012).
# Für lokale Entwicklung mit dem Formular auf true setzen.
ALLOW_SELF_SERVICE_ORGANIZATIONS=false
```

In `infrastructure/railway.md` in der Variablen-Tabelle:

```markdown
| `ALLOW_SELF_SERVICE_ORGANIZATIONS` | nicht gesetzt (`false`) | öffnet `POST /organizations` für jede angemeldete Person; in Production bewusst aus |
```

- [ ] **Step 13: Vollständige Prüfung**

```bash
pnpm lint
pnpm typecheck
pnpm test
```
Expected: alle drei grün.

- [ ] **Step 14: Commit**

```bash
git add packages/config/src/environment.ts packages/config/src/environment.spec.ts apps/api/src/organizations/organizations.service.ts apps/api/src/organizations/organizations.integration.spec.ts apps/api/src/players/tenant-isolation.integration.spec.ts apps/api/src/auth/auth.integration.spec.ts apps/web/playwright.config.ts apps/web/src/lib/api-client.ts apps/web/src/components/tenant-dashboard.tsx .env.example infrastructure/railway.md
git commit -m "feat(api): Mandantenanlage hinter ein Freigabe-Flag legen"
```

---

### Task 6: Öffentliche Turnier-Projektion trimmen (I-1a)

**Files:**
- Modify: `packages/schemas/src/tournament.ts:86-94, 105-117, 171-202`
- Modify: `packages/schemas/src/tournament.spec.ts`
- Modify: `packages/schemas/src/index.ts:45-95`
- Modify: `apps/api/src/tournaments/tournaments.service.ts:160-173`
- Test: `apps/api/src/tournaments/tournaments.integration.spec.ts` (Fall ergänzen)
- Modify: `apps/web/src/components/live/live-tournament.tsx:4, 158-168`

**Interfaces:**
- Consumes: `tournamentDashboardSchema`, `boardSlotSchema`, `queueEntrySchema` aus `packages/schemas/src/tournament.ts`.
- Produces:
  - `publicBoardSlotSchema`, `publicQueueEntrySchema`, das getrimmte `publicTournamentDashboardSchema`
  - Typen `PublicBoardSlot`, `PublicQueueEntry`, `PublicTournamentDashboard` (letzterer ändert seine Form)
  - `TournamentsService.publicDashboard` liefert die getrimmte Form.

**Was bleibt.** Die Live-Ansicht (`apps/web/src/components/live/live-tournament.tsx`) liest `tournament.name`, `tournament.stageLabel`, `tournament.status`, `tournament.playedMatches`, `tournament.totalMatches`, `boards[].boardId/boardName/state/match`, `groups`, `bracket` und `participants[].playerId/displayName/status`. Sie liest **weder** `tournament.organizationId` **noch** `conflicts` **noch** `blockedReason` — geprüft mit `grep` über `apps/web/src/components/live/`. Das Trimmen bricht die Ansicht also nicht. `blockedReason` wird zusätzlich aus `queue` entfernt: derselbe Betriebsgrund, dieselbe Begründung, und die öffentliche Ansicht rendert die Warteschlange nicht.

- [ ] **Step 1: Den fehlschlagenden Schema-Test schreiben**

In `packages/schemas/src/tournament.spec.ts` ergänzen (Import oben entsprechend erweitern):

```ts
import {
  publicTournamentDashboardSchema,
  tournamentDashboardSchema,
} from "./tournament.js";

it("nennt in der oeffentlichen Turnieransicht weder Mandant noch Betriebsinterna", () => {
  const publicShape = publicTournamentDashboardSchema.shape;
  const publicTournamentShape = publicShape.tournament.shape;

  expect(Object.keys(publicShape)).not.toContain("conflicts");
  expect(Object.keys(publicTournamentShape)).not.toContain("organizationId");
  expect(Object.keys(publicShape.boards.element.shape)).not.toContain("blockedReason");
  expect(Object.keys(publicShape.queue.element.shape)).not.toContain("blockedReason");

  // Die interne Sicht behaelt alles: sie ist der Arbeitsplatz der
  // Turnierleitung.
  expect(Object.keys(tournamentDashboardSchema.shape)).toContain("conflicts");
  expect(Object.keys(tournamentDashboardSchema.shape.tournament.shape)).toContain(
    "organizationId",
  );
});
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `pnpm --filter @darts-platform/schemas test`
Expected: FAIL — `conflicts` und `organizationId` stehen noch in der öffentlichen Form.

- [ ] **Step 3: Die öffentlichen Schemas schreiben**

In `packages/schemas/src/tournament.ts` das bestehende `publicTournamentDashboardSchema` (Zeile 198-202) ersetzen:

```ts
/**
 * Die oeffentliche Sicht auf ein Board nennt keinen Sperrgrund: `blockedReason`
 * ist der Betriebsvermerk der Turnierleitung („Board defekt", „Personal
 * fehlt") und geht das Publikum nichts an (Audit B, I-1).
 */
export const publicBoardSlotSchema = boardSlotSchema.omit({ blockedReason: true });

/** Aus demselben Grund ohne Sperrgrund wie `publicBoardSlotSchema`. */
export const publicQueueEntrySchema = queueEntrySchema.omit({ blockedReason: true });

/**
 * Die oeffentliche Projektion (ARCHITECTURE §27) ist keine Durchreiche der
 * internen Dashboard-Struktur. Sie nennt insbesondere **nicht** die
 * `organizationId` — die ist der Pfadschluessel jeder authentifizierten
 * Route und gehoert nicht in eine anonym abrufbare Antwort.
 */
export const publicTournamentDashboardSchema = tournamentDashboardSchema
  .omit({ conflicts: true })
  .extend({
    tournament: tournamentDashboardSchema.shape.tournament.omit({
      organizationId: true,
    }),
    participants: z.array(
      tournamentDashboardParticipantSchema.omit({
        withdrawnAt: true,
        withdrawalReason: true,
      }),
    ),
    boards: z.array(publicBoardSlotSchema),
    queue: z.array(publicQueueEntrySchema),
  });
```

Bei den Typ-Exporten am Dateiende ergänzen:

```ts
export type PublicBoardSlot = z.infer<typeof publicBoardSlotSchema>;
export type PublicQueueEntry = z.infer<typeof publicQueueEntrySchema>;
export type PublicTournamentDashboard = z.infer<typeof publicTournamentDashboardSchema>;
```

(die bestehende `PublicTournamentDashboard`-Zeile bleibt, die zwei neuen kommen davor.)

- [ ] **Step 4: Die Exporte im Paket-Index ergänzen**

In `packages/schemas/src/index.ts` im `./tournament`-Block, jeweils alphabetisch einsortiert:

```ts
  publicBoardSlotSchema,
  publicQueueEntrySchema,
  publicTournamentDashboardSchema,
```

```ts
  type PublicBoardSlot,
  type PublicQueueEntry,
  type PublicTournamentDashboard,
```

- [ ] **Step 5: Schema-Test laufen lassen und Grün bestätigen**

Run: `pnpm --filter @darts-platform/schemas test`
Expected: PASS.

- [ ] **Step 6: Den fehlschlagenden API-Test schreiben**

In `apps/api/src/tournaments/tournaments.integration.spec.ts` einen Fall ergänzen. Er nutzt das Turnier, das die vorhandenen Fälle in dieser Datei bereits anlegen — die Namen der dortigen Hilfsvariablen (`organizationId`, `service`, die Turnier-Erzeugung) sind aus der Datei zu übernehmen:

```ts
  it("nennt in der oeffentlichen Live-Sicht weder Mandant noch Betriebsinterna", async () => {
    const tournament = await createTournament();

    const dashboard = await service.publicDashboard(tournament.id);
    const serialized: unknown = JSON.parse(JSON.stringify(dashboard));

    expect(dashboard.tournament).not.toHaveProperty("organizationId");
    expect(dashboard).not.toHaveProperty("conflicts");
    for (const board of dashboard.boards) {
      expect(board).not.toHaveProperty("blockedReason");
    }
    for (const entry of dashboard.queue) {
      expect(entry).not.toHaveProperty("blockedReason");
    }
    // Sicherheitsnetz gegen ein spaeter wieder durchgereichtes Feld: die
    // Mandanten-UUID darf im gesamten Antwortkoerper nicht vorkommen.
    expect(JSON.stringify(serialized)).not.toContain(organizationId);

    // Was die Live-Ansicht braucht, bleibt.
    expect(dashboard.tournament.name.length).toBeGreaterThan(0);
    expect(dashboard.participants.length).toBeGreaterThan(0);
  }, 30_000);
```

- [ ] **Step 7: Test laufen lassen und Fehlschlag bestätigen**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/tournaments/tournaments.integration.spec.ts`
Expected: FAIL — die Antwort enthält weiterhin `organizationId`.

- [ ] **Step 8: Die Projektion im Service explizit bauen**

In `apps/api/src/tournaments/tournaments.service.ts` `publicDashboard` ersetzen:

```ts
  public async publicDashboard(tournamentId: string): Promise<PublicTournamentDashboard> {
    const data = await this.repository.getPublicDashboardData(tournamentId);
    if (data === null) throw new NotFoundException("Turnier nicht gefunden.");
    const dashboard = await this.projectDashboard(data);
    // Die oeffentliche Sicht wird Feld fuer Feld gebaut, nicht aus der
    // internen durchgereicht: so faellt jedes neue interne Feld auf, statt
    // sich stillschweigend nach draussen zu vererben (Audit B, I-1).
    const { organizationId, ...tournament } = dashboard.tournament;
    void organizationId;
    return publicTournamentDashboardSchema.parse({
      tournament,
      participants: dashboard.participants.map((participant) => ({
        playerId: participant.playerId,
        displayName: participant.displayName,
        seed: participant.seed,
        status: participant.status,
      })),
      boards: dashboard.boards.map(({ blockedReason, ...board }) => {
        void blockedReason;
        return board;
      }),
      queue: dashboard.queue.map(({ blockedReason, ...entry }) => {
        void blockedReason;
        return entry;
      }),
      groups: dashboard.groups,
      bracket: dashboard.bracket,
      recentResults: dashboard.recentResults,
      generatedAt: dashboard.generatedAt,
    });
  }
```

- [ ] **Step 9: API-Test laufen lassen und Grün bestätigen**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/tournaments/tournaments.integration.spec.ts`
Expected: PASS.

- [ ] **Step 10: Die Live-Ansicht auf den öffentlichen Typ umstellen**

In `apps/web/src/components/live/live-tournament.tsx` die Import-Zeile 4 ersetzen:

```tsx
import { publicTournamentDashboardSchema, type PublicBoardSlot } from "@darts-platform/schemas";
```

und in der Komponente `LiveBoard` die Prop-Typisierung:

```tsx
function LiveBoard({ board, mode, tournamentId }: { readonly board: PublicBoardSlot; readonly mode: LiveTournamentProps["mode"]; readonly tournamentId: string }) {
```

- [ ] **Step 11: Vollständige Prüfung**

```bash
pnpm lint
pnpm typecheck
pnpm test
```
Expected: alle drei grün. Bricht `pnpm typecheck` in `apps/web` mit einem fehlenden `PublicBoardSlot` ab, fehlt der Paket-Build: `pnpm --filter @darts-platform/schemas build` und noch einmal prüfen.

- [ ] **Step 12: Commit**

```bash
git add packages/schemas/src/tournament.ts packages/schemas/src/tournament.spec.ts packages/schemas/src/index.ts apps/api/src/tournaments/tournaments.service.ts apps/api/src/tournaments/tournaments.integration.spec.ts apps/web/src/components/live/live-tournament.tsx
git commit -m "fix(api): oeffentliche Turnieransicht ohne Mandant und Betriebsinterna"
```

---

### Task 7: Mitgliedschaften ändern und Zugriff entziehen (I-4, M-7)

**Files:**
- Modify: `packages/domain/src/membership.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/schemas/src/organization.ts`
- Modify: `packages/schemas/src/organization.spec.ts`
- Modify: `packages/schemas/src/index.ts:22-44`
- Modify: `apps/api/src/organizations/organizations.repository.ts`
- Modify: `apps/api/src/organizations/organizations.service.ts`
- Modify: `apps/api/src/organizations/organizations.controller.ts`
- Test: `apps/api/src/organizations/memberships.integration.spec.ts`

**Interfaces:**
- Consumes: `OrganizationAccessService.requirePermission`, `getAuditContext`, `parseBody`, `AuditContext`, `memberships`/`users`/`auditEvents` aus `@darts-platform/database`.
- Produces:
  - `isMembershipStatus(value: string): value is MembershipStatus` aus `@darts-platform/domain`
  - `membershipStatusSchema`, `assignableMembershipStatusSchema`, `updateMembershipSchema`, `organizationMemberSchema` und die Typen `UpdateMembershipInput`, `OrganizationMember` aus `@darts-platform/schemas`
  - `OrganizationsRepository.updateMembership(input): Promise<UpdateMembershipResult>` mit `UpdateMembershipResult = { outcome: "updated"; member: OrganizationMember } | { outcome: "not-found" } | { outcome: "last-owner" }`
  - `OrganizationsService.updateMembership(input): Promise<OrganizationMember>`
  - Route `PATCH /api/v1/organizations/:organizationId/members/:userId`
  - Fehlercodes `LAST_OWNER_PROTECTED` (409), `SELF_MEMBERSHIP_CHANGE_FORBIDDEN` (403) und `OWNER_GRANT_REQUIRES_OWNER` (403)

**Regelentscheidungen, ausgeschrieben:**

1. **Der letzte aktive `OWNER` ist geschützt.** Verliert die Zielperson durch die Änderung ihren aktiven Owner-Zugriff — sei es durch eine andere Rolle, sei es durch `SUSPENDED` — und gibt es in derselben Organisation keine zweite aktive `OWNER`-Mitgliedschaft, wird die Änderung mit 409 `LAST_OWNER_PROTECTED` abgewiesen. Die Prüfung läuft in derselben Transaktion wie das Update, mit `SELECT … FOR UPDATE` auf der Zielzeile, damit zwei gleichzeitige Anfragen nicht beide den jeweils anderen Owner für „den zweiten" halten.

2. **Niemand ändert die eigene Mitgliedschaft über diesen Endpunkt** — weder Rolle noch Status, in keine Richtung. Begründung: „nach unten" ist im Berechtigungsmodell nicht sauber definiert. `SCORER` hat `match:score`, `MEMBER` hat es nicht, `MEMBER` hat dafür nichts, was `SCORER` fehlt — es gibt keine totale Ordnung, an der sich „Herabstufung" festmachen liesse. Ein Verbot der Selbständerung ist dagegen exakt, in einer Zeile prüfbar und schliesst die Selbstaussperrung vollständig aus, nicht nur für `OWNER`. Es sperrt auch niemanden aus: Regel 1 garantiert, dass immer mindestens ein aktiver `OWNER` übrig ist, und der hat `organization:manage_roles`. Wer die eigene Rolle abgeben will, bittet ihn darum. Antwort: 403 `SELF_MEMBERSHIP_CHANGE_FORBIDDEN`.

3. **`OWNER` darf vergeben werden, aber nur von einem `OWNER`.** Das Body-Schema lässt `role: "OWNER"` zu (`organizationRoleSchema`, nicht `invitableOrganizationRoleSchema` — der Einladungspfad bleibt davon unberührt und schliesst `OWNER` weiterhin aus). Der Service erlaubt die Vergabe jedoch nur, wenn die handelnde Person selbst eine aktive `OWNER`-Mitgliedschaft **derselben** Organisation hat; sonst 403 `OWNER_GRANT_REQUIRES_OWNER`. Ein `ADMIN` hat `organization:manage_roles` und darf damit jede andere Rolle vergeben — aber kein Eigentum. Begründung: ohne diesen Weg friert Regel 1 das Eigentum ein. Der einzige Owner ist geschützt, ein zweiter lässt sich nicht ernennen, und ein Vorstandswechsel wäre nur noch mit einem manuellen `UPDATE` auf der Produktionsdatenbank möglich — genau der Ausweg, den AGENTS.md §21 verbietet und den I-4 abschaffen soll. Die Rolle der handelnden Person liefert `OrganizationAccessService.requirePermission` bereits als Rückgabewert; es braucht keine zweite Abfrage. Der Wechsel wird wie jeder Rollenwechsel als `USER_ROLE_CHANGED` auditiert, mit alter und neuer Rolle in `oldValue`/`newValue`.

4. **Deaktiviert wird mit `SUSPENDED`, nicht mit `INACTIVE`.** Die Prüfbedingung `memberships_status_check` (`packages/database/src/schema.ts:161-164`) lässt genau `INVITED`, `ACTIVE`, `SUSPENDED` zu. `SUSPENDED` ist damit der vorhandene Zustand für den Entzug und braucht keine Migration. `getActiveMembership` verlangt `ACTIVE` und entzieht damit sofort alle Rechte.

5. **Audit.** Ändert sich die Rolle, entsteht `USER_ROLE_CHANGED` (ARCHITECTURE §30). Ändert sich der Status, entsteht `MEMBER_DEACTIVATED` beziehungsweise `MEMBER_REACTIVATED`. Ändern sich beide, entstehen beide Einträge — in derselben Transaktion wie das Update. `entityType` ist `Membership`, `entityId` die `memberships.id`, `oldValue`/`newValue` tragen genau das geänderte Feld.

- [ ] **Step 1: Den fehlschlagenden Schema-Test schreiben**

In `packages/schemas/src/organization.spec.ts` ergänzen:

```ts
import {
  createInvitationSchema,
  invitationSchema,
  organizationMemberSchema,
  updateMembershipSchema,
} from "./organization.js";

it("verlangt mindestens eine Aenderung an der Mitgliedschaft", () => {
  expect(updateMembershipSchema.safeParse({}).success).toBe(false);
  expect(updateMembershipSchema.safeParse({ role: "SCORER" }).success).toBe(true);
  expect(updateMembershipSchema.safeParse({ status: "SUSPENDED" }).success).toBe(true);
});

it("laesst die Rolle OWNER durch das Schema, damit Eigentum uebertragbar bleibt", () => {
  // Wer OWNER tatsaechlich vergeben darf, entscheidet der Service — nicht das
  // Schema. Der Einladungspfad bleibt davon unberuehrt.
  expect(updateMembershipSchema.safeParse({ role: "OWNER" }).success).toBe(true);
  expect(createInvitationSchema.safeParse({ email: "a@example.ch", role: "OWNER" }).success).toBe(
    false,
  );
});

it("kennt als setzbaren Status nur ACTIVE und SUSPENDED", () => {
  expect(updateMembershipSchema.safeParse({ status: "INVITED" }).success).toBe(false);
});

it("gibt eine Mitgliedschaft mit Rolle und Status zurueck", () => {
  const member = organizationMemberSchema.parse({
    userId: crypto.randomUUID(),
    email: "mitglied@example.ch",
    displayName: "Mitglied",
    role: "SCORER",
    status: "SUSPENDED",
  });

  expect(member.status).toBe("SUSPENDED");
});
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `pnpm --filter @darts-platform/schemas test`
Expected: FAIL mit `does not provide an export named 'updateMembershipSchema'`.

- [ ] **Step 3: Die Schemas schreiben**

In `packages/schemas/src/organization.ts` nach `invitableOrganizationRoleSchema` einfügen:

```ts
/** Alle Zustaende, die die Datenbank kennt (`memberships_status_check`). */
export const membershipStatusSchema = z.enum(["INVITED", "ACTIVE", "SUSPENDED"]);

/**
 * Was ueber die API gesetzt werden darf. `INVITED` entsteht ausschliesslich
 * im Einladungspfad und wird nicht von Hand vergeben.
 */
export const assignableMembershipStatusSchema = z.enum(["ACTIVE", "SUSPENDED"]);
```

und am Ende der Schema-Definitionen, vor den Typ-Exporten:

```ts
export const organizationMemberSchema = z.object({
  userId: z.uuid(),
  email: z.email(),
  displayName: z.string(),
  role: organizationRoleSchema,
  status: membershipStatusSchema,
});

/**
 * `OWNER` ist hier zugelassen, damit Eigentum uebertragbar bleibt — ein
 * Vorstandswechsel darf nicht am Schema scheitern. Wer OWNER vergeben darf,
 * entscheidet der Service: nur eine handelnde Person, die selbst aktiver
 * OWNER derselben Organisation ist. Der Einladungspfad
 * (`createInvitationSchema`) schliesst OWNER weiterhin aus.
 */
export const updateMembershipSchema = z
  .object({
    role: organizationRoleSchema.optional(),
    status: assignableMembershipStatusSchema.optional(),
  })
  .refine((value) => value.role !== undefined || value.status !== undefined, {
    message: "either role or status must be given",
  });
```

Bei den Typ-Exporten ergänzen:

```ts
export type MembershipStatusValue = z.infer<typeof membershipStatusSchema>;
export type OrganizationMember = z.infer<typeof organizationMemberSchema>;
export type UpdateMembershipInput = z.infer<typeof updateMembershipSchema>;
```

In `packages/schemas/src/index.ts` im `./organization`-Block ergänzen (alphabetisch):

```ts
  assignableMembershipStatusSchema,
  membershipStatusSchema,
  organizationMemberSchema,
  updateMembershipSchema,
```

```ts
  type MembershipStatusValue,
  type OrganizationMember,
  type UpdateMembershipInput,
```

- [ ] **Step 4: Schema-Test laufen lassen und Grün bestätigen**

Run: `pnpm --filter @darts-platform/schemas test`
Expected: PASS.

- [ ] **Step 5: `isMembershipStatus` im Domain-Paket ergänzen**

In `packages/domain/src/membership.ts` nach `membershipStatuses`:

```ts
export function isMembershipStatus(value: string): value is MembershipStatus {
  return membershipStatuses.some((status) => status === value);
}
```

In `packages/domain/src/index.ts` im `./membership`-Block:

```ts
export {
  membershipStatuses,
  isMembershipStatus,
  isOrganizationRole,
  organizationRoles,
  playerStatuses,
  type MembershipStatus,
  type OrganizationRole,
  type PlayerStatus,
} from "./membership";
```

- [ ] **Step 6: Den fehlschlagenden Integrationstest schreiben**

`apps/api/src/organizations/memberships.integration.spec.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  auditEvents,
  memberships,
  organizations,
  users,
} from "@darts-platform/database";

import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { OrganizationAccessService } from "./organization-access.service.js";
import { OrganizationsRepository } from "./organizations.repository.js";
import { OrganizationsService } from "./organizations.service.js";

const environment = parseApplicationEnvironment(process.env);
const databaseService = new DatabaseService(environment);
const repository = new OrganizationsRepository(databaseService);
const access = new OrganizationAccessService(repository);
const service = new OrganizationsService(repository, access, environment);

const organizationId = randomUUID();
const foreignOrganizationId = randomUUID();
const ownerUserId = randomUUID();
// Startet als MEMBER und wird im Test ueber die API zum zweiten OWNER
// ernannt — der Eigentumswechsel laeuft damit ueber denselben Weg wie in der
// Produktion, nicht ueber einen Direkteintrag in der Datenbank.
const successorUserId = randomUUID();
// Handelt in den meisten Faellen: ADMIN mit `organization:manage_roles`,
// bleibt durchgehend aktiv.
const managerUserId = randomUUID();
// Reines Ziel der Deaktivierung; nach Fall 2 ist diese Person gesperrt und
// wird danach nicht mehr als handelnde Person verwendet.
const adminUserId = randomUUID();
const scorerUserId = randomUUID();
const viewerUserId = randomUUID();
const foreignUserId = randomUUID();

function authFor(userId: string, name: string): AuthContext {
  return {
    user: { id: userId, email: `${name}-${userId}@example.test`, name },
    session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
  };
}

const ownerAuth = authFor(ownerUserId, "owner");
const successorAuth = authFor(successorUserId, "successor");
const managerAuth = authFor(managerUserId, "manager");
const adminAuth = authFor(adminUserId, "admin");
const viewerAuth = authFor(viewerUserId, "viewer");
const audit = {
  correlationId: randomUUID(),
  ip: "127.0.0.1",
  userAgent: "vitest",
} as const;

beforeAll(async () => {
  await databaseService.database.insert(users).values([
    { id: ownerUserId, email: ownerAuth.user.email, displayName: "Owner" },
    { id: successorUserId, email: successorAuth.user.email, displayName: "Nachfolge" },
    { id: managerUserId, email: managerAuth.user.email, displayName: "Manager" },
    { id: adminUserId, email: adminAuth.user.email, displayName: "Admin" },
    { id: scorerUserId, email: `scorer-${scorerUserId}@example.test`, displayName: "Scorer" },
    { id: viewerUserId, email: viewerAuth.user.email, displayName: "Viewer" },
    { id: foreignUserId, email: `foreign-${foreignUserId}@example.test`, displayName: "Fremde Person" },
  ]);
  await databaseService.database.insert(organizations).values([
    { id: organizationId, name: "Mitglieder Club", slug: `members-${organizationId}`, timezone: "Europe/Zurich", locale: "de-CH" },
    { id: foreignOrganizationId, name: "Fremder Club", slug: `foreign-members-${foreignOrganizationId}`, timezone: "Europe/Zurich", locale: "de-CH" },
  ]);
  await databaseService.database.insert(memberships).values([
    { organizationId, userId: ownerUserId, role: "OWNER", status: "ACTIVE" },
    { organizationId, userId: successorUserId, role: "MEMBER", status: "ACTIVE" },
    { organizationId, userId: managerUserId, role: "ADMIN", status: "ACTIVE" },
    { organizationId, userId: adminUserId, role: "ADMIN", status: "ACTIVE" },
    { organizationId, userId: scorerUserId, role: "SCORER", status: "ACTIVE" },
    { organizationId, userId: viewerUserId, role: "VIEWER", status: "ACTIVE" },
    { organizationId: foreignOrganizationId, userId: foreignUserId, role: "ADMIN", status: "ACTIVE" },
  ]);
});

afterAll(async () => {
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(organizations).where(eq(organizations.id, foreignOrganizationId));
  for (const userId of [ownerUserId, successorUserId, managerUserId, adminUserId, scorerUserId, viewerUserId, foreignUserId]) {
    await databaseService.database.delete(users).where(eq(users.id, userId));
  }
  await databaseService.onApplicationShutdown();
});

describe("Mitgliedschaften verwalten", () => {
  it("aendert eine Rolle und auditiert den Wechsel", async () => {
    const member = await service.updateMembership({
      organizationId,
      targetUserId: scorerUserId,
      data: { role: "MEMBER" },
      auth: ownerAuth,
      audit,
    });

    expect(member).toMatchObject({ userId: scorerUserId, role: "MEMBER", status: "ACTIVE" });
    expect(await repository.getActiveMembership({ organizationId, userId: scorerUserId })).toEqual({
      role: "MEMBER",
    });

    const events = await databaseService.database
      .select({ action: auditEvents.action, oldValue: auditEvents.oldValue, newValue: auditEvents.newValue })
      .from(auditEvents)
      .where(and(eq(auditEvents.organizationId, organizationId), eq(auditEvents.action, "USER_ROLE_CHANGED")));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ oldValue: { role: "SCORER" }, newValue: { role: "MEMBER" } });
  }, 30_000);

  it("entzieht den Zugriff und auditiert die Deaktivierung", async () => {
    const member = await service.updateMembership({
      organizationId,
      targetUserId: adminUserId,
      data: { status: "SUSPENDED" },
      auth: ownerAuth,
      audit,
    });

    expect(member.status).toBe("SUSPENDED");
    expect(await repository.getActiveMembership({ organizationId, userId: adminUserId })).toBeNull();

    const events = await databaseService.database
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(and(eq(auditEvents.organizationId, organizationId), eq(auditEvents.action, "MEMBER_DEACTIVATED")));
    expect(events).toHaveLength(1);
  }, 30_000);

  it("schuetzt den letzten aktiven OWNER vor Herabstufung und Deaktivierung", async () => {
    await expect(
      service.updateMembership({
        organizationId,
        targetUserId: ownerUserId,
        data: { role: "ADMIN" },
        auth: managerAuth,
        audit,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      service.updateMembership({
        organizationId,
        targetUserId: ownerUserId,
        data: { status: "SUSPENDED" },
        auth: managerAuth,
        audit,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(await repository.getActiveMembership({ organizationId, userId: ownerUserId })).toEqual({
      role: "OWNER",
    });
  }, 30_000);

  it("laesst ADMIN kein Eigentum vergeben und schreibt dabei nichts", async () => {
    try {
      await service.updateMembership({
        organizationId,
        targetUserId: successorUserId,
        data: { role: "OWNER" },
        auth: managerAuth,
        audit,
      });
      throw new Error("Die Vergabe hätte abgewiesen werden müssen.");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ForbiddenException);
      const response = (error as ForbiddenException).getResponse();
      expect(response).toMatchObject({ code: "OWNER_GRANT_REQUIRES_OWNER" });
    }

    // Keine Schreibwirkung: weder Rolle noch Audit-Eintrag.
    expect(await repository.getActiveMembership({ organizationId, userId: successorUserId })).toEqual({
      role: "MEMBER",
    });
    const events = await databaseService.database
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, organizationId),
          eq(auditEvents.actorUserId, managerUserId),
        ),
      );
    expect(events).toHaveLength(0);
  }, 30_000);

  it("laesst OWNER das Eigentum uebertragen und danach den bisherigen OWNER herabstufen", async () => {
    const successor = await service.updateMembership({
      organizationId,
      targetUserId: successorUserId,
      data: { role: "OWNER" },
      auth: ownerAuth,
      audit,
    });

    expect(successor.role).toBe("OWNER");
    expect(await repository.getActiveMembership({ organizationId, userId: successorUserId })).toEqual({
      role: "OWNER",
    });

    // Erst jetzt greift der Schutz des letzten OWNER nicht mehr.
    const former = await service.updateMembership({
      organizationId,
      targetUserId: ownerUserId,
      data: { role: "ADMIN" },
      auth: successorAuth,
      audit,
    });

    expect(former.role).toBe("ADMIN");

    const roleChanges = await databaseService.database
      .select({ oldValue: auditEvents.oldValue, newValue: auditEvents.newValue })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, organizationId),
          eq(auditEvents.action, "USER_ROLE_CHANGED"),
        ),
      );
    expect(roleChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ oldValue: { role: "MEMBER" }, newValue: { role: "OWNER" } }),
        expect.objectContaining({ oldValue: { role: "OWNER" }, newValue: { role: "ADMIN" } }),
      ]),
    );
  }, 30_000);

  it("weist eine Mitgliedschaft aus einer fremden Organisation ab", async () => {
    await expect(
      service.updateMembership({
        organizationId,
        targetUserId: foreignUserId,
        data: { role: "MEMBER" },
        auth: successorAuth,
        audit,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const untouched = await databaseService.database
      .select({ role: memberships.role })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, foreignOrganizationId),
          eq(memberships.userId, foreignUserId),
        ),
      );
    expect(untouched[0]).toEqual({ role: "ADMIN" });
  }, 30_000);

  it("weist VIEWER ab", async () => {
    await expect(
      service.updateMembership({
        organizationId,
        targetUserId: scorerUserId,
        data: { role: "SCORER" },
        auth: viewerAuth,
        audit,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  }, 30_000);

  it("laesst niemanden die eigene Mitgliedschaft aendern", async () => {
    await expect(
      service.updateMembership({
        organizationId,
        targetUserId: successorUserId,
        data: { role: "ADMIN" },
        auth: successorAuth,
        audit,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  }, 30_000);
});
```

- [ ] **Step 7: Test laufen lassen und Fehlschlag bestätigen**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/organizations/memberships.integration.spec.ts`
Expected: FAIL — `service.updateMembership` existiert nicht.

- [ ] **Step 8: Die Repository-Funktion schreiben**

In `apps/api/src/organizations/organizations.repository.ts` die Imports erweitern:

```ts
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gt, ne } from "drizzle-orm";

import {
  auditEvents,
  memberships,
  organizationInvitations,
  organizations,
  users,
} from "@darts-platform/database";
import {
  isMembershipStatus,
  isOrganizationRole,
  type MembershipStatus,
  type OrganizationRole,
} from "@darts-platform/domain";
import type {
  CreateInvitationInput,
  CreateOrganizationInput,
  OrganizationMember,
} from "@darts-platform/schemas";
```

Über der Klasse den Ergebnistyp:

```ts
export type UpdateMembershipResult =
  | { readonly outcome: "updated"; readonly member: OrganizationMember }
  | { readonly outcome: "not-found" }
  | { readonly outcome: "last-owner" };
```

Und als letzte Methode der Klasse:

```ts
  /**
   * Setzt Rolle und/oder Status einer Mitgliedschaft. Lesen, Pruefen,
   * Schreiben und Auditieren liegen in einer Transaktion; die Zielzeile wird
   * mit `FOR UPDATE` gesperrt, damit zwei gleichzeitige Anfragen nicht beide
   * den jeweils anderen OWNER fuer den verbleibenden halten.
   */
  public async updateMembership(input: {
    readonly organizationId: string;
    readonly targetUserId: string;
    readonly role?: OrganizationRole;
    readonly status?: MembershipStatus;
    readonly actorUserId: string;
    readonly audit: AuditContext;
  }): Promise<UpdateMembershipResult> {
    return this.databaseService.database.transaction(async (transaction) => {
      const [current] = await transaction
        .select({
          id: memberships.id,
          role: memberships.role,
          status: memberships.status,
          email: users.email,
          displayName: users.displayName,
        })
        .from(memberships)
        .innerJoin(users, eq(memberships.userId, users.id))
        .where(
          and(
            eq(memberships.organizationId, input.organizationId),
            eq(memberships.userId, input.targetUserId),
          ),
        )
        .limit(1)
        .for("update");

      if (current === undefined) {
        return { outcome: "not-found" };
      }

      if (!isOrganizationRole(current.role) || !isMembershipStatus(current.status)) {
        throw new Error("The stored membership carries an unknown role or status.");
      }

      const nextRole: OrganizationRole = input.role ?? current.role;
      const nextStatus: MembershipStatus = input.status ?? current.status;
      const losesOwnerAccess =
        current.role === "OWNER" &&
        current.status === "ACTIVE" &&
        (nextRole !== "OWNER" || nextStatus !== "ACTIVE");

      if (losesOwnerAccess) {
        const [remainingOwner] = await transaction
          .select({ userId: memberships.userId })
          .from(memberships)
          .where(
            and(
              eq(memberships.organizationId, input.organizationId),
              eq(memberships.role, "OWNER"),
              eq(memberships.status, "ACTIVE"),
              ne(memberships.userId, input.targetUserId),
            ),
          )
          .limit(1);

        if (remainingOwner === undefined) {
          return { outcome: "last-owner" };
        }
      }

      await transaction
        .update(memberships)
        .set({ role: nextRole, status: nextStatus })
        .where(
          and(
            eq(memberships.organizationId, input.organizationId),
            eq(memberships.userId, input.targetUserId),
          ),
        );

      if (nextRole !== current.role) {
        await transaction.insert(auditEvents).values({
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: "USER_ROLE_CHANGED",
          entityType: "Membership",
          entityId: current.id,
          oldValue: { role: current.role },
          newValue: { role: nextRole },
          ip: input.audit.ip,
          userAgent: input.audit.userAgent,
          correlationId: input.audit.correlationId,
        });
      }

      if (nextStatus !== current.status) {
        await transaction.insert(auditEvents).values({
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: nextStatus === "ACTIVE" ? "MEMBER_REACTIVATED" : "MEMBER_DEACTIVATED",
          entityType: "Membership",
          entityId: current.id,
          oldValue: { status: current.status },
          newValue: { status: nextStatus },
          ip: input.audit.ip,
          userAgent: input.audit.userAgent,
          correlationId: input.audit.correlationId,
        });
      }

      return {
        outcome: "updated",
        member: {
          userId: input.targetUserId,
          email: current.email,
          displayName: current.displayName,
          role: nextRole,
          status: nextStatus,
        },
      };
    });
  }
```

- [ ] **Step 9: Die Service-Methode schreiben**

In `apps/api/src/organizations/organizations.service.ts` die Imports erweitern:

```ts
import {
  createdInvitationSchema,
  invitationListSchema,
  organizationListSchema,
  organizationMemberSchema,
  organizationSummarySchema,
  type AcceptInvitationInput,
  type CreateInvitationInput,
  type CreateOrganizationInput,
  type CreatedInvitation,
  type Invitation,
  type OrganizationMember,
  type OrganizationSummary,
  type UpdateMembershipInput,
} from "@darts-platform/schemas";
```

und als neue Methode am Ende der Klasse:

```ts
  public async updateMembership(input: {
    readonly organizationId: string;
    readonly targetUserId: string;
    readonly data: UpdateMembershipInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<OrganizationMember> {
    // `requirePermission` liefert die Rolle der handelnden Person zurueck —
    // die wird gleich fuer die Eigentumsuebertragung gebraucht, ohne dass
    // eine zweite Abfrage noetig waere.
    const actorRole = await this.organizationAccessService.requirePermission({
      organizationId: input.organizationId,
      userId: input.auth.user.id,
      permission: "organization:manage_roles",
    });

    // Die eigene Mitgliedschaft bleibt aussen vor. „Herabstufung" ist im
    // Rollenmodell nicht total geordnet (SCORER und MEMBER lassen sich nicht
    // vergleichen); ein Verbot der Selbstaenderung ist dagegen exakt und
    // schliesst die Selbstaussperrung vollstaendig aus. Regel: es bleibt
    // immer ein aktiver OWNER, der die Aenderung vornehmen kann.
    if (input.targetUserId === input.auth.user.id) {
      throw new ForbiddenException({
        code: "SELF_MEMBERSHIP_CHANGE_FORBIDDEN",
        message: "Your own membership is changed by another administrator.",
      });
    }

    // Eigentum vergibt nur Eigentum. `ADMIN` traegt zwar
    // `organization:manage_roles` und darf jede andere Rolle setzen, aber
    // sich nicht selbst zum Miteigentuemer machen, indem er einen Vertrauten
    // zum OWNER ernennt. Die Uebertragung selbst bleibt moeglich — sonst
    // waere ein Vorstandswechsel nur noch mit einem manuellen UPDATE auf der
    // Produktionsdatenbank machbar (AGENTS.md §21).
    if (input.data.role === "OWNER" && actorRole !== "OWNER") {
      throw new ForbiddenException({
        code: "OWNER_GRANT_REQUIRES_OWNER",
        message: "Only an active owner can grant the owner role.",
      });
    }

    const result = await this.organizationsRepository.updateMembership({
      organizationId: input.organizationId,
      targetUserId: input.targetUserId,
      actorUserId: input.auth.user.id,
      audit: input.audit,
      ...(input.data.role === undefined ? {} : { role: input.data.role }),
      ...(input.data.status === undefined ? {} : { status: input.data.status }),
    });

    switch (result.outcome) {
      case "not-found":
        throw new NotFoundException(
          "This membership does not exist in this organization.",
        );
      case "last-owner":
        throw new ConflictException({
          code: "LAST_OWNER_PROTECTED",
          message: "The last active owner cannot be demoted or deactivated.",
        });
      case "updated":
        return organizationMemberSchema.parse(result.member);
    }
  }
```

- [ ] **Step 10: Test laufen lassen und Grün bestätigen**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/organizations/memberships.integration.spec.ts`
Expected: PASS, 8/8.

- [ ] **Step 10a: Die drei Fehlercodes in den Web-Fehlerkatalog aufnehmen**

Die Codes verlassen die API, sobald irgendein Client den Endpunkt anspricht — der Katalog wird deshalb jetzt gefüllt, auch wenn dieser Plan noch keine Oberfläche dafür baut. In `apps/web/src/lib/api-client.ts`, in `localizedMessage` bei den übrigen Einträgen:

```ts
    LAST_OWNER_PROTECTED:
      "Die letzte Eigentümerin oder der letzte Eigentümer kann weder herabgestuft noch deaktiviert werden. Ernenne zuerst eine zweite Person.",
    OWNER_GRANT_REQUIRES_OWNER:
      "Nur eine aktive Eigentümerin oder ein aktiver Eigentümer kann Eigentum übertragen.",
    SELF_MEMBERSHIP_CHANGE_FORBIDDEN:
      "Die eigene Mitgliedschaft ändert eine andere verwaltende Person.",
```

- [ ] **Step 11: Den Controller ergänzen**

In `apps/api/src/organizations/organizations.controller.ts` die Imports erweitern:

```ts
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
```

```ts
import {
  createInvitationSchema,
  createOrganizationSchema,
  updateMembershipSchema,
  type CreateInvitationInput,
  type CreateOrganizationInput,
  type CreatedInvitation,
  type OrganizationMember,
  type OrganizationSummary,
  type UpdateMembershipInput,
} from "@darts-platform/schemas";
```

und als letzte Route:

```ts
  @Patch(":organizationId/members/:userId")
  public async updateMember(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("userId", ParseUUIDPipe) userId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<OrganizationMember> {
    const data: UpdateMembershipInput = parseBody(updateMembershipSchema, body);
    return this.organizationsService.updateMembership({
      organizationId,
      targetUserId: userId,
      data,
      auth,
      audit: getAuditContext(request),
    });
  }
```

- [ ] **Step 12: Die Route über die echte Anwendung prüfen**

An `apps/api/src/organizations/memberships.integration.spec.ts` einen letzten Fall anhängen, der bestätigt, dass die Route existiert und ohne Anmeldung nicht erreichbar ist:

```ts
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

import { createApiTestApplication } from "../testing/api-harness.js";

describe("PATCH /organizations/:organizationId/members/:userId", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApiTestApplication();
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it("verlangt eine Anmeldung", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/organizations/${organizationId}/members/${scorerUserId}`,
      payload: { role: "MEMBER" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
  }, 30_000);
});
```

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/organizations/memberships.integration.spec.ts`
Expected: PASS, 9/9.

- [ ] **Step 13: Vollständige Prüfung**

```bash
pnpm lint
pnpm typecheck
pnpm test
```
Expected: alle drei grün.

- [ ] **Step 14: Commit**

```bash
git add packages/domain/src/membership.ts packages/domain/src/index.ts packages/schemas/src/organization.ts packages/schemas/src/organization.spec.ts packages/schemas/src/index.ts apps/api/src/organizations/organizations.repository.ts apps/api/src/organizations/organizations.service.ts apps/api/src/organizations/organizations.controller.ts apps/api/src/organizations/memberships.integration.spec.ts apps/web/src/lib/api-client.ts
git commit -m "feat(api): Mitgliedsrollen aendern, Eigentum uebertragen und Zugriff entziehen"
```

---

### Task 8: Abschluss des Plans

**Files:** keine neuen; nur Prüfläufe und gegebenenfalls Korrekturen.

**Interfaces:** —

- [ ] **Step 1: Die vollständige Prüfkette laufen lassen**

```bash
pnpm lint
pnpm typecheck
pnpm test
NODE_ENV=production pnpm build
```
Expected: alle vier grün. `NODE_ENV=production` ist beim Build zwingend — ohne die Variable bricht der Next.js-Prerender mit einem irreführenden React-Fehler ab.

- [ ] **Step 2: Die E2E-Suite laufen lassen**

```bash
pnpm test:e2e
```
Expected: grün, ein Worker. Bricht ein Fall mit 403 bei „Organisation erstellen" ab, fehlt `ALLOW_SELF_SERVICE_ORGANIZATIONS=true` im `env`-Block des API-Servers in `apps/web/playwright.config.ts` (Task 5, Step 11). Bricht ein Fall mit 429 ab, fehlen die drei Rate-Limit-Werte im selben Block (Task 4, Step 8).

- [ ] **Step 3: Den lokalen Entwicklungsstand prüfen**

Wer lokal mit dem Formular „Organisation erstellen" arbeitet, ergänzt die eigene `.env` um `ALLOW_SELF_SERVICE_ORGANIZATIONS=true`. Ohne den Eintrag greift die Vorgabe `false`, und das Formular zeigt den Hinweis aus Task 5 — das ist das gewollte Verhalten, kein Fehler.

- [ ] **Step 4: Commit, falls die Prüfläufe noch etwas verändert haben**

```bash
git status --short
```
Ist etwas offen, mit einem passenden Conventional Commit abschliessen (deutscher Betreff, kein `Co-Authored-By`-Trailer). Ist nichts offen, ist der Plan fertig.

---

## Self-Review

**1. Spec-Abdeckung.** Die fünf Befunde, die dieser Plan tragen soll:

| Befund | Task | Abdeckung |
| --- | --- | --- |
| I-5 Security Headers | 1, 2 | API: helmet mit HSTS, `nosniff`, Referrer-Policy, CORP, `X-Frame-Options`; Web: `headers()` mit CSP-Report-Only, HSTS, `nosniff`, Referrer- und Permissions-Policy. Tests: `inject` auf `/api/v1/health`, Playwright auf `/`. Versionswahl gegen die installierte Fastify-Version begründet. |
| I-6 Rate Limiting | 3, 4 | Better Auth `rateLimit` mit `customRules` für `/sign-in/email` und `/sign-up/email` und Redis-`customStorage`; `@fastify/rate-limit` global moderat, enge Regel auf `POST /organizations/:id/invitations`, `POST /invitations/:id/accept` und die Auth-Routen, eigene Grenze für `/public/**`. Test: 429 im einheitlichen Fehlerformat; Filter um `TOO_MANY_REQUESTS` ergänzt. Testumgebung: Grenzen sind Umgebungswerte, der Test überschreibt sie über das Harness, Playwright setzt sie hoch. |
| I-3 `POST /organizations` | 5 | `ALLOW_SELF_SERVICE_ORGANIZATIONS`, Zod-validiert in `packages/config/src/environment.ts`, Vorgabe `false`; 403 mit `SELF_SERVICE_ORGANIZATIONS_DISABLED`; Integrationstest für beide Stellungen; der Web-Pfad in `tenant-dashboard.tsx` reagiert ehrlich. |
| I-1a öffentliche Projektion | 6 | `organizationId`, `conflicts` und `blockedReason` fallen aus Schema **und** Projektion; die Live-Komponenten wurden geprüft und lesen keins der drei; `public_id` und Sichtbarkeits-Flag ausdrücklich ausgeklammert. |
| I-4 Zugriff entziehen | 7 | `PATCH /organizations/:organizationId/members/:userId`, Zod-Body, `organization:manage_roles`, letzter aktiver OWNER geschützt, Selbständerung verboten und begründet, Eigentumsübertragung nur durch einen aktiven OWNER (`OWNER_GRANT_REQUIRES_OWNER`), Audit in derselben Transaktion, Repository mit explizitem `organizationId`, die sechs geforderten Testfälle plus die zwei Eigentumsfälle plus Auth-Prüfung. Kein UI — ausdrücklich vermerkt. |

M-6 ist in Task 3 mitgenommen. M-7 löst sich mit Task 7 auf. I-2, I-7, I-1b und M-1 sind unter „Nicht in diesem Plan" mit Begründung gelistet. „Nicht mehr zutreffend" ist leer, mit Nachweis je Befund.

**2. Platzhalter.** Kein „TBD", kein „analog zu Task N", kein „Fehlerbehandlung ergänzen". Jeder Code-Schritt trägt den vollständigen Text. Die einzige Stelle, die auf bestehenden Datei-Kontext verweist, ist Task 6 Step 6 (`createTournament` und `organizationId` aus `tournaments.integration.spec.ts`) — dort ist das gewollt, weil der Fall in eine vorhandene Datei mit vorhandenem Aufbau eingefügt wird und ein zweiter Aufbau die Datei nur aufblähen würde.

**3. Typkonsistenz.** Durchgegangen und begradigt:
- `registerSecurityHeaders(app)` und `registerRateLimit(app, environment)` heissen in `main.ts`, im Harness und in beiden Tests gleich.
- `createApiTestApplication(overrides)` wird in Task 1 eingeführt, in Task 4 erweitert und in Task 7 Step 12 wiederverwendet — immer mit `await app.close()` im `afterAll`.
- `RateLimitStorage.consume` (Task 3) hat dieselbe Signatur wie `RedisService.consumeRateLimit` sie bedient: `{ allowed, retryAfter }`.
- `MembershipStatus` (Domain) und `membershipStatusSchema` (Schemas) decken beide `INVITED | ACTIVE | SUSPENDED`; gesetzt werden darf nur `ACTIVE | SUSPENDED` über `assignableMembershipStatusSchema`. `INACTIVE` kommt nirgends vor — die Prüfbedingung der Tabelle kennt es nicht.
- `UpdateMembershipResult` ist in Task 7 Step 8 definiert und in Step 9 exhaustiv abgearbeitet; alle drei Zweige kehren zurück oder werfen.
- `updateMembershipSchema.role` nutzt `organizationRoleSchema` (mit `OWNER`); `createInvitationSchema.role` bleibt bei `invitableOrganizationRoleSchema` (ohne `OWNER`). Beide Schemas stehen in derselben Datei — der Unterschied ist gewollt und im Schema-Kommentar wie im Schema-Test festgehalten.
- Die Testpersonen in `memberships.integration.spec.ts` sind so verteilt, dass niemand nach seiner eigenen Deaktivierung noch handelt: `managerUserId` (ADMIN) handelt durchgehend, `adminUserId` ist nur Ziel der Deaktivierung, `successorUserId` startet als `MEMBER` und wird über die API zum `OWNER` ernannt. Der zweite Owner entsteht damit auf demselben Weg wie in der Produktion statt per Direkteintrag in die Datenbank — der frühere Direkteintrag ist ersatzlos entfallen, weil er genau den Pfad übersprungen hätte, den die neue Regel absichert.
- `OrganizationsService` bekommt seinen dritten Konstruktor-Parameter in Task 5; die beiden bestehenden Testdateien, die den Service von Hand bauen, werden im selben Task nachgezogen.
- `PublicBoardSlot` heisst in `packages/schemas` und in `live-tournament.tsx` gleich.
