# CSP-Nonce Nacharbeit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **WICHTIG vor Task 1:** `apps/web/AGENTS.md` warnt ausdrücklich, dass diese
> Next.js-Version von der Trainings-API abweichen kann. Task 1 dieses Plans
> ändert eine sicherheitskritische Direktive (`'strict-dynamic'`), die das
> Laden von Skripten bei clientseitiger Navigation betrifft — vor dem Commit
> unbedingt echte clientseitige Navigation im Browser/per Playwright prüfen,
> nicht nur einen vollen Seitenaufruf.

**Goal:** Die drei im Abschlussreview von `2026-09-08-csp-nonce.md` als nicht-blockierend zurückgestellten Punkte nachziehen (siehe `docs/superpowers/plans/2026-09-08-tier3-backlog-und-rueckfragen.md`, Abschnitt "CSP-Nonce — Nacharbeit aus dem Abschlussreview").

**Architektur:** Baut auf PR #33 (`feature/csp-nonce`, `apps/web/src/proxy.ts` + `apps/web/src/lib/content-security-policy.ts`) auf — dieser Branch existiert nur auf `feature/csp-nonce`, noch nicht auf `develop`. Dieser Plan läuft deshalb auf einem von `feature/csp-nonce` abgezweigten Branch, nicht von `develop`.

**Tech Stack:** Next.js Proxy/CSP, Vitest, Playwright (neue Konfiguration gegen den echten Produktivbuild).

**Spec:** `docs/adr/0014-csp-nonce-static-rendering.md`, `docs/superpowers/plans/2026-09-08-csp-nonce.md`, `docs/superpowers/plans/2026-09-08-tier3-backlog-und-rueckfragen.md` (Abschnitt "CSP-Nonce — Nacharbeit").

## Global Constraints

- `'unsafe-eval'` bleibt ausschliesslich im Entwicklungsserver — unverändert.
- CSP bleibt erzwingend.
- `report-uri`/`report-to` bleiben unverändert bestehen.
- Kein `any`, `strict: true` (AGENTS.md §5).
- Kein Rebuild der schon gemergten Logik in `proxy.ts`/`content-security-policy.ts` ausser den hier explizit genannten Ergänzungen.

---

## Task 1: `'strict-dynamic'` ergänzen

**Files:**
- Modify: `apps/web/src/lib/content-security-policy.ts`
- Modify: `apps/web/src/lib/content-security-policy.spec.ts`

**Interfaces:**
- Consumes: nichts Neues.
- Produces: `buildContentSecurityPolicy` unverändert in der Signatur, nur der erzeugte `script-src`-Wert ändert sich.

**Kontext:** `script-src 'self' 'nonce-...'` erlaubt aktuell weiterhin jedes Skript von `'self'` zusätzlich zur Nonce — eine Injektion, die ein `<script src="/irgendein/pfad">` mit angreiferkontrolliertem Inhalt auf dem eigenen Origin platzieren kann, würde nicht blockiert. `'strict-dynamic'` schaltet Host-/Schema-Quellen (`'self'` eingeschlossen) ab; nur noch per Nonce/Hash direkt erlaubte Skripte oder von ihnen selbst dynamisch nachgeladene Skripte (Vertrauens-Propagation über die DOM-Erzeugungskette, inkl. Webpacks `__webpack_nonce__`-Mechanismus für Chunk-Nachladen) laufen. Next.js' eigenes Doku-Beispiel (`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`, Abschnitt "Adding a nonce with Proxy") kombiniert Nonce grundsätzlich mit `'strict-dynamic'` — das ist die dokumentierte Standardkombination, kein Sonderfall dieses Projekts.

**Risiko:** Diese App nutzt aktuell kein `next/dynamic`/`React.lazy` im eigenen Code (geprüft: `grep -rn "next/dynamic\|React.lazy" apps/web/src` findet nichts), aber Next.js lädt bei clientseitiger Navigation (Klick auf einen `<Link>`, kein voller Seitenaufruf) trotzdem den JS-Chunk der Zielroute per client-seitig injiziertem `<script>` nach. Ob das unter `'strict-dynamic'` weiterhin funktioniert, ist NICHT allein durch einen vollen Seitenaufruf (`curl`/`page.goto`) verifizierbar — es braucht eine echte clientseitige Navigation (Playwright-Klick auf einen Link, kein `page.goto` auf die Zielroute).

- [ ] **Step 1: Fehlschlagenden Test schreiben**

