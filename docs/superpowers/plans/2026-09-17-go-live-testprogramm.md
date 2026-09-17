# Go-Live-Testprogramm – Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Blöcke A bis D der Spec als lauffähige Tests, Messläufe und
Protokolle umsetzen, sodass am Ende ein Abnahmeprotokoll die Freigabe für den
Szenario-Test unter Realbedingungen (Block E) trägt.

**Architecture:** Neue Tests folgen den bestehenden Mustern: Engine-Tests als
Vitest-Specs neben dem Code, API-Prüfungen als `*.integration.spec.ts` über
`createApiTestApplication()` und `app.inject()`, Staging-Läufe als eigenes
Vitest-Projekt unter `apps/api/test/staging/` mit `fetch` und
`socket.io-client` gegen `STAGING_API_URL`. Codeänderungen an der Anwendung
gibt es nur dort, wo ein Befund es verlangt (Rate-Limit-Schlüssel) oder eine
Messung sonst unmöglich ist (Client-Adresse im Request-Log).

**Tech Stack:** TypeScript, Vitest 4 (Katalog `^4.0.0`), `@vitest/coverage-v8`,
NestJS 11 mit Fastify 5.12, `@fastify/rate-limit`, Playwright, Railway CLI.

**Spec:** `docs/superpowers/specs/2026-09-17-go-live-testprogramm-design.md`

## Global Constraints

- Alle Namen, Adressen und Werte in Tests sind fiktiv; E-Mail-Adressen enden
  auf `@example.test`.
- Keine Mutation an `production`; Production wird nur gelesen.
- `any` ist verboten; `unknown` mit Zod-Parsing.
- Jede tenant-bezogene Anfrage trägt `organizationId` explizit.
- Vor jedem Commit: `pnpm lint && pnpm typecheck` für das betroffene Paket;
  vor Abschluss einer Task: `pnpm test` im betroffenen Paket.
- Commits als Conventional Commits, kein `Co-Authored-By`-Trailer.
- Staging-Tests laufen nie in `pnpm test` mit; sie brauchen `STAGING_API_URL`
  und brechen ohne diese Variable mit einer klaren Meldung ab.
- Bekannte Blocker beim Schreiben dieses Plans (17.09.2026 abends):
  GitHub Actions startet keine Jobs (Billing), Railway `staging` wartet mit
  `checkSuites: true` auf Checks, die nicht kommen; die erste
  Staging-Organisation ist noch nicht per Bootstrap angelegt. Tasks, die
  Staging brauchen, sind entsprechend markiert und laufen erst danach.

---

## Dateistruktur

| Pfad | Verantwortung |
| --- | --- |
| `packages/scheduling-engine/src/readiness.rules.spec.ts` | Neu. Ein Test je READY-Regel aus AGENTS.md §9 für Match und Slot. |
| `apps/api/src/common/client-address.ts` | Neu. Eine Funktion, die die Client-Adresse aus `X-Real-IP` (hinter vertrautem Proxy) oder `request.ip` bestimmt. Einzige Quelle für Rate-Limit, Audit und Better-Auth-Header. |
| `apps/api/src/common/client-address.integration.spec.ts` | Neu. Prüft Schlüsselbildung mit und ohne vertrauten Hop, Spoof-Schutz. |
| `apps/api/src/common/rate-limit.ts` | Ändern: `keyGenerator` nutzt `resolveClientAddress`. |
| `apps/api/src/common/audit-context.ts` | Ändern: `ip` aus `resolveClientAddress`. |
| `apps/api/src/common/api-logging.interceptor.ts` | Ändern: Feld `clientAddress` im Request-Log. |
| `apps/api/src/auth/auth.controller.ts` | Ändern: `CLIENT_IP_HEADER` aus `resolveClientAddress`. |
| `apps/api/src/testing/route-inventory.ts` | Neu. Baut die App mit `onRoute`-Hook und liefert `{ method, url }[]`. |
| `apps/api/src/security/tenant-isolation-matrix.integration.spec.ts` | Neu. Alle Routen mit `:organizationId` gegen fremde Organisation. |
| `apps/api/src/security/permission-matrix.integration.spec.ts` | Neu. Je Permission eine Route, je Rolle erwartetes Ergebnis. |
| `apps/api/test/staging/vitest.config.mts` | Neu. Eigenes Vitest-Projekt, `include: ["**/*.staging.spec.ts"]`. |
| `apps/api/test/staging/staging-client.ts` | Neu. Login, Cookie, JSON-Aufrufe, Organisation/Spieler/Match anlegen. |
| `apps/api/test/staging/concurrency.staging.spec.ts` | Neu. A1, A2, A6. |
| `apps/api/test/staging/load.staging.spec.ts` | Neu. A3, A5 mit Messwerten als JSON. |
| `apps/api/test/staging/realtime.staging.spec.ts` | Neu. A4. |
| `apps/web/playwright.prod.config.ts` | Ändern: API-Server dazu, alle Specs gegen Produktivbuild. |
| `.github/workflows/ci.yml` | Ändern: Coverage-Artefakt, `test:e2e:prod`. |
| `docs/testing/protokolle/*.md` | Ergebnisse je Block. |
| `docs/testing/szenario-spieltag.md` | Vorlage für Block E. |
| `docs/testing/abnahmeprotokoll-go-live.md` | Gesamtstand, Freigabe. |

---

### Task 1: Coverage-Messung (Spec C1)

**Files:**
- Modify: `pnpm-workspace.yaml` (Katalog)
- Modify: `package.json` (Root-Skript), `turbo.json`
- Modify: `apps/api/package.json`, `apps/worker/package.json`, `apps/web/package.json`, `packages/*/package.json` (Skript + devDependency)
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: Root-Skript `pnpm test:coverage`, Ordner `coverage/` je Paket mit `coverage-summary.json`.

- [ ] **Step 1: Katalogeintrag und devDependency**

In `pnpm-workspace.yaml` unter `catalog:` ergänzen:

```yaml
  "@vitest/coverage-v8": ^4.0.0
```

In jeder `package.json` der Pakete `apps/api`, `apps/worker`, `apps/web`,
`packages/config`, `packages/database`, `packages/domain`,
`packages/league-engine`, `packages/scheduling-engine`, `packages/schemas`,
`packages/scoring-engine`, `packages/statistics`, `packages/tournament-engine`
unter `devDependencies`:

```json
"@vitest/coverage-v8": "catalog:"
```

und unter `scripts` (für `apps/web` mit `--dir src`):

```json
"test:coverage": "vitest run --coverage --coverage.provider=v8 --coverage.reporter=text --coverage.reporter=json-summary"
```

Dann `pnpm install`.

- [ ] **Step 2: Turbo-Task und Root-Skript**

`turbo.json`, neben `test`:

```json
"test:coverage": {
  "dependsOn": ["^build"],
  "outputs": ["coverage/**"],
  "env": ["DATABASE_URL", "REDIS_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "WEB_ORIGIN", "NEXT_PUBLIC_API_URL", "NODE_ENV"]
}
```

(Die `env`-Liste an die vorhandene `test`-Task angleichen; sie muss dieselben
Variablen tragen.) Root `package.json`:

```json
"test:coverage": "dotenv -e .env -- turbo run test:coverage"
```

- [ ] **Step 3: Lokal laufen lassen**

Run: `pnpm test:coverage`
Expected: jedes Paket schreibt `coverage/coverage-summary.json`; die
Textausgabe zeigt Zeilen-, Zweig- und Funktionsabdeckung.

- [ ] **Step 4: Zusammenfassung erzeugen**

Neues Skript `scripts/coverage-summary.mjs`:

```js
import { readFileSync, existsSync } from "node:fs";
import { globSync } from "node:fs";

const files = globSync("{apps,packages}/*/coverage/coverage-summary.json");
const rows = files.map((file) => {
  const total = JSON.parse(readFileSync(file, "utf8")).total;
  const pkg = file.split("/").slice(0, 2).join("/");
  return `| ${pkg} | ${total.lines.pct} | ${total.branches.pct} | ${total.functions.pct} |`;
});
console.log("| Paket | Zeilen % | Zweige % | Funktionen % |\n| --- | --- | --- | --- |");
console.log(rows.sort().join("\n"));
```

(`fs.globSync` gibt es ab Node 22; das Repo läuft auf Node 24.)

Run: `node scripts/coverage-summary.mjs`
Expected: Markdown-Tabelle mit einer Zeile je Paket.

- [ ] **Step 5: CI-Artefakt**

In `.github/workflows/ci.yml` nach dem Schritt `Test`:

```yaml
      - name: Coverage
        run: pnpm test:coverage && node scripts/coverage-summary.mjs >> "$GITHUB_STEP_SUMMARY"

      - name: Coverage-Berichte sichern
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: |
            apps/*/coverage/coverage-summary.json
            packages/*/coverage/coverage-summary.json
          retention-days: 14
```

- [ ] **Step 6: Tabelle ins Abnahmeprotokoll und committen**

Tabelle aus Step 4 in `docs/testing/abnahmeprotokoll-go-live.md` unter
«C1 Coverage» einfügen (Datei entsteht in Task 12, bis dahin lokal
zwischenhalten).

```bash
git add pnpm-workspace.yaml package.json turbo.json pnpm-lock.yaml scripts/coverage-summary.mjs .github/workflows/ci.yml apps/*/package.json packages/*/package.json
git commit -m "test: Coverage-Messung je Paket mit Bericht in der CI"
```

---

### Task 2: Scheduling-Engine je Regel ein Test (Spec C2)

**Files:**
- Create: `packages/scheduling-engine/src/readiness.rules.spec.ts`
- Read: `packages/scheduling-engine/src/readiness.ts`, `readiness.spec.ts`

**Interfaces:**
- Consumes: `evaluateMatchReadiness(input: MatchReadinessInput): MatchReadinessDecision`,
  `evaluateSlotReadiness(input: SlotReadinessInput): MatchReadinessDecision` aus `./readiness`.
  Codes: `READY`, `BLOCKED_PARTICIPANT_UNDECIDED`, `BLOCKED_PLAYER_BUSY`,
  `BLOCKED_NO_BOARD`, `BLOCKED_STAGE_NOT_OPEN`, `BLOCKED_MATCH_FINISHED`.

- [ ] **Step 1: Test schreiben – eine Regel pro Fall, Match**

```ts
import { describe, expect, it } from "vitest";

import {
  evaluateMatchReadiness,
  evaluateSlotReadiness,
  type MatchReadinessInput,
  type SlotReadinessInput,
} from "./readiness";

const readyMatch: MatchReadinessInput = {
  participantIds: ["p1", "p2"],
  activePlayerIds: new Set(),
  availableBoardCount: 1,
  matchStatus: "WAITING",
  tournamentStatus: "KNOCKOUT",
};

describe("AGENTS.md §9 – Match wird nur READY, wenn", () => {
  it("beide Teilnehmer bestimmt sind (Regel 1)", () => {
    const decision = evaluateMatchReadiness({ ...readyMatch, participantIds: ["p1", null] });
    expect(decision.ready).toBe(false);
    expect(decision.code).toBe("BLOCKED_PARTICIPANT_UNDECIDED");
    expect(decision.reason.length).toBeGreaterThan(0);
  });

  it("keiner der beiden gleichzeitig spielt (Regel 2 und 3)", () => {
    for (const busy of ["p1", "p2"]) {
      const decision = evaluateMatchReadiness({ ...readyMatch, activePlayerIds: new Set([busy]) });
      expect(decision.code).toBe("BLOCKED_PLAYER_BUSY");
    }
  });

  it("das Match nicht beendet ist (Regel 4)", () => {
    for (const status of ["COMPLETED", "CANCELLED"] as const) {
      expect(evaluateMatchReadiness({ ...readyMatch, matchStatus: status }).code).toBe("BLOCKED_MATCH_FINISHED");
    }
  });

  it("ein Board verfügbar ist (Regel 5)", () => {
    expect(evaluateMatchReadiness({ ...readyMatch, availableBoardCount: 0 }).code).toBe("BLOCKED_NO_BOARD");
  });

  it("der Turnierstatus den Start erlaubt (Regel 6)", () => {
    for (const status of ["READY", "COMPLETED"] as const) {
      expect(evaluateMatchReadiness({ ...readyMatch, tournamentStatus: status }).code).toBe("BLOCKED_STAGE_NOT_OPEN");
    }
  });

  it("alle Regeln erfüllt sind", () => {
    const decision = evaluateMatchReadiness(readyMatch);
    expect(decision).toMatchObject({ ready: true, code: "READY" });
  });

  it("die Ablehnung immer einen lesbaren Grund trägt", () => {
    const variants: MatchReadinessInput[] = [
      { ...readyMatch, participantIds: [null, null] },
      { ...readyMatch, activePlayerIds: new Set(["p1"]) },
      { ...readyMatch, availableBoardCount: 0 },
      { ...readyMatch, matchStatus: "COMPLETED" },
      { ...readyMatch, tournamentStatus: "READY" },
    ];
    for (const variant of variants) {
      const decision = evaluateMatchReadiness(variant);
      expect(decision.ready).toBe(false);
      expect(decision.reason).toMatch(/\S/u);
    }
  });
});
```

- [ ] **Step 2: Slot-Regeln (Liga) ergänzen**

Im selben File:

```ts
const readySlot: SlotReadinessInput = {
  sidePlayerIds: [["h1"], ["g1"]],
  requiredPlayersPerSide: 1,
  activePlayerIds: new Set(),
  boardAvailable: true,
  slotStatus: "WAITING",
  encounterStatus: "RUNNING",
};

describe("AGENTS.md §9 – Liga-Slot wird nur READY, wenn", () => {
  it("beide Seiten vollständig nominiert sind", () => {
    expect(evaluateSlotReadiness({ ...readySlot, sidePlayerIds: [["h1"], []] }).code).toBe("BLOCKED_PARTICIPANT_UNDECIDED");
    expect(evaluateSlotReadiness({ ...readySlot, requiredPlayersPerSide: 2, sidePlayerIds: [["h1", "h2"], ["g1"]] }).code).toBe("BLOCKED_PARTICIPANT_UNDECIDED");
  });

  it("niemand aus dem Slot gerade spielt", () => {
    expect(evaluateSlotReadiness({ ...readySlot, activePlayerIds: new Set(["g1"]) }).code).toBe("BLOCKED_PLAYER_BUSY");
  });

  it("der Slot nicht beendet, gewertet oder abgebrochen ist", () => {
    for (const status of ["COMPLETED", "WALKOVER", "CANCELLED", "IN_PROGRESS"] as const) {
      expect(evaluateSlotReadiness({ ...readySlot, slotStatus: status }).code).toBe("BLOCKED_MATCH_FINISHED");
    }
  });

  it("ein Board frei ist", () => {
    expect(evaluateSlotReadiness({ ...readySlot, boardAvailable: false }).code).toBe("BLOCKED_NO_BOARD");
  });

  it("die Begegnung läuft", () => {
    for (const status of ["DRAFT", "LINEUPS_OPEN", "READY", "COMPLETED", "CANCELLED"] as const) {
      expect(evaluateSlotReadiness({ ...readySlot, encounterStatus: status }).code).toBe("BLOCKED_STAGE_NOT_OPEN");
    }
  });

  it("alle Regeln erfüllt sind", () => {
    expect(evaluateSlotReadiness(readySlot)).toMatchObject({ ready: true, code: "READY" });
  });
});
```

- [ ] **Step 3: Laufen lassen**

Run: `pnpm --filter @darts-platform/scheduling-engine test`
Expected: alle Fälle grün. Schlägt ein Fall wegen eines anderen Codes fehl
(zum Beispiel `IN_PROGRESS` beim Slot), ist das ein Befund: Code gegen
`readiness.ts` lesen, entscheiden, ob der Test oder die Engine falsch liegt,
Entscheidung im Testkommentar festhalten. Die Engine wird nur geändert, wenn
AGENTS.md §9 verletzt ist.

- [ ] **Step 4: Commit**

```bash
git add packages/scheduling-engine/src/readiness.rules.spec.ts
git commit -m "test(scheduling-engine): je eine READY-Regel aus AGENTS.md §9 als eigener Fall"
```

---

### Task 3: Client-Adresse hinter Railway (Spec D3, Befund D3-1)

Hintergrund: Gegen Staging zeigte der Rate-Limit-Restzähler zwei
verschränkte Zählreihen für einen einzigen Client (Protokoll
`docs/testing/protokolle/2026-09-17-staging-rate-limits-fehlerformat.md`).
Railway dokumentiert `X-Real-IP` als Client-Adresse
(docs.railway.com/networking/public-networking/specs-and-limits), aber kein
`X-Forwarded-For`. `request.ip` (aus `X-Forwarded-For` über
`TRUST_PROXY_HOPS`) ist deshalb vermutlich eine Proxy-Adresse. Bevor der
Schlüssel umgestellt wird, muss das belegt werden.

**Files:**
- Modify: `apps/api/src/common/api-logging.interceptor.ts`
- Create: `apps/api/src/common/client-address.ts`
- Create: `apps/api/src/common/client-address.integration.spec.ts`
- Modify: `apps/api/src/common/rate-limit.ts:111-112`, `apps/api/src/common/audit-context.ts:30`, `apps/api/src/auth/auth.controller.ts` (Stelle, die `CLIENT_IP_HEADER` setzt)

**Interfaces:**
- Produces: `resolveClientAddress(request: FastifyRequest, trustProxyHops: number): string`
  und `RAW_ADDRESS_HEADERS = ["x-real-ip", "x-forwarded-for"] as const`.

- [ ] **Step 1: Diagnose-Felder im Request-Log (Test zuerst)**

`apps/api/src/common/api-logging.interceptor.spec.ts` (Unit, kein DB-Zugriff):

```ts
import { Logger } from "@nestjs/common";
import { of } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { ApiLoggingInterceptor } from "./api-logging.interceptor.js";

describe("ApiLoggingInterceptor", () => {
  it("protokolliert request.ip und die rohen Adress-Header", async () => {
    const logger = { log: vi.fn() } as unknown as Logger;
    const interceptor = new ApiLoggingInterceptor(logger);
    const request = {
      method: "GET",
      url: "/api/v1/health",
      ip: "10.0.0.5",
      headers: { "x-real-ip": "203.0.113.10", "x-forwarded-for": "203.0.113.10, 10.0.0.1" },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ statusCode: 200 }) }),
    };

    await new Promise<void>((resolve) => {
      interceptor
        .intercept(context as never, { handle: () => of(null) })
        .subscribe({ complete: resolve });
    });

    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "http_request_completed",
        ip: "10.0.0.5",
        addressHeaders: { "x-real-ip": "203.0.113.10", "x-forwarded-for": "203.0.113.10, 10.0.0.1" },
      }),
      "ApiLoggingInterceptor",
    );
  });
});
```

Run: `cd apps/api && npx vitest run src/common/api-logging.interceptor.spec.ts`
Expected: FAIL (Felder fehlen).

- [ ] **Step 2: Felder ergänzen**

In `api-logging.interceptor.ts`, `logRequest`:

```ts
    const headers = input.request.headers;
    this.logger.log(
      {
        event: "http_request_completed",
        method: input.request.method,
        path: input.request.url.split("?", 1)[0],
        statusCode: input.statusCode,
        durationMs: Math.round((performance.now() - input.startedAt) * 100) / 100,
        correlationId: input.correlationId,
        ip: input.request.ip,
        addressHeaders: {
          "x-real-ip": headerValue(headers["x-real-ip"]),
          "x-forwarded-for": headerValue(headers["x-forwarded-for"]),
        },
      },
      ApiLoggingInterceptor.name,
    );
```