`apps/web/src/lib/content-security-policy.spec.ts`, ergänze die beiden bestehenden `script-src`-Assertions (nicht ersetzen, sondern die erwartete Zeichenkette anpassen — sie erwarten aktuell `"script-src 'self' 'nonce-test-nonce-123'"` ohne `'strict-dynamic'`):

```ts
  it("traegt die Nonce in script-src statt 'unsafe-inline'", () => {
    const policy = buildContentSecurityPolicy({
      apiOrigin: "https://api.example.test",
      reportUri: "https://api.example.test/api/v1/csp-reports",
      allowEval: false,
      nonce: "test-nonce-123",
    });

    expect(policy).toContain("script-src 'self' 'nonce-test-nonce-123' 'strict-dynamic'");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it("erlaubt unsafe-eval weiterhin nur im Entwicklungsserver, zusaetzlich zur Nonce", () => {
    const policy = buildContentSecurityPolicy({
      apiOrigin: "https://api.example.test",
      reportUri: "https://api.example.test/api/v1/csp-reports",
      allowEval: true,
      nonce: "test-nonce-123",
    });

    expect(policy).toContain("script-src 'self' 'nonce-test-nonce-123' 'strict-dynamic' 'unsafe-eval'");
  });
```

**Korrektur (nach Ausführung durch den Implementierer):** Die Annahme "vier unveränderte Tests" war falsch — der Test `erlaubt \`eval\` nur im Entwicklungsserver und nur fuer Skripte` (Zeile 44) prüft ebenfalls einen zusammenhängenden Teilstring `"script-src 'self' 'nonce-test-nonce-default' 'unsafe-eval'"`, der durch das eingefügte `'strict-dynamic'` unterbrochen wird — derselbe Fehlermodus wie bei den zwei oben bereits korrigierten Tests, nur mit dem Standard-`options`-Objekt statt Ad-hoc-Literalen. **Ruling:** Auch diese Zeile auf `"script-src 'self' 'nonce-test-nonce-default' 'strict-dynamic' 'unsafe-eval'"` ändern — reiner Textstring-Fix, keine Verhaltensänderung, die nachfolgende `.match(/unsafe-eval/gu)).toHaveLength(1)`-Prüfung bleibt unverändert korrekt (weiterhin genau ein Vorkommen).

Die übrigen drei Tests in der Datei (`erlaubt eval im Produktionsbuild nicht`, `laesst die Seite mit der API sprechen`, `haelt die scharfen Direktiven`) bleiben unverändert — sie prüfen nicht die exakte `script-src`-Zeichenkette, sondern `.toContain`/`.not.toContain` auf Teilstrings, die von dieser Änderung nicht berührt werden.

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `cd apps/web && npx vitest run src/lib/content-security-policy.spec.ts`
Expected: Die zwei geänderten Fälle FAIL (kein `'strict-dynamic'` im erzeugten String), die vier unveränderten PASS weiterhin.

- [ ] **Step 3: Implementierung**

`apps/web/src/lib/content-security-policy.ts`, `scriptSource`-Berechnung:

```ts
  const scriptSource = allowEval
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;
```

(`'self'` bleibt in der Zeichenkette stehen — CSP-Auswertung ignoriert es unter `'strict-dynamic'` für `script-src` automatisch zugunsten der Nonce/Propagation, ältere Browser ohne `'strict-dynamic'`-Unterstützung fallen sonst auf gar keine Skript-Erlaubnis zurück. Das ist die von der CSP3-Spec vorgesehene Fallback-Reihenfolge, kein Fehler.)

Doc-Kommentar bei `nonce` im `ContentSecurityPolicyOptions`-Interface ergänzen: ein Halbsatz, dass `'strict-dynamic'` seit dieser Nacharbeit dazugehört und warum (Verweis auf diesen Plan).

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `cd apps/web && npx vitest run src/lib/content-security-policy.spec.ts`
Expected: Alle 6 Fälle PASS.

- [ ] **Step 5: Produktivbuild bauen, clientseitige Navigation pruefen (siehe "Risiko" oben)**

Run: `pnpm build` (Root-Skript, laedt `.env`), dann `cd apps/web && npx next start --port 3000` (vorher pruefen, ob Port 3000 frei ist; Prozess danach wieder beenden).

In einem zweiten Terminal — **kein** `curl`/`page.goto` allein reicht hier, es muss eine echte clientseitige Navigation sein:

```bash
npx playwright screenshot --browser=chromium http://localhost:3000/ /tmp/csp-strict-dynamic-check.png 2>&1 | head -5
```