und im selben File:

```ts
function headerValue(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  return Array.isArray(value) ? value.join(", ") : value;
}
```

Run: derselbe Befehl. Expected: PASS. Dann `pnpm --filter @darts-platform/api lint typecheck`.

- [ ] **Step 3: Commit und nach Staging bringen**

```bash
git add apps/api/src/common/api-logging.interceptor.ts apps/api/src/common/api-logging.interceptor.spec.ts
git commit -m "feat(api): Client-Adresse und rohe Adress-Header im Request-Log"
git push origin develop
```

Voraussetzung: Railway `staging` deployt `develop` (CI-Gate, siehe Global
Constraints). Danach von einer Maschine aus 6 Anfragen mit einer
gefälschten Adresse schicken und die Logs lesen:

```bash
for i in 1 2 3 4 5 6; do
  curl -sS -o /dev/null -H "X-Real-IP: 198.51.100.7" -H "X-Forwarded-For: 198.51.100.8" \
    https://darts-platformapi-staging.up.railway.app/api/v1/health
done
railway logs --project b72b141e-1685-44d7-960e-06c6b3998b34 --environment staging \
  --service @darts-platform/api --lines 100 --json \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{for(const l of d.split("\n")){try{const o=JSON.parse(l);const m=typeof o.message==="string"?JSON.parse(o.message):o.message;if(m?.event==="http_request_completed"&&m.path==="/api/v1/health")console.log(m.ip,JSON.stringify(m.addressHeaders))}catch{}}})'
```

Erwartung festhalten (ins Protokoll):
- Wie viele verschiedene Werte hat `ip` über die 6 Anfragen? Mehr als einer
  bestätigt Befund D3-1.
- Steht in `x-real-ip` die eigene öffentliche Adresse oder die gefälschte
  `198.51.100.7`? Nur wenn Railway den Header überschreibt, ist er als
  Schlüssel brauchbar.
- Wie sieht `x-forwarded-for` aus (Anzahl Einträge, Position der eigenen
  Adresse)?

- [ ] **Step 4: Entscheidung**

Fall A – `x-real-ip` wird von Railway überschrieben und ist stabil: weiter mit
Step 5 (Schlüssel auf `X-Real-IP`).

Fall B – `x-real-ip` lässt sich fälschen oder fehlt: `X-Forwarded-For` bleibt
Quelle, aber `TRUST_PROXY_HOPS` muss auf die tatsächliche Hop-Zahl aus dem Log
gesetzt werden (Staging-Variable ändern, erneut messen). Dann entfällt
Step 5, und das Protokoll hält den korrekten Wert für Production fest.

- [ ] **Step 5 (Fall A): Test für `resolveClientAddress`**

`apps/api/src/common/client-address.integration.spec.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

import { createApiTestApplication } from "../testing/api-harness.js";

let app: NestFastifyApplication;

afterEach(async () => {
  await app.close();
});

describe("Client-Adresse als Rate-Limit-Schlüssel", () => {
  it("nutzt hinter einem vertrauten Hop X-Real-IP und trennt Clients danach", async () => {
    app = await createApiTestApplication({ RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: 1, TRUST_PROXY_HOPS: 1 });
    const url = `/api/v1/invitations/${randomUUID()}/accept`;
    const base = { method: "POST" as const, url, remoteAddress: "10.0.0.5" };

    expect((await app.inject({ ...base, headers: { "x-real-ip": "203.0.113.10" } })).statusCode).not.toBe(429);
    expect((await app.inject({ ...base, headers: { "x-real-ip": "203.0.113.10" } })).statusCode).toBe(429);
    expect((await app.inject({ ...base, headers: { "x-real-ip": "203.0.113.20" } })).statusCode).not.toBe(429);
  }, 30_000);

  it("ignoriert X-Real-IP ohne vertrauten Hop", async () => {
    app = await createApiTestApplication({ RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: 1, TRUST_PROXY_HOPS: 0 });
    const url = `/api/v1/invitations/${randomUUID()}/accept`;
    const base = { method: "POST" as const, url, remoteAddress: "10.0.0.5" };

    expect((await app.inject({ ...base, headers: { "x-real-ip": "203.0.113.10" } })).statusCode).not.toBe(429);
    // Zweiter Client mit anderer X-Real-IP, aber derselben echten Adresse: derselbe Eimer.
    expect((await app.inject({ ...base, headers: { "x-real-ip": "203.0.113.20" } })).statusCode).toBe(429);
  }, 30_000);
});
```

Run: `cd apps/api && npx vitest run src/common/client-address.integration.spec.ts`
Expected: erster Fall FAIL (zweiter Client wird noch gebremst, weil der
Schlüssel `request.ip` = 10.0.0.5 ist).

- [ ] **Step 6 (Fall A): Implementierung**

`apps/api/src/common/client-address.ts`:

```ts
import type { FastifyRequest } from "fastify";

/**
 * Railway setzt `X-Real-IP` auf die Adresse des Clients
 * (docs.railway.com/networking/public-networking/specs-and-limits) und
 * ueberschreibt einen vom Client mitgeschickten Wert – belegt im Protokoll
 * vom <Datum aus Task 3 Step 3>. `X-Forwarded-For` ist dort nicht
 * dokumentiert; `request.ip` daraus war in Staging eine Proxy-Adresse, die
 * zwischen Anfragen wechselte (Befund D3-1).
 *
 * Ohne vertrauten Hop (`TRUST_PROXY_HOPS=0`, lokal) gilt der Header nicht:
 * ein direkt verbundener Client koennte ihn sonst selbst setzen.
 */
export function resolveClientAddress(
  request: FastifyRequest,
  trustProxyHops: number,
): string {
  if (trustProxyHops > 0) {
    const realIp = request.headers["x-real-ip"];
    const value = Array.isArray(realIp) ? realIp[0] : realIp;
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return request.ip;
}
```

`rate-limit.ts` Zeile 111–112:

```ts
    keyGenerator: (request: FastifyRequest): string =>
      `${resolveRateLimitTier(pathOf(request))}:${resolveClientAddress(request, environment.TRUST_PROXY_HOPS)}`,
```

`audit-context.ts`: `getAuditContext(request, trustProxyHops)` bekommt den
Hop-Wert als zweiten Parameter und setzt `ip: resolveClientAddress(request,
trustProxyHops)`. Alle Aufrufer (`api-exception.filter.ts`,
`api-logging.interceptor.ts`, Controller mit Audit) anpassen; der Wert kommt
aus `APPLICATION_ENVIRONMENT`. Wo der Filter keinen Zugriff auf die Umgebung
hat, den Wert im Konstruktor mitgeben
(`new ApiExceptionFilter(environment.TRUST_PROXY_HOPS)` in
`configure-application.ts`).

`auth.controller.ts`: die Stelle, die `CLIENT_IP_HEADER` auf `request.ip`
setzt, auf `resolveClientAddress(request, this.environment.TRUST_PROXY_HOPS)`
umstellen.

Run: `cd apps/api && npx vitest run src/common/client-address.integration.spec.ts src/common/rate-limit.integration.spec.ts src/auth/client-ip.integration.spec.ts`
Expected: PASS. Der bestehende Fall «trennt Zaehler nach der ueber vertraute
Proxy-Hops ermittelten Client-Adresse» in `rate-limit.integration.spec.ts`
sendet nur `x-forwarded-for`; er bleibt grün, weil ohne `x-real-ip` der
Rückfall `request.ip` greift.

- [ ] **Step 7: Nachmessen gegen Staging und Protokoll**

Nach dem Deploy denselben Lauf wie im Protokoll vom 17.09.2026:

```bash
B=https://darts-platformapi-staging.up.railway.app
seq 1 400 | xargs -P 40 -I{} curl -sS -m 20 -o /dev/null -w "%{http_code}\n" $B/api/v1/organizations | sort | uniq -c
seq 1 25 | xargs -P 25 -I{} curl -sS -m 20 -o /dev/null -w "%{http_code}\n" -X POST -H "content-type: application/json" \
  -d '{"email":"ratelimit-probe@example.test","password":"definitely-wrong-password"}' $B/api/v1/auth/sign-in/email | sort | uniq -c
```

Expected: 300× 401 und 100× 429; 10× 401 und 15× 429 (Toleranz ±1 wegen
Fensterrand). Ergebnis in
`docs/testing/protokolle/2026-09-17-staging-rate-limits-fehlerformat.md`
unter «Nachmessung» eintragen.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/common apps/api/src/auth/auth.controller.ts docs/testing/protokolle
git commit -m "fix(api): Rate-Limit- und Audit-Adresse hinter Railway aus X-Real-IP statt aus der Proxy-Kette"
```

---

### Task 4: Routeninventar (Spec D1, Grundlage)

**Files:**
- Create: `apps/api/src/testing/route-inventory.ts`
- Create: `apps/api/src/testing/route-inventory.integration.spec.ts`

**Interfaces:**
- Produces: `collectRoutes(overrides?: Partial<ApplicationEnvironment>): Promise<{ app: NestFastifyApplication; routes: readonly RouteEntry[] }>`
  mit `RouteEntry = { readonly method: string; readonly url: string }`.
  `HEAD`-Einträge und `OPTIONS` sind herausgefiltert; `url` trägt den
  Präfix `/api/v1`.

- [ ] **Step 1: Test**

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

import { collectRoutes, type RouteEntry } from "./route-inventory.js";

let app: NestFastifyApplication;
let routes: readonly RouteEntry[];

beforeAll(async () => {
  ({ app, routes } = await collectRoutes());
}, 60_000);

afterAll(async () => {
  await app.close();
});

describe("Routeninventar", () => {
  it("enthält bekannte Routen mit vollem Präfix", () => {
    expect(routes).toContainEqual({ method: "GET", url: "/api/v1/health" });
    expect(routes).toContainEqual({ method: "POST", url: "/api/v1/organizations/:organizationId/matches/:matchId/visits" });
  });

  it("enthält keine HEAD- oder OPTIONS-Einträge", () => {
    expect(routes.some((route) => route.method === "HEAD" || route.method === "OPTIONS")).toBe(false);
  });

  it("kennt mindestens 60 Routen", () => {
    expect(routes.length).toBeGreaterThanOrEqual(60);
  });
});
```

Run: `cd apps/api && npx vitest run src/testing/route-inventory.integration.spec.ts`
Expected: FAIL (Modul fehlt).

- [ ] **Step 2: Implementierung**

`apps/api/src/testing/route-inventory.ts` (Aufbau wie `api-harness.ts`, aber
mit `onRoute`-Hook vor `init()`):

```ts
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";

import { parseApplicationEnvironment, type ApplicationEnvironment } from "@darts-platform/config";

import { AppModule } from "../app.module.js";
import { configureApplication } from "../common/configure-application.js";
import { resolveTrustProxyOption } from "../common/trust-proxy.js";
import { APPLICATION_ENVIRONMENT } from "../config/environment.module.js";

export interface RouteEntry {
  readonly method: string;
  readonly url: string;
}

export async function collectRoutes(
  overrides: Partial<ApplicationEnvironment> = {},
): Promise<{ app: NestFastifyApplication; routes: readonly RouteEntry[] }> {
  const environment = { ...parseApplicationEnvironment(process.env), ...overrides };
  const moduleReference = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APPLICATION_ENVIRONMENT)
    .useValue(environment)
    .compile();
  const app = moduleReference.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ trustProxy: resolveTrustProxyOption(environment.TRUST_PROXY_HOPS) }),
    { logger: false },
  );

  const routes: RouteEntry[] = [];
  app.getHttpAdapter().getInstance().addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method === "HEAD" || method === "OPTIONS") continue;
      routes.push({ method, url: route.url });
    }
  });

  app.setGlobalPrefix("api/v1");
  await configureApplication(app, environment);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return { app, routes };
}
```

Run: derselbe Befehl. Expected: PASS. Fällt der dritte Fall (Anzahl), die
tatsächliche Zahl aus der Ausgabe eintragen und begründen.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/testing/route-inventory.ts apps/api/src/testing/route-inventory.integration.spec.ts
git commit -m "test(api): Routeninventar ueber den Fastify-onRoute-Hook"
```

---

### Task 5: Tenant-Isolationsmatrix (Spec D1)

**Files:**
- Create: `apps/api/src/security/tenant-isolation-matrix.integration.spec.ts`
- Read: `apps/api/src/common/http-boundary.integration.spec.ts` (Fixture-Muster)

**Interfaces:**
- Consumes: `collectRoutes` aus Task 4; `AuthService.getSession` wird per
  `vi.spyOn` auf den Owner von Organisation A gesetzt.

- [ ] **Step 1: Fixture und Matrix-Test**

```ts
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { memberships, organizations, users } from "@darts-platform/database";

import { AuthService } from "../auth/auth.service.js";
import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { collectRoutes, type RouteEntry } from "../testing/route-inventory.js";