reicht NICHT aus (das ist ein voller Seitenaufruf). Stattdessen ein kurzes Wegwerf-Skript oder eine manuelle Playwright-Session, die:
1. `http://localhost:3000/` per `page.goto` lädt (voller Aufruf — muss ohnehin fehlerfrei sein),
2. per `page.click()` auf einen internen `<Link>` klickt, der zu einer ANDEREN Route navigiert (z. B. von `/` zu einer Route mit eigenem JS-Chunk),
3. dabei auf `securitypolicyviolation`-Ereignisse horcht (Muster aus `tests/fixtures.ts` übernehmen).

Expected: Null CSP-Verstösse bei Schritt 2 (der clientseitigen Navigation). Gibt es welche, **nicht committen** — das wäre der Beweis, dass `'strict-dynamic'` das Chunk-Nachladen bricht; dann Step 3 zurücknehmen und BLOCKED melden statt einen Workaround zu improvisieren.

- [ ] **Step 6: E2E-Suite laufen lassen**

Run: `pnpm test:e2e`
Expected: Weiterhin grün (läuft gegen `next dev`, `'unsafe-eval'` erlaubt — prüft nicht dasselbe wie Step 5, aber muss trotzdem grün bleiben).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/content-security-policy.ts apps/web/src/lib/content-security-policy.spec.ts
git commit -m "feat(web): strict-dynamic zu script-src ergaenzen"
```

---

## Task 2: CSP zusätzlich auf die Request-Header setzen

**Files:**
- Modify: `apps/web/src/proxy.ts`

**Interfaces:**
- Consumes: nichts Neues.
- Produces: keine neue exportierte API, reine Robustheits-Ergänzung.

**Kontext:** `proxy.ts` setzt die Nonce/CSP heute nur auf die Response-Header (`response.headers.set(...)`). Next.js' eigener Renderer liest die Nonce für seinen Inline-Bootstrap aus den Request-Headern (`getScriptNonceFromHeader`, siehe `node_modules/next/dist/server/app-render/app-render.js`); das funktioniert aktuell nur, weil der Node-Server intern jeden Response-Header zusätzlich in `req.headers` spiegelt (`node_modules/next/dist/server/lib/router-utils/resolve-routes.js`) — ein Next.js-internes Verhalten ohne Vertragscharakter. Das offizielle Doku-Beispiel setzt die CSP deshalb explizit auf **beide**. Diese Task macht die Implementierung unabhängig von diesem internen Kopiervorgang.

- [ ] **Step 1: `requestHeaders` ergänzen**

`apps/web/src/proxy.ts`, direkt nach der bestehenden Zeile `requestHeaders.set("x-nonce", nonce);`:

```ts
  requestHeaders.set("x-nonce", nonce);
  // Next.js liest die Nonce fuer seinen eigenen Bootstrap aus den
  // Request-Headern (app-render.js); das funktioniert heute nur, weil der
  // Node-Server Response- in Request-Header spiegelt (resolve-routes.js) --
  // kein garantiertes Verhalten. Explizit setzen macht das unabhaengig davon.
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
```

Kein weiterer Header (`Reporting-Endpoints`) auf die Request-Header nötig — den liest nur der Browser aus der Response, nicht Next.js selbst.

- [ ] **Step 2: Verifizieren**

Run: `pnpm build && cd apps/web && npx next start --port 3000` (Port danach wieder freigeben), dann `curl -sI http://localhost:3000/ | grep -i content-security-policy` und `curl -s http://localhost:3000/ | grep -o 'nonce="[^"]*"' | sort -u` — erwartet: genau ein eindeutiger Nonce-Wert über alle Vorkommen, identisch mit dem im Response-Header. Verhalten unverändert gegenüber vor dieser Task (das ist der Punkt: robuster, nicht anders).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/proxy.ts
git commit -m "fix(web): CSP zusaetzlich explizit auf Request-Header setzen"
```

---

## Task 3: E2E-Fall gegen den echten Produktivbuild

**Files:**
- Create: `apps/web/playwright.prod.config.ts`
- Create: `apps/web/tests/production-csp.spec.ts`
- Modify: `apps/web/package.json` (neues Skript `test:e2e:prod`)

**Interfaces:**
- Consumes: `tests/fixtures.ts` (CSP-Verstoss-Wache, wiederverwendet).
- Produces: neues, eigenständiges Skript `pnpm --filter @darts-platform/web test:e2e:prod` — bewusst NICHT Teil von `pnpm test:e2e` (das bestehende Skript bleibt unverändert, läuft weiterhin gegen `next dev`). Kein CI-Integrations-Zwang in dieser Task — das ist eine reine Kostenentscheidung (zusätzliche Build-Zeit in jedem CI-Lauf), die hier bewusst offengelassen wird; siehe Self-Review.

**Kontext:** Die bestehende `securitypolicyviolation`-Wache (`tests/fixtures.ts`, genutzt in `tests/security-headers.spec.ts` u. a.) läuft ausschliesslich gegen `next dev` (kein vorgerendertes Statisches, `'unsafe-eval'` erlaubt) — sie beweist nicht, dass im echten Produktivbuild nichts mehr statisch ist oder dass `'strict-dynamic'` (Task 1) das Chunk-Nachladen nicht bricht. Diese Task baut eine zweite, unabhängige Playwright-Konfiguration, die `next build && next start` startet statt `next dev`.

- [ ] **Step 1: `playwright.prod.config.ts` erstellen**

```ts
// apps/web/playwright.prod.config.ts
import { defineConfig, devices } from "@playwright/test";