const environment = parseApplicationEnvironment(process.env);
const databaseService = new DatabaseService(environment);
const organizationA = randomUUID();
const organizationB = randomUUID();
const ownerA = randomUUID();
const ownerAuth: AuthContext = {
  user: { id: ownerA, email: `owner-a-${ownerA}@example.test`, name: "Owner A" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};

/**
 * Gueltige Koerper je Route, damit die Tenant-Pruefung vor der
 * Koerper-Validierung ueberhaupt erreicht wird. Schluessel: "METHOD url".
 * Routen ohne Eintrag werden mit `{}` geschickt; ein 400 gilt dann als
 * "nicht bewiesen" und laesst den Test rot werden – der Eintrag ist dann
 * nachzutragen.
 */
const bodies: Record<string, unknown> = {
  "POST /api/v1/organizations/:organizationId/boards": { name: "Board 1" },
  "POST /api/v1/organizations/:organizationId/players": { displayName: "Fremde Spielerin", status: "ACTIVE" },
  "PATCH /api/v1/organizations/:organizationId/players/:playerId": { displayName: "Umbenannt" },
  "POST /api/v1/organizations/:organizationId/matches": {
    playerOneId: randomUUID(), playerTwoId: randomUUID(), boardId: null, bestOfLegs: 1, bestOfSets: 1,
  },
  "POST /api/v1/organizations/:organizationId/matches/:matchId/visits": {
    commandId: randomUUID(), expectedVersion: 0, playerId: randomUUID(), points: 60, dartsThrown: 3,
  },
  "POST /api/v1/organizations/:organizationId/matches/:matchId/undo": { commandId: randomUUID(), expectedVersion: 0 },
  "POST /api/v1/organizations/:organizationId/matches/:matchId/leg-start": {
    commandId: randomUUID(), expectedVersion: 0, legNumber: 1, startingSeat: 1,
  },
  "POST /api/v1/organizations/:organizationId/matches/:matchId/leg-by-bull": {
    commandId: randomUUID(), expectedVersion: 0, winnerSeat: 1,
  },
  "POST /api/v1/organizations/:organizationId/matches/:matchId/abort": {
    commandId: randomUUID(), expectedVersion: 0, reason: "Testabbruch",
  },
  "POST /api/v1/organizations/:organizationId/matches/:matchId/controller-lease": { controllerId: randomUUID(), force: false },
  "POST /api/v1/organizations/:organizationId/invitations": { email: "gast@example.test", role: "MEMBER" },
  "PATCH /api/v1/organizations/:organizationId/members/:userId": { role: "ADMIN" },
  "PUT /api/v1/organizations/:organizationId/members/:userId/player": { playerId: randomUUID() },
  "POST /api/v1/organizations/:organizationId/teams": { name: "Fremdes Team" },
  "PATCH /api/v1/organizations/:organizationId/teams/:teamId": { name: "Umbenannt" },
  "POST /api/v1/organizations/:organizationId/teams/:teamId/members": { playerId: randomUUID() },
  "POST /api/v1/organizations/:organizationId/tournaments/:tournamentId/display-keys": { label: "Anzeige" },
  "PATCH /api/v1/organizations/:organizationId/tournaments/:tournamentId/visibility": { visibility: "PUBLIC" },
  "POST /api/v1/organizations/:organizationId/tournaments/:tournamentId/assignments": {
    commandId: randomUUID(), expectedVersion: 0, matchId: randomUUID(), boardId: randomUUID(),
  },
  // Weitere Koerper (Tournaments create, Competitions, Encounters) beim ersten
  // roten Lauf aus packages/schemas ableiten und hier ergaenzen.
};

let app: NestFastifyApplication;
let routes: readonly RouteEntry[];

beforeAll(async () => {
  await databaseService.database.insert(users).values({ id: ownerA, email: ownerAuth.user.email, displayName: "Owner A" });
  await databaseService.database.insert(organizations).values([
    { id: organizationA, name: "Verein A", slug: `verein-a-${organizationA}`, timezone: "Europe/Zurich", locale: "de-CH" },
    { id: organizationB, name: "Verein B", slug: `verein-b-${organizationB}`, timezone: "Europe/Zurich", locale: "de-CH" },
  ]);
  await databaseService.database.insert(memberships).values({ organizationId: organizationA, userId: ownerA, role: "OWNER", status: "ACTIVE" });
  ({ app, routes } = await collectRoutes({
    RATE_LIMIT_MAX_PER_MINUTE: 100_000, RATE_LIMIT_PUBLIC_MAX_PER_MINUTE: 100_000, RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: 100_000,
  }));
  vi.spyOn(app.get(AuthService), "getSession").mockResolvedValue(ownerAuth);
}, 60_000);

afterAll(async () => {
  await app.close();
  await databaseService.database.delete(organizations).where(inArray(organizations.id, [organizationA, organizationB]));
  await databaseService.database.delete(users).where(eq(users.id, ownerA));
  await databaseService.onApplicationShutdown();
});

function fillParams(url: string): string {
  return url
    .replace(":organizationId", organizationB)
    .replace(/:[A-Za-z]+Id/gu, () => randomUUID())
    .replace(/:[A-Za-z]+/gu, () => randomUUID());
}

describe("Tenant-Isolation: Owner von A gegen Ressourcen von B", () => {
  it("prüft jede Route mit :organizationId", async () => {
    const tenantRoutes = routes.filter((route) => route.url.includes(":organizationId"));
    expect(tenantRoutes.length).toBeGreaterThanOrEqual(40);

    const leaks: string[] = [];
    const unproven: string[] = [];

    for (const route of tenantRoutes) {
      const key = `${route.method} ${route.url}`;
      const payload = route.method === "GET" || route.method === "DELETE" ? undefined : (bodies[key] ?? {});
      const response = await app.inject({
        method: route.method as "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
        url: fillParams(route.url),
        ...(payload === undefined ? {} : { payload }),
        headers: { "content-type": "application/json" },
      });

      if (response.statusCode >= 200 && response.statusCode < 300) leaks.push(`${key} -> ${response.statusCode}`);
      else if (response.statusCode === 400 || response.statusCode === 415) unproven.push(`${key} -> ${response.statusCode} (Koerper ergaenzen)`);
      else if (response.statusCode !== 403 && response.statusCode !== 404) leaks.push(`${key} -> ${response.statusCode}`);
    }

    expect(leaks, `Fremdzugriff moeglich:\n${leaks.join("\n")}`).toEqual([]);
    expect(unproven, `Nicht bewiesen:\n${unproven.join("\n")}`).toEqual([]);
  }, 120_000);
});
```

- [ ] **Step 2: Lauf, Körper nachtragen, Befunde protokollieren**

Run: `cd apps/api && npx vitest run src/security/tenant-isolation-matrix.integration.spec.ts`

Erster Lauf ist erwartbar rot wegen `unproven`. Für jede gemeldete Route den
Körper aus `packages/schemas` ableiten und in `bodies` eintragen (Avatar-Route
`PUT .../avatar` braucht `headers: { "content-type": "image/png" }` und
einen kleinen Byte-Puffer als `payload`; dafür im Test eine Sonderbehandlung
über `key.endsWith("/avatar")`). Ein Eintrag in `leaks` ist ein
Sicherheitsbefund: sofort ins Protokoll
`docs/testing/protokolle/<datum>-tenant-isolation.md`, Fix als eigener
Commit vor dem Abschluss dieser Task.

Expected nach Nachtragen: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/security/tenant-isolation-matrix.integration.spec.ts docs/testing/protokolle
git commit -m "test(api): Tenant-Isolationsmatrix ueber alle Routen mit organizationId"
```

---

### Task 6: Permission-Matrix (Spec D2)

**Files:**
- Create: `apps/api/src/security/permission-matrix.integration.spec.ts`

**Interfaces:**
- Consumes: `organizationPermissions`, `organizationRoles`, `hasOrganizationPermission` aus `@darts-platform/domain`; `createApiTestApplication`.

- [ ] **Step 1: Test**

Je Permission eine Leseroute oder eine Mutation, deren Autorisierung vor der
Fachlogik greift. Erwartung: Rolle mit Permission → nicht 403; Rolle ohne →
403. Fachliche 400/404 nach der Autorisierung sind erlaubt und zählen als
«autorisiert».

```ts
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { memberships, organizations, users } from "@darts-platform/database";
import { hasOrganizationPermission, organizationPermissions, organizationRoles, type OrganizationPermission, type OrganizationRole } from "@darts-platform/domain";

import { AuthService } from "../auth/auth.service.js";
import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { createApiTestApplication } from "../testing/api-harness.js";

const environment = parseApplicationEnvironment(process.env);
const databaseService = new DatabaseService(environment);
const organizationId = randomUUID();
const userIds = Object.fromEntries(organizationRoles.map((role) => [role, randomUUID()])) as Record<OrganizationRole, string>;

interface Probe { readonly method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; readonly url: string; readonly payload?: unknown }

const probes: Record<OrganizationPermission, Probe> = {
  "organization:read": { method: "GET", url: `/api/v1/organizations/${organizationId}/players` },
  "organization:update": { method: "PATCH", url: `/api/v1/organizations/${organizationId}/members/${randomUUID()}`, payload: { role: "MEMBER" } },
  "organization:manage_members": { method: "GET", url: `/api/v1/organizations/${organizationId}/members` },
  "organization:manage_roles": { method: "PATCH", url: `/api/v1/organizations/${organizationId}/members/${randomUUID()}`, payload: { role: "MEMBER" } },
  "player:read": { method: "GET", url: `/api/v1/organizations/${organizationId}/players` },
  "player:create": { method: "POST", url: `/api/v1/organizations/${organizationId}/players`, payload: { displayName: `P-${randomUUID()}`, status: "ACTIVE" } },
  "player:update": { method: "PATCH", url: `/api/v1/organizations/${organizationId}/players/${randomUUID()}`, payload: { displayName: "X" } },
  "player:archive": { method: "DELETE", url: `/api/v1/organizations/${organizationId}/players/${randomUUID()}` },
  "board:read": { method: "GET", url: `/api/v1/organizations/${organizationId}/boards` },
  "board:manage": { method: "POST", url: `/api/v1/organizations/${organizationId}/boards`, payload: { name: `B-${randomUUID()}` } },
  "match:read": { method: "GET", url: `/api/v1/organizations/${organizationId}/matches` },
  "match:create": { method: "POST", url: `/api/v1/organizations/${organizationId}/matches`, payload: { playerOneId: randomUUID(), playerTwoId: randomUUID(), boardId: null, bestOfLegs: 1, bestOfSets: 1 } },
  "match:score": { method: "POST", url: `/api/v1/organizations/${organizationId}/matches/${randomUUID()}/visits`, payload: { commandId: randomUUID(), expectedVersion: 0, playerId: randomUUID(), points: 60, dartsThrown: 3 } },
  "match:undo": { method: "POST", url: `/api/v1/organizations/${organizationId}/matches/${randomUUID()}/undo`, payload: { commandId: randomUUID(), expectedVersion: 0 } },
  "match:abort": { method: "POST", url: `/api/v1/organizations/${organizationId}/matches/${randomUUID()}/abort`, payload: { commandId: randomUUID(), expectedVersion: 0, reason: "Test" } },
  "tournament:read": { method: "GET", url: `/api/v1/organizations/${organizationId}/tournaments` },
  "tournament:create": { method: "POST", url: `/api/v1/organizations/${organizationId}/tournaments`, payload: {} },
  "tournament:update": { method: "PATCH", url: `/api/v1/organizations/${organizationId}/tournaments/${randomUUID()}/visibility`, payload: { visibility: "PUBLIC" } },
  "tournament:share": { method: "GET", url: `/api/v1/organizations/${organizationId}/tournaments/${randomUUID()}/display-keys` },
  "statistics:read": { method: "GET", url: `/api/v1/organizations/${organizationId}/players/${randomUUID()}/statistics` },
  "board:assign": { method: "POST", url: `/api/v1/organizations/${organizationId}/tournaments/${randomUUID()}/assignments`, payload: { commandId: randomUUID(), expectedVersion: 0, matchId: randomUUID(), boardId: randomUUID() } },
  "team:read": { method: "GET", url: `/api/v1/organizations/${organizationId}/teams` },
  "team:manage": { method: "POST", url: `/api/v1/organizations/${organizationId}/teams`, payload: { name: `T-${randomUUID()}` } },
  "competition:read": { method: "GET", url: `/api/v1/organizations/${organizationId}/competitions` },
  "competition:manage": { method: "POST", url: `/api/v1/organizations/${organizationId}/competitions`, payload: {} },
  "encounter:read": { method: "GET", url: `/api/v1/organizations/${organizationId}/encounters/${randomUUID()}` },
  "encounter:manage": { method: "POST", url: `/api/v1/organizations/${organizationId}/encounters/${randomUUID()}/start`, payload: {} },
  "encounter:lineup": { method: "POST", url: `/api/v1/organizations/${organizationId}/encounters/${randomUUID()}/nominations`, payload: {} },
};

let app: NestFastifyApplication;

beforeAll(async () => {
  await databaseService.database.insert(users).values(
    organizationRoles.map((role) => ({ id: userIds[role], email: `${role.toLowerCase()}-${userIds[role]}@example.test`, displayName: role })),
  );
  await databaseService.database.insert(organizations).values({ id: organizationId, name: "Matrix-Verein", slug: `matrix-${organizationId}`, timezone: "Europe/Zurich", locale: "de-CH" });
  await databaseService.database.insert(memberships).values(
    organizationRoles.map((role) => ({ organizationId, userId: userIds[role], role, status: "ACTIVE" as const })),
  );
  app = await createApiTestApplication({ RATE_LIMIT_MAX_PER_MINUTE: 100_000, RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: 100_000 });
}, 60_000);

afterAll(async () => {
  await app.close();
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(users).where(inArray(users.id, Object.values(userIds)));
  await databaseService.onApplicationShutdown();
});

function authFor(role: OrganizationRole): AuthContext {
  return {
    user: { id: userIds[role], email: `${role.toLowerCase()}-${userIds[role]}@example.test`, name: role },
    session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
  };
}

describe("Permission-Matrix: jede Rolle gegen jede Permission", () => {
  it("deckt alle Permissions mit einer Probe ab", () => {
    expect(Object.keys(probes).sort()).toEqual([...organizationPermissions].sort());
  });

  for (const role of organizationRoles) {
    it(`Rolle ${role}`, async () => {
      vi.spyOn(app.get(AuthService), "getSession").mockResolvedValue(authFor(role));
      const wrong: string[] = [];

      for (const permission of organizationPermissions) {
        const probe = probes[permission];
        const response = await app.inject({
          method: probe.method, url: probe.url,
          ...(probe.payload === undefined ? {} : { payload: probe.payload }),
        });
        const allowed = hasOrganizationPermission(role, permission);
        const denied = response.statusCode === 403;
        if (allowed && denied) wrong.push(`${permission}: erwartet erlaubt, bekam 403`);
        if (!allowed && !denied) wrong.push(`${permission}: erwartet 403, bekam ${response.statusCode}`);
      }

      expect(wrong, wrong.join("\n")).toEqual([]);
    }, 120_000);
  }
});
```

Hinweis: einige Proben teilen sich eine Route, wenn eine Permission keine
eigene Route hat (`organization:update` → Mitgliedsrolle ändern). Das ist im
Test kommentiert; entscheidend ist, dass jede Permission mindestens einmal
geprüft wird und die Erwartung aus `hasOrganizationPermission` kommt, nicht
aus einer Kopie.

- [ ] **Step 2: Lauf und Befunde**

Run: `cd apps/api && npx vitest run src/security/permission-matrix.integration.spec.ts`

Ein «erwartet 403, bekam 2xx/4xx» bei einer Rolle ohne Permission ist ein
Sicherheitsbefund → Protokoll und Fix vor Abschluss. Ein «erwartet erlaubt,
bekam 403» zeigt, dass die Route eine andere Permission verlangt als in der
Probe angenommen → Probe korrigieren, nicht den Code. `organization:update`
hat laut Bericht keine eigene Route; wenn das so bleibt, im Protokoll als
«ungenutzte Permission» vermerken.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/security/permission-matrix.integration.spec.ts docs/testing/protokolle
git commit -m "test(api): Permission-Matrix je Rolle und Permission aus dem Domain-Paket"
```

---

### Task 7: E2E gegen den Produktivbuild (Spec C3)

**Files:**
- Modify: `apps/web/playwright.prod.config.ts`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: API-Server in die Prod-Konfiguration**

`playwright.prod.config.ts`: `testMatch` entfernen, `testDir: "./tests"`
setzen, `workers: 1`, und `webServer` zu zwei Einträgen machen, analog zu
`playwright.config.ts`, aber mit Produktivbefehlen:

```ts
webServer: [
  {
    command: "pnpm --filter @darts-platform/api... build && node ../../scripts/start-api.mjs",
    url: `http://localhost:${apiPort}/api/v1/health`,
    env: {
      NODE_ENV: "production",
      TRUST_PROXY_HOPS: "0",
      ALLOW_SELF_SERVICE_ORGANIZATIONS: "true",
      API_PORT: String(apiPort), PORT: String(apiPort),
      BETTER_AUTH_URL: apiOrigin, WEB_ORIGIN: webOrigin,
      RATE_LIMIT_MAX_PER_MINUTE: "100000", RATE_LIMIT_PUBLIC_MAX_PER_MINUTE: "100000",
      RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: "100000", RATE_LIMIT_SOCKET_MAX_PER_MINUTE: "100000",
    },
    reuseExistingServer: false,
    timeout: 240_000,
  },
  {
    command: `pnpm --filter @darts-platform/web... build && npx next start --port ${webPort}`,
    url: webOrigin,
    env: { NODE_ENV: "production", NEXT_PUBLIC_API_URL: `${apiOrigin}/api/v1`, NEXT_DIST_DIR: ".next-e2e-prod" },
    reuseExistingServer: false,
    timeout: 240_000,
  },
],
```

`apiPort` aus `PLAYWRIGHT_PROD_API_PORT ?? 3201` ableiten. Der Start über
`scripts/start-api.mjs` führt wie in Railway zuerst die Migration aus.

- [ ] **Step 2: Lokal laufen lassen**

Run: `pnpm --filter @darts-platform/web test:e2e:prod`
Expected: dieselben Specs wie im Dev-Lauf grün, zusätzlich
`production-csp.spec.ts`. Rote Fälle, die nur im Produktivbuild auftreten,
sind Befunde (CSP, statisches Rendering).

- [ ] **Step 3: CI-Schritt**

In `ci.yml` nach «End-to-end test»:

```yaml
      - name: End-to-end test gegen Produktivbuild
        run: pnpm --filter @darts-platform/web test:e2e:prod
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/playwright.prod.config.ts .github/workflows/ci.yml
git commit -m "test(web): komplette E2E-Suite zusaetzlich gegen den Produktivbuild"
```

---

### Task 8: Staging-Client (Block A, Grundlage) — braucht Staging-Konto

**Files:**
- Create: `apps/api/test/staging/vitest.config.mts`
- Create: `apps/api/test/staging/staging-client.ts`
- Create: `apps/api/test/staging/staging-client.staging.spec.ts`
- Modify: `apps/api/package.json` (Skript `test:staging`), Root `package.json`

**Interfaces:**
- Produces:
  ```ts
  export interface StagingSession { readonly cookie: string; readonly baseUrl: string }
  export async function signIn(baseUrl: string, email: string, password: string): Promise<StagingSession>
  export async function api<T>(session: StagingSession, method: string, path: string, body?: unknown, schema?: z.ZodType<T>): Promise<{ status: number; data: T }>
  export async function createFixtureOrganization(session: StagingSession, runId: string): Promise<{ organizationId: string; playerIds: [string, string]; boardId: string }>
  export async function createMatch(session: StagingSession, organizationId: string, playerIds: [string, string], boardId: string | null): Promise<MatchState>
  export function readStagingConfig(): { baseUrl: string; email: string; password: string }
  ```
- Voraussetzung: `.env.staging` (git-ignoriert) mit `STAGING_API_URL`,
  `STAGING_EMAIL`, `STAGING_PASSWORD` eines Kontos, das in Staging
  registriert ist und `ALLOW_SELF_SERVICE_ORGANIZATIONS` nutzen darf.

- [ ] **Step 1: Konfiguration**

`apps/api/test/staging/vitest.config.mts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/staging/**/*.staging.spec.ts"],
    testTimeout: 300_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
```

`apps/api/package.json`: `"test:staging": "vitest run --config test/staging/vitest.config.mts"`.
Root: `"test:staging": "dotenv -e .env.staging -- pnpm --filter @darts-platform/api test:staging"`.
`.gitignore`: Zeile `.env.staging` ergänzen, falls `.env*` nicht schon greift.

- [ ] **Step 2: Client-Test**

```ts
import { describe, expect, it } from "vitest";

import { readStagingConfig, signIn, api, createFixtureOrganization, createMatch } from "./staging-client.js";

const config = readStagingConfig();

describe("Staging-Client", () => {
  it("meldet sich an und legt eine Fixture-Organisation mit Match an", async () => {
    const session = await signIn(config.baseUrl, config.email, config.password);
    expect(session.cookie).toContain("better-auth.session_token=");

    const runId = `run-${Date.now()}`;
    const fixture = await createFixtureOrganization(session, runId);
    const match = await createMatch(session, fixture.organizationId, fixture.playerIds, fixture.boardId);
    expect(match.version).toBe(0);
    expect(match.status).toBe("IN_PROGRESS");
  });
});
```

- [ ] **Step 3: Client-Implementierung**

```ts
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { matchStateSchema, type MatchState } from "@darts-platform/schemas";

export interface StagingSession { readonly cookie: string; readonly baseUrl: string }

export function readStagingConfig(): { baseUrl: string; email: string; password: string } {
  const baseUrl = process.env.STAGING_API_URL;
  const email = process.env.STAGING_EMAIL;
  const password = process.env.STAGING_PASSWORD;
  if (!baseUrl || !email || !password) {
    throw new Error("STAGING_API_URL, STAGING_EMAIL und STAGING_PASSWORD muessen gesetzt sein (siehe .env.staging).");
  }
  return { baseUrl: baseUrl.replace(/\/$/u, ""), email, password };
}

export async function signIn(baseUrl: string, email: string, password: string): Promise<StagingSession> {
  const response = await fetch(`${baseUrl}/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`Anmeldung fehlgeschlagen: ${response.status} ${await response.text()}`);
  const cookie = response.headers.getSetCookie().map((c) => c.split(";", 1)[0]).join("; ");
  if (!/better-auth\.session_token=/u.test(cookie)) throw new Error("Kein Session-Cookie erhalten.");
  return { cookie, baseUrl };
}

export async function api<T = unknown>(
  session: StagingSession, method: string, path: string, body?: unknown, schema?: z.ZodType<T>,
): Promise<{ status: number; data: T }> {
  const response = await fetch(`${session.baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: session.cookie, accept: "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const json: unknown = text.length === 0 ? null : JSON.parse(text);
  return { status: response.status, data: (schema ? schema.parse(json) : json) as T };
}

const idSchema = z.object({ id: z.uuid() });

export async function createFixtureOrganization(session: StagingSession, runId: string) {
  const org = await api(session, "POST", "/organizations", {
    name: `Lasttest ${runId}`, slug: `lasttest-${runId}`.toLowerCase(),
  }, idSchema);
  if (org.status !== 201) throw new Error(`Organisation nicht angelegt: ${org.status}`);
  const organizationId = org.data.id;
  const players = await Promise.all([1, 2].map((n) =>
    api(session, "POST", `/organizations/${organizationId}/players`, { displayName: `Spieler ${n} ${runId}`, status: "ACTIVE" }, idSchema),
  ));
  const board = await api(session, "POST", `/organizations/${organizationId}/boards`, { name: `Board ${runId}` }, idSchema);
  return { organizationId, playerIds: [players[0].data.id, players[1].data.id] as [string, string], boardId: board.data.id };
}

export async function createMatch(
  session: StagingSession, organizationId: string, playerIds: [string, string], boardId: string | null,
): Promise<MatchState> {
  const created = await api(session, "POST", `/organizations/${organizationId}/matches`, {
    playerOneId: playerIds[0], playerTwoId: playerIds[1], boardId, bestOfLegs: 1, bestOfSets: 1,
  }, matchStateSchema);
  if (created.status !== 201) throw new Error(`Match nicht angelegt: ${created.status}`);
  return created.data;
}

export function visit(playerId: string, expectedVersion: number, points: number) {
  return { commandId: randomUUID(), expectedVersion, playerId, points, dartsThrown: 3 as const };
}
```

Prüfen, ob `matchStateSchema`/`MatchState` aus `@darts-platform/schemas`
exportiert werden (Bericht: `packages/schemas/src/match.ts:145`); sonst dort
exportieren.

Run: `pnpm test:staging`
Expected: PASS gegen Staging.

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/staging apps/api/package.json package.json .gitignore
git commit -m "test(api): Staging-Client fuer Lauf- und Lasttests gegen die Staging-API"
```

---

### Task 9: Nebenläufigkeit A1, A2, A6 — braucht Staging-Konto

**Files:**
- Create: `apps/api/test/staging/concurrency.staging.spec.ts`

- [ ] **Step 1: Tests**

```ts
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { matchStateSchema } from "@darts-platform/schemas";

import { api, createFixtureOrganization, createMatch, readStagingConfig, signIn, visit, type StagingSession } from "./staging-client.js";

const config = readStagingConfig();
let session: StagingSession;
let organizationId: string;
let playerIds: [string, string];

beforeAll(async () => {
  session = await signIn(config.baseUrl, config.email, config.password);
  ({ organizationId, playerIds } = await createFixtureOrganization(session, `conc-${Date.now()}`));
});

describe("Block A – Nebenläufigkeit", () => {
  it("A1: zwei Scorer mit derselben expectedVersion – genau einer gewinnt", async () => {
    const match = await createMatch(session, organizationId, playerIds, null);
    const path = `/organizations/${organizationId}/matches/${match.id}/visits`;
    const [a, b] = await Promise.all([
      api(session, "POST", path, visit(playerIds[0], 0, 60)),
      api(session, "POST", path, visit(playerIds[0], 0, 45)),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const conflict = a.status === 409 ? a : b;
    expect((conflict.data as { error: { code: string } }).error.code).toBe("MATCH_VERSION_CONFLICT");
    const state = await api(session, "GET", `/organizations/${organizationId}/matches/${match.id}`, undefined, matchStateSchema);
    expect(state.data.version).toBe(1);
    expect(state.data.visits).toHaveLength(1);
  });

  it("A2: dieselbe commandId zehnmal parallel – ein Visit", async () => {
    const match = await createMatch(session, organizationId, playerIds, null);
    const path = `/organizations/${organizationId}/matches/${match.id}/visits`;
    const command = visit(playerIds[0], 0, 100);
    const results = await Promise.all(Array.from({ length: 10 }, () => api(session, "POST", path, command, matchStateSchema)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.data.version))).toEqual(new Set([1]));
    expect(results[0].data.visits).toHaveLength(1);
  });

  it("A6: Undo während laufender Visits bleibt konsistent", async () => {
    const match = await createMatch(session, organizationId, playerIds, null);
    const base = `/organizations/${organizationId}/matches/${match.id}`;
    let version = 0;
    for (const points of [60, 60, 60]) {
      const r = await api(session, "POST", `${base}/visits`, visit(playerIds[version % 2], version, points), matchStateSchema);
      expect(r.status).toBe(200);
      version = r.data.version;
    }
    const [undo, nextVisit] = await Promise.all([
      api(session, "POST", `${base}/undo`, { commandId: randomUUID(), expectedVersion: version }),
      api(session, "POST", `${base}/visits`, visit(playerIds[version % 2], version, 41)),
    ]);
    expect([undo.status, nextVisit.status].sort()).toEqual([200, 409]);
    const state = await api(session, "GET", base, undefined, matchStateSchema);
    expect(state.data.version).toBe(version + 1);
    // Entweder wurde rueckgaengig gemacht (2 aktive Visits) oder geworfen (4): nie beides.
    const active = state.data.visits.filter((v) => !v.reverted).length;
    expect([2, 4]).toContain(active);
  });
});
```

Run: `pnpm test:staging`
Expected: PASS. Abweichungen → Protokoll `docs/testing/protokolle/<datum>-block-a.md`.

- [ ] **Step 2: Commit**

```bash
git add apps/api/test/staging/concurrency.staging.spec.ts
git commit -m "test(api): Nebenlaeufigkeitsfaelle A1, A2, A6 gegen Staging"
```

---

### Task 10: Last A3, A5 und Realtime A4 — braucht Staging-Konto

**Files:**
- Create: `apps/api/test/staging/load.staging.spec.ts`
- Create: `apps/api/test/staging/realtime.staging.spec.ts`
- Create: `docs/testing/protokolle/` (JSON-Ausgabe je Lauf)

- [ ] **Step 1: A3 – 20 Boards, 2 Minuten**

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

import { matchStateSchema } from "@darts-platform/schemas";

import { api, createFixtureOrganization, createMatch, readStagingConfig, signIn, visit, type StagingSession } from "./staging-client.js";

const config = readStagingConfig();
let session: StagingSession;
let organizationId: string;
let playerIds: [string, string];

beforeAll(async () => {
  session = await signIn(config.baseUrl, config.email, config.password);
  ({ organizationId, playerIds } = await createFixtureOrganization(session, `load-${Date.now()}`));
});

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

describe("Block A – Last", () => {
  it("A3: 20 Matches, 3 Visits pro Sekunde je Match, 120 Sekunden", async () => {
    const boards = 20;
    const durationMs = 120_000;
    const latencies: number[] = [];
    let errors = 0;

    const matches = await Promise.all(Array.from({ length: boards }, async (_, i) => {
      const players = await Promise.all([1, 2].map((n) =>
        api<{ id: string }>(session, "POST", `/organizations/${organizationId}/players`, { displayName: `L${i}-${n}`, status: "ACTIVE" }),
      ));
      return createMatch(session, organizationId, [players[0].data.id, players[1].data.id], null);
    }));

    const endAt = Date.now() + durationMs;
    await Promise.all(matches.map(async (match) => {
      let version = match.version;
      const players = match.participants.map((p) => p.playerId) as [string, string];
      while (Date.now() < endAt) {
        const started = performance.now();
        const points = 26; // hält das Leg lange offen
        const r = await api(session, "POST", `/organizations/${organizationId}/matches/${match.id}/visits`, visit(players[version % 2], version, points), matchStateSchema).catch(() => null);
        latencies.push(performance.now() - started);
        if (r === null || r.status !== 200) { errors += 1; break; }
        version = r.data.version;
        await new Promise((resolve) => setTimeout(resolve, 333));
      }
    }));

    const result = {
      case: "A3", at: new Date().toISOString(), boards, durationMs,
      requests: latencies.length, errors,
      p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95), p99: percentile(latencies, 0.99),
    };
    mkdirSync("../../docs/testing/protokolle/messwerte", { recursive: true });
    writeFileSync(`../../docs/testing/protokolle/messwerte/${result.at.slice(0, 10)}-a3.json`, JSON.stringify(result, null, 2));

    expect(errors).toBe(0);
    expect(result.p95).toBeLessThan(500);
  });

  it("A5: 600 öffentliche Anfragen pro Minute bleiben frei, 700 erzeugen 429 ohne andere Routen zu bremsen", async () => {
    const publicId = "00000000-0000-4000-8000-000000000000";
    const statuses = await Promise.all(Array.from({ length: 700 }, () =>
      fetch(`${config.baseUrl}/public/tournaments/${publicId}/live`).then((r) => r.status),
    ));
    const blocked = statuses.filter((s) => s === 429).length;
    expect(blocked).toBeGreaterThan(50);
    expect(blocked).toBeLessThan(150);
    const general = await api(session, "GET", "/organizations");
    expect(general.status).toBe(200);
  });
});
```

Hinweis A5: `RATE_LIMIT_PUBLIC_MAX_PER_MINUTE` ist 600; die Toleranz fängt den
Fensterrand ab. Gilt erst nach Task 3, sonst zählt Staging pro Proxy-Adresse.

- [ ] **Step 2: A4 – Realtime-Fan-out**

Ein öffentliches Turnier mit Board, Zuordnung eines READY-Matches, dann 50
Sockets auf `tournament:subscribe` und Visits werfen:

```ts
import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readStagingConfig, signIn, api, createFixtureOrganization, type StagingSession } from "./staging-client.js";

const config = readStagingConfig();
const origin = new URL(config.baseUrl).origin;
let session: StagingSession;
let organizationId: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  session = await signIn(config.baseUrl, config.email, config.password);
  ({ organizationId } = await createFixtureOrganization(session, `rt-${Date.now()}`));
});

afterAll(() => { for (const s of sockets) s.close(); });

describe("Block A – Realtime", () => {
  it("A4: 50 Zuschauer erhalten jedes Ereignis", async () => {
    const players = await Promise.all([1, 2, 3, 4].map((n) =>
      api<{ id: string }>(session, "POST", `/organizations/${organizationId}/players`, { displayName: `RT ${n}`, status: "ACTIVE" }),
    ));
    const board = await api<{ id: string }>(session, "POST", `/organizations/${organizationId}/boards`, { name: "RT Board" });
    const tournament = await api<{ id: string; publicId: string; version: number }>(session, "POST", `/organizations/${organizationId}/tournaments`, {
      name: "Realtime-Test", startsAt: new Date().toISOString(), format: "SINGLE_ELIMINATION",
      startingScore: 501, inRule: "STRAIGHT", outRule: "DOUBLE", maxRounds: null, bestOfLegs: 1, bestOfSets: 1,
      participantIds: players.map((p) => p.data.id), groupCount: 1, qualifyPerGroup: 1, knockoutSize: 4, seeding: "SEEDED", boardIds: [board.data.id],
    });
    expect(tournament.status).toBe(201);
    await api(session, "PATCH", `/organizations/${organizationId}/tournaments/${tournament.data.id}/visibility`, { visibility: "PUBLIC" });

    const dashboard = await api<{ tournament: { version: number; publicId: string }; queue: { matchId: string; readiness: string }[] }>(
      session, "GET", `/organizations/${organizationId}/tournaments/${tournament.data.id}/dashboard`);
    const ready = dashboard.data.queue.find((e) => e.readiness === "READY");
    if (!ready) throw new Error("Kein READY-Match im Turnier.");
    const publicId = dashboard.data.tournament.publicId;

    const received: number[] = Array.from({ length: 50 }, () => 0);
    await Promise.all(received.map((_, i) => new Promise<void>((resolve, reject) => {
      const socket = io(origin, { transports: ["websocket"] });
      sockets.push(socket);
      socket.on("connect", () => { socket.emit("tournament:subscribe", { publicId }); resolve(); });
      socket.on("tournament:changed", () => { received[i] += 1; });
      socket.on("subscription:rejected", (r: unknown) => reject(new Error(`abgelehnt: ${JSON.stringify(r)}`)));
      socket.on("connect_error", reject);
    })));

    const assign = await api(session, "POST", `/organizations/${organizationId}/tournaments/${tournament.data.id}/assignments`, {
      commandId: randomUUID(), expectedVersion: dashboard.data.tournament.version, matchId: ready.matchId, boardId: board.data.id,
    });
    expect(assign.status).toBe(200);

    const sentAt = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    const missing = received.filter((count) => count === 0).length;
    expect(missing, `${missing} von 50 Sockets ohne Ereignis nach ${Date.now() - sentAt} ms`).toBe(0);
  });
});
```

`socket.io-client` ist bereits devDependency in `apps/api`. Verzögerung
(p95 unter 2 s) im Protokoll aus Zeitstempeln der Ereignisse messen: dazu
`received` um `firstAt: number` je Socket erweitern und die Differenz zu
`sentAt` auswerten.

- [ ] **Step 3: Lauf und Protokoll**

Run: `pnpm test:staging`
Ergebnisse (JSON-Messwerte und Textbefund) in `docs/testing/protokolle/<datum>-block-a.md`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/staging docs/testing/protokolle
git commit -m "test(api): Last- und Realtime-Faelle A3, A4, A5 gegen Staging mit Messprotokoll"
```