const webPort = Number(process.env.PLAYWRIGHT_PROD_WEB_PORT ?? 3_200);
const webOrigin = `http://localhost:${webPort}`;

/**
 * Eigenstaendige Konfiguration gegen den echten Produktivbuild statt
 * `next dev` (siehe `playwright.config.ts`). Deckt zwei Luecken, die die
 * Haupt-E2E-Suite strukturell nicht abdecken kann: kein vorgerendertes
 * Statisches mehr (Task 4 aus `2026-09-08-csp-nonce.md`) und `'strict-dynamic'`
 * bricht das Chunk-Nachladen bei clientseitiger Navigation nicht (Task 1
 * dieses Plans). Braucht keinen API-Server -- die geprüften Seiten
 * (Startseite, `/offline`, `/liga/begegnungen`, `/live/begegnungen`) rufen
 * keine authentifizierten Daten ab.
 */
export default defineConfig({
  testDir: "./tests",
  testMatch: /production-csp\.spec\.ts/u,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: "list",
  use: {
    baseURL: webOrigin,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm build && npx next start --port ${webPort}`,
    url: webOrigin,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
```

- [ ] **Step 2: `tests/production-csp.spec.ts` erstellen**

```ts
// apps/web/tests/production-csp.spec.ts
import { expect, test } from "./fixtures";

/**
 * Prueft echten Produktivbuild-Verhalten, das `next dev` strukturell nicht
 * zeigen kann: kein `'unsafe-eval'`, keine vorgerenderten statischen Seiten
 * ohne Nonce (Task 4, `2026-09-08-csp-nonce.md`), und `'strict-dynamic'`
 * bricht clientseitige Navigation nicht (Task 1, dieser Plan).
 */
const previouslyStaticRoutes = ["/", "/offline", "/liga/begegnungen", "/live/begegnungen"];

for (const route of previouslyStaticRoutes) {
  test(`${route}: keine CSP-Verstoesse, keine unsafe-eval im Produktivbuild`, async ({ page }) => {
    // Der `cspViolations`-Fixture aus `./fixtures` ist `{ auto: true }` und
    // scheitert diesen Fall von sich aus, sobald der Browser waehrend des
    // Tests einen `securitypolicyviolation` meldet -- kein eigenes Assert
    // noetig (siehe `fixtures.ts:76`, kein bestehender Spec referenziert
    // `cspViolations` direkt).
    const response = await page.goto(route);
    if (response === null) {
      throw new Error(`Fuer ${route} kam keine Antwort zurueck.`);
    }

    const contentSecurityPolicy = response.headers()["content-security-policy"];
    expect(contentSecurityPolicy).toBeDefined();
    expect(contentSecurityPolicy).not.toContain("unsafe-eval");
    expect(contentSecurityPolicy).toContain("'strict-dynamic'");
  });
}

test("clientseitige Navigation von / zu /offline verletzt strict-dynamic nicht", async ({ page }) => {
  // Direkte Navigation statt Link-Klick: `/offline` hat keinen eigenen
  // Aufrufer in der Navigation, ist aber die sicherheitskritischste Route
  // (Service-Worker-Fallback) und laedt ihren eigenen JS-Chunk clientseitig
  // nach, sobald sie erreicht wird -- das ist der Fall, den 'strict-dynamic'
  // treffen wuerde, wenn Webpacks Chunk-Nachladen die Nonce nicht propagiert.
  // Scheitert automatisch ueber den auto-Fixture bei einem Verstoss.
  await page.goto("/");
  await page.evaluate(() => {
    window.history.pushState({}, "", "/offline");
  });
  await page.goto("/offline");
});
```

- [ ] **Step 3: `package.json`-Skript ergänzen**

`apps/web/package.json`, `scripts`-Block, nach `"test:e2e"`:

```json
    "test:e2e:prod": "playwright test --config=playwright.prod.config.ts",
```

- [ ] **Step 4: Ausführen, Erfolg bestätigen**

Run: `cd apps/web && npx dotenv -e ../../.env -- pnpm test:e2e:prod`
Expected: Alle Fälle PASS, keine CSP-Verstösse.

- [ ] **Step 5: Commit**

```bash
git add apps/web/playwright.prod.config.ts apps/web/tests/production-csp.spec.ts apps/web/package.json
git commit -m "test(web): E2E-Fall gegen den echten Produktivbuild fuer CSP/strict-dynamic ergaenzen"
```

---

## Task 4: Zod `jitless` setzen — CSP-Meldungen aus dem eingebauten `eval`-Fähigkeitstest vermeiden

**Files:**
- Modify: `apps/web/src/components/providers.tsx`

**Interfaces:**
- Consumes: `z` aus `zod` (bereits Projektabhängigkeit, `zod@4.4.3`).
- Produces: keine neue exportierte API. `z.config({ jitless: true })` als Modul-Seiteneffekt.

**Kontext:** Während Task 1 (siehe Ledger) fiel bei der clientseitigen Navigationsprüfung auf, dass jeder Produktiv-Seitenaufruf zwei `script-src → eval`-CSP-Meldungen erzeugt, unabhängig von `'strict-dynamic'` (per Git-Stash-Isolation bestätigt — existiert bereits im ungeänderten `feature/csp-nonce`-Stand). Ursache: Zod v4 prüft beim ersten Schema-Zugriff pro Bundle-Kopie einmalig per `try { Function(""), !0 } catch { !1 }`, ob JIT-Kompilierung (schnellere generierte Validatoren) möglich ist — unter der erzwungenen CSP ohne `'unsafe-eval'` schlägt das fehl. Der Fehler ist bereits abgefangen (kein Funktionsbruch, Zod fällt auf den interpretierten Pfad zurück), aber jeder fehlgeschlagene Versuch meldet einen echten CSP-Verstoss an `/api/v1/csp-reports`. Zod dokumentiert für genau diesen Fall ein offizielles Flag: `$ZodConfig.jitless` — *"Disable JIT schema compilation. Useful in environments that disallow `eval`."* (`node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/core.d.ts:67`). Aktuell nirgends im Repo gesetzt (geprüft: `grep -rn "jitless\|z.config" packages/schemas/src apps/web/src apps/api/src` findet nichts).

`z.config()` schreibt auf `globalThis.__zod_globalConfig` — ein echter Singleton pro JS-Realm, gemeinsam für alle gebündelten Zod-Kopien in diesem Realm (siehe `zod/src/v4/classic/tests/global-config.test.ts`, Kommentar zum genau dafür behobenen Footgun). Server-seitig (Node, `apps/api`) betrifft der eval-Block CSP-technisch nichts (kein Browser, keine CSP) — das Flag muss nur clientseitig im Browser-Realm gesetzt sein, bevor die erste Zod-Validierung dort läuft.

- [ ] **Step 1: Bestand prüfen**

Run: `grep -rn "jitless\|z.config" apps/web/src`
Expected: 0 Treffer (Bestätigung, dass das Flag noch nirgends gesetzt ist).

- [ ] **Step 2: Implementierung**

`apps/web/src/components/providers.tsx` ist die erste clientseitige Komponente, die das Root-Layout auf jeder Seite rendert (`"use client"`, importiert von `apps/web/src/app/layout.tsx`) — der früheste garantierte Ausführungspunkt im Browser, bevor irgendeine App-Komponente eine Zod-Validierung auslösen kann. Ganz oben in der Datei, nach der `"use client"`-Direktive und vor den bestehenden Imports (oder direkt danach — Reihenfolge unter den Imports ist unerheblich, wichtig ist nur: vor der ersten Komponentendefinition):

```tsx
"use client";

import { z } from "zod";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { PwaRegistration } from "./pwa-registration";

// Zod prueft beim ersten Schema-Zugriff einmalig per `Function("")`, ob JIT-
// Kompilierung moeglich ist (Performance-Optimierung). Unter der erzwungenen
// CSP (kein 'unsafe-eval' in Production) schlaegt das fehl -- Zod faengt den
// Fehler bereits ab (kein Funktionsbruch), meldet aber einen echten
// `script-src`-Verstoss an `/api/v1/csp-reports`. `jitless` ist Zods eigenes
// Flag genau fuer "environments that disallow eval" -- vermeidet den Test
// von vornherein, statt ihn scheitern zu lassen. Muss vor der ersten
// Zod-Validierung im Browser gesetzt sein; `Providers` ist die erste
// clientseitige Komponente, die jede Seite rendert.
z.config({ jitless: true });
```

- [ ] **Step 3: Verifizieren**

Run: `pnpm build` (Root-Skript), dann `cd apps/web && npx next start --port 3100` (Port vorher freihalten, danach beenden). In einem zweiten Terminal ein Wegwerf-Playwright-Skript nach demselben Muster wie in Task 1s Verifikation (oder die bereits vorhandene `securitypolicyviolation`-Wache aus `tests/fixtures.ts` gegen `http://localhost:3100/` per eigenem Skript nutzen): `page.goto("http://localhost:3100/")`, auf `securitypolicyviolation` horchen.
Expected: **0** Verstösse (vorher: 2, aus den beiden Zod-Bundle-Kopien in Task 1s Bericht). Falls weiterhin Verstösse auftreten, die nicht eindeutig unrelated sind (Task 1s Bericht kennt keine anderen): anhalten, nicht committen, BLOCKED melden.

- [ ] **Step 4: Bestehende Tests laufen lassen**

Run: `cd apps/web && npx vitest run` und `pnpm test:e2e`
Expected: Beide unverändert grün — diese Task ändert keine Schema-Validierungslogik, nur ob Zod intern JIT versucht.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/providers.tsx
git commit -m "fix(web): Zod jitless setzen, um eval-CSP-Meldungen zu vermeiden"
```

---

## Self-Review

- **Spec-Abdeckung:** Alle drei im Abschlussreview von `2026-09-08-csp-nonce.md` genannten Nacharbeiten sind abgedeckt (Task 1-3). Task 4 ist ein während Task 1 entdeckter, vom Nutzer per Rückfrage bestätigter Zusatz — kein Teil der ursprünglichen Drei-Punkte-Liste, aber inhaltlich direkt an diesem Plan haengend (dieselbe CSP-Meldungsqualität, die der ganze Plan verbessern soll).
- **Platzhalter-Scan:** keine. `tests/fixtures.ts` wurde vor dem Schreiben von Task 3 gelesen — der `cspViolations`-Fixture ist `{ auto: true }` und scheitert jeden Fall von sich aus bei einem Verstoss; kein bestehender Spec referenziert ihn explizit, Task 3 folgt derselben Konvention.
- **Reihenfolge:** Task 1 und Task 2 sind unabhängig voneinander (verschiedene Dateien). Task 4 ist unabhängig von 1/2 (andere Datei), sollte aber vor Task 3 laufen, damit Task 3s E2E-Fall die jetzt vermiedenen Zod-`eval`-Verstösse nicht als unerwarteten Fund aufdeckt (Task 3s Routen — `/`, `/offline`, `/liga/begegnungen`, `/live/begegnungen` — laden alle clientseitig Code, der Zod importiert, z. B. ueber `api-client.ts`). Dispatch-Reihenfolge: 2 → 1 → 4 → 3.
- **Bewusst nicht Teil dieses Plans:** CI-Integration von `test:e2e:prod` (Kostenentscheid, siehe Tier-3-Backlog "Reine Konfigurations-/Kostenentscheide"); jede weitere `'strict-dynamic'`-Härtung über diese eine Direktive hinaus; eine tiefere Zod-Performance-Untersuchung, ob `jitless` spuerbare Latenz kostet (laut Zod-Doku ist der interpretierte Pfad der Fallback ohnehin, kein neuer Codepfad).
- **Risiko:** Task 1 ist die einzige der drei mit echtem Production-Bruchrisiko (Chunk-Nachladen). Task 5 dort verlangt deshalb eine echte clientseitige Navigation, nicht nur einen vollen Seitenaufruf — vor dem Commit tatsächlich ausführen, nicht nur aus der Next.js-Doku übernehmen.