---

### Task 11: Betrieb und Wiederherstellung (Block B) — Betreiber und CLI

Rein operative Proben, jede mit Protokollabschnitt in
`docs/testing/protokolle/<datum>-block-b.md`. Keine Codeänderung.

- [ ] **B1 Backup-Stand Production (gelesen am 17.09.2026):** `railway postgres pitr status` meldet für Production `enabled: false`, `bucketWired: false`. Es gibt kein kontinuierliches Backup. Entscheid des Betreibers: `railway postgres pitr enable --project b72b141e-1685-44d7-960e-06c6b3998b34 --environment production --service Postgres` (Mutation an Production, legt einen Bucket an, kostenpflichtig). Bis dahin: Befund «hoch» im Abnahmeprotokoll.
- [ ] **B2 Restore-Probe auf Staging:** PITR in Staging einschalten, Seed-Daten anlegen (Task 8 Fixture), `railway postgres pitr backup create --name probe-1`, weitere Daten schreiben, `railway postgres pitr restore --at <UTC-Zeit nach probe-1> --new-service-name postgres-restored`, per `railway connect postgres-restored` Zeilenzahlen von `organizations`, `matches`, `visits` mit dem Original vergleichen, Service danach löschen (`railway service delete`, nach Rückfrage).
- [ ] **B3 Migrationsprobe:** nächste Migration in `develop` beobachten: Staging-Deploy-Logs der API müssen genau einen Migrationslauf vor `main.js` zeigen; Worker-Logs dürfen keine «relation does not exist»-Fehler enthalten. Belegen mit `railway logs --service @darts-platform/api --environment staging`.
- [ ] **B4 Redis-Ausfall:** während Task 10 A3 läuft: `railway restart --service Redis --environment staging`. Erwartung: A3 meldet keine Fehler (HTTP-Scoring unabhängig), Health zeigt `redis: "ok"` innert 30 s, Realtime-Sockets aus A4 verbinden neu.
- [ ] **B5 Worker-Neustart:** `railway restart --service @darts-platform/worker --environment staging` während Visits laufen; danach `GET /api/v1/health` → `outbox.deadLettered` bleibt 0, `publishLagSeconds` fällt auf null zurück.
- [ ] **B6 API-Neustart mit offenen Sockets:** `railway restart --service @darts-platform/api --environment staging` bei 50 offenen Sockets aus A4; Sockets müssen `connect` erneut melden und ein danach ausgelöstes Ereignis empfangen.

---

### Task 12: Auth-Flows, öffentliche Routen, Vorlagen (Spec D4, D5, E)

**Files:**
- Create: `apps/api/test/staging/auth-flows.staging.spec.ts`
- Create: `docs/testing/szenario-spieltag.md`
- Create: `docs/testing/abnahmeprotokoll-go-live.md`

- [ ] **Step 1: D4 Auth-Flows gegen Staging**

```ts
import { describe, expect, it } from "vitest";

import { readStagingConfig } from "./staging-client.js";

const config = readStagingConfig();

describe("Block D4 – Auth-Flows", () => {
  it("setzt das Session-Cookie mit HttpOnly, Secure und SameSite=Lax", async () => {
    const response = await fetch(`${config.baseUrl}/auth/sign-in/email`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: config.email, password: config.password }),
    });
    expect(response.status).toBe(200);
    const cookie = response.headers.getSetCookie().find((c) => c.includes("session_token"));
    expect(cookie).toMatch(/HttpOnly/iu);
    expect(cookie).toMatch(/Secure/iu);
    expect(cookie).toMatch(/SameSite=Lax/iu);
  });

  it("invalidiert die Session beim Logout serverseitig", async () => {
    const login = await fetch(`${config.baseUrl}/auth/sign-in/email`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: config.email, password: config.password }),
    });
    const cookie = login.headers.getSetCookie().map((c) => c.split(";", 1)[0]).join("; ");
    const origin = new URL(process.env.STAGING_WEB_ORIGIN ?? "https://staging.dartbase.ch").origin;
    const logout = await fetch(`${config.baseUrl}/auth/sign-out`, { method: "POST", headers: { cookie, origin } });
    expect(logout.status).toBe(200);
    const afterwards = await fetch(`${config.baseUrl}/organizations`, { headers: { cookie } });
    expect(afterwards.status).toBe(401);
  });

  it("weist eine fremde Origin bei Cookie-Anfragen an Auth-Routen ab", async () => {
    const login = await fetch(`${config.baseUrl}/auth/sign-in/email`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: config.email, password: config.password }),
    });
    const cookie = login.headers.getSetCookie().map((c) => c.split(";", 1)[0]).join("; ");
    const foreign = await fetch(`${config.baseUrl}/auth/sign-out`, { method: "POST", headers: { cookie, origin: "https://angreifer.example" } });
    expect(foreign.status).toBe(403);
  });
});
```

D5 (öffentliche Routen geben keine internen Daten preis) als vierter Fall:
`GET /public/tournaments/<publicId>/live` eines öffentlichen Turniers aus
Task 10 abrufen und mit einer Verbotsliste prüfen:
`expect(JSON.stringify(body)).not.toMatch(/@example\.test|"organizationId"|"userId"/u)`.

- [ ] **Step 2: Vorlage Block E**

`docs/testing/szenario-spieltag.md` mit Abschnitten: Ziel, Rollen (Turnierleitung, 3 Scorer, Anzeige, 5 Zuschauer), Geräteliste, Ablauf Turniertag (16 Spieler, Gruppen → KO, 4 Boards), Ablauf Liga-Spieltag (Aufstellung, Doppel, Rundenfolge, eine Sanktion), Störungen (WLAN 2 Minuten aus, Handy-Sperre im Visit, Tab schliessen/öffnen), Beobachtungspunkte je Rolle, Protokolltabelle (Zeit, Rolle, Beobachtung, Schwere, Screenshot), Abschlussfragen.

- [ ] **Step 3: Abnahmeprotokoll**

`docs/testing/abnahmeprotokoll-go-live.md`: Tabelle je Block und Fall mit
Spalten Fall, Datum, Ergebnis (grün/rot/akzeptiert), Protokoll-Link, Befund.
Vorbelegt mit den Ergebnissen vom 17.09.2026: D6 grün, D3 rot (Befund D3-1,
D3-2), B1 rot (kein PITR in Production), Quality-Gate lokal grün,
GitHub Actions blockiert.

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/staging/auth-flows.staging.spec.ts docs/testing
git commit -m "test: Auth-Flow-Pruefungen gegen Staging, Vorlage Szenario-Spieltag, Abnahmeprotokoll"
```

---

### Task 13: Befundliste I-7 (Spec C4)

**Files:**
- Create: `docs/testing/protokolle/<datum>-i7-tenant-fremdschluessel.md`

- [ ] **Step 1: Tabellen ohne zusammengesetzte Tenant-FKs ermitteln**

Gegen die lokale Datenbank:

```sql
SELECT tc.table_name, kcu.column_name, ccu.table_name AS referenced_table
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name IN (SELECT table_name FROM information_schema.columns WHERE column_name = 'organization_id')
  AND ccu.table_name IN (SELECT table_name FROM information_schema.columns WHERE column_name = 'organization_id')
  AND kcu.column_name <> 'organization_id'
ORDER BY 1, 2;
```

Run: `psql "$DATABASE_URL" -f <datei>`; Ergebnis als Tabelle ins Protokoll:
jede Zeile ist eine Beziehung, die heute nur über die Anwendung
tenant-konsistent ist. Kein Codeeingriff; die Liste ist Eingabe für die
spätere I-7-Spec.

- [ ] **Step 2: Commit**

```bash
git add docs/testing/protokolle
git commit -m "docs: Befundliste zu Tenant-Fremdschluesseln (I-7) als Grundlage fuer die Spec"
```

---

## Reihenfolge und Abhängigkeiten

```text
Task 1 (Coverage) ─┐
Task 2 (Scheduling)─┼─ unabhängig, sofort
Task 4 → Task 5 (Tenant-Matrix) ─┘
Task 6 (Permission-Matrix) – sofort
Task 7 (Prod-E2E) – sofort
Task 13 (I-7-Liste) – sofort
Task 3 (Client-Adresse) – Step 1–2 sofort, Step 3 ff. braucht Staging-Deploy
Task 8 → 9 → 10 → 12 – brauchen Staging-Konto (Bootstrap durch Betreiber)
Task 11 (Block B) – Betreiber mit CLI, B4–B6 während Task 10
```

Blocker beim Betreiber (Stand 17.09.2026):
1. GitHub-Billing in Ordnung bringen, sonst deployt Staging nichts.
2. Bootstrap der ersten Staging-Organisation per Railway SSH gemäss Runbook
   (fiktiver Owner `staging-owner@example.test`), danach ein Konto für
   `.env.staging`.
3. Vier DNS-Einträge für `staging.dartbase.ch` und `api-staging.dartbase.ch`
   (Runbook), nötig für Browser-Login und Block E.
4. Entscheid PITR in Production (B1).
