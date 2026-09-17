# Protokoll: komplette E2E-Suite gegen den Produktivbuild (Spec C3)

Datum: 17.09.2026. Befehl (Worktree-Root): `pnpm run test:e2e:prod`
(entspricht dem neuen CI-Schritt „End-to-end test gegen Produktivbuild").
Baut zuerst dieselben acht Pakete wie `pnpm test:e2e` (Turbo, alle Cache-Hits
in diesem Lauf), danach `dotenv -e .env -- pnpm --filter @darts-platform/web
test:e2e:prod`, was ueber `apps/web/scripts/run-e2e.mjs` (siehe
„Entscheidungen") `playwright test --config=playwright.prod.config.ts`
ausfuehrt.

## Ergebnis

**Erster Lauf** (vor der Behebung, siehe unten): 27 von 29 Faellen gruen,
2 rot, 1 Worker, ca. 1,6 Minuten reine Testlaufzeit (Gesamtlauf inkl. beider
Produktivbuilds und DB-Migration unter 3 Minuten lokal mit warmen Caches —
im CI ohne warme Caches ist mit deutlich mehr Zeit zu rechnen, siehe
Aufgabenstellung). Dieselben Spezifikationen wie im Dev-Lauf liefen
zusaetzlich zu `production-csp.spec.ts` (5 Faelle, alle gruen). API und Web
liefen dabei ueber `pnpm --filter @darts-platform/api... build && node
../../scripts/start-api.mjs` bzw. `pnpm --filter @darts-platform/web...
build && npx next start` auf den Ports 3201/3200 — beide Server wurden
gesund (Health-Check bzw. Startseite) und bedienten den kompletten
Testlauf, inklusive Faellen mit echten Backend-Ablaeufen
(Organisation/Turnier/Team-Begegnung anlegen, Scoreboard, Spieler-Avatar).
Das bestaetigt, dass die neue Zwei-Server-Konfiguration in
`playwright.prod.config.ts` funktioniert.

Beide roten Faelle traten nur auf, weil hier tatsaechlich gegen `next
build`/`next start` statt `next dev` getestet wird. Nach Ruling durch die
Kontrolle wurden beide in `playwright.prod.config.ts` behoben (Details bei
den jeweiligen Befunden), ohne eine Spezifikation zu veraendern oder
abzuschwaechen.

**Zweiter Lauf** (nach der Behebung, gleicher Befehl, warme Caches): **28
von 28 Faellen gruen**, 1 Worker, 1,5 Minuten reine Testlaufzeit, Exit-Code
0. `security-headers.spec.ts` ist jetzt regulaer ausgeschlossen (28 statt 29
Faelle insgesamt), `foundation.spec.ts:599` ist gruen.

### Befund 1: `tests/security-headers.spec.ts:3` — „die Weboberflaeche liefert die Sicherheits-Header"

```
Expected substring: "'unsafe-eval'"
Received string:    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'nonce-38e2c1b4-d664-4129-b5c7-cbd9133d172f' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http://localhost:3201; font-src 'self' data:; connect-src 'self' http://localhost:3201 ws://localhost:3201; report-uri http://localhost:3201/api/v1/csp-reports; report-to csp-endpoint"
```

Erwartbar und im Spec selbst dokumentiert: der Kommentar direkt ueber dem
Assert sagt „Dieser Lauf faehrt `next dev`, und dessen Uebersetzer braucht
`eval`. Dass der Produktionsbuild es nicht bekommt, prueft
`src/lib/content-security-policy.spec.ts`". Der Fall pruefte bisher nur
gegen `next dev`; gegen den Produktivbuild fehlt `'unsafe-eval'`
erwartungsgemaess (die Abwesenheit ist korrektes Verhalten, siehe
`production-csp.spec.ts`, das genau das Gegenteil verlangt und gruen ist).
Kein Fix an der Spezifikation vorgenommen (fachlich nicht falsch, deckt
bewusst nur Dev ab).

**Loesung (nach Ruling):** `playwright.prod.config.ts` schliesst den Fall
jetzt regulaer aus (`testIgnore: /security-headers\.spec\.ts/u`, analog zum
umgekehrten `testIgnore` in `playwright.config.ts` fuer
`production-csp.spec.ts`) statt ihn rot mitlaufen zu lassen. Das
Produktivverhalten bleibt durch `production-csp.spec.ts` abgedeckt.

### Befund 2: `tests/foundation.spec.ts:599` — „stellt einen Anzeige-Schluessel aus und oeffnet damit die Board-Ansicht eines privaten Turniers"

```
Error: page.evaluate: TypeError: Failed to fetch
Error: Die Seite hat gegen die Content-Security-Policy verstossen:
  connect-src → http://localhost:3101/api/v1/organizations/.../tournaments/.../dashboard
```

Ursache: der Fall ermittelt die API-Adresse fuer einen direkten
`fetch`-Aufruf (um Board-/oeffentliche ID aus dem Dashboard zu lesen) selbst
ueber `process.env.PLAYWRIGHT_API_PORT ?? 3_101`
(`apps/web/tests/foundation.spec.ts:665`). Dieser Name gilt nur fuer die
Dev-Konfiguration (`playwright.config.ts`); die Produktivkonfiguration
verwendet bewusst einen eigenen Port ueber `PLAYWRIGHT_PROD_API_PORT`
(Default 3201), damit ein gleichzeitiger Dev-Lauf nicht kollidiert. Der Fall
faellt deshalb auf den Dev-Default 3101 zurueck, wo im Produktivlauf kein
Server lauscht — die CSP blockiert den Versuch zusaetzlich sichtbar, noch
bevor der Verbindungsfehler selbst aufschlaegt. Kein Befund an der
Produktivkonfiguration oder am CSP-Verhalten, sondern ein bestehender Fall,
der einen Konfigurationswert hart codiert, statt ihn passend zur jeweiligen
Playwright-Konfiguration zu lesen.

**Loesung (nach Ruling):** die Spezifikation bleibt unveraendert. Stattdessen
setzt `playwright.prod.config.ts` direkt nach dem Berechnen von `apiPort`
`process.env.PLAYWRIGHT_API_PORT = String(apiPort)`. Playwright-Worker erben
die Umgebung des Konfigurationsprozesses, wodurch `foundation.spec.ts` beim
eigenen direkten `fetch` denselben Port sieht, auf dem der Produktiv-API-
Server tatsaechlich lauscht (3201 statt des Dev-Defaults 3101). Ein Grep
(`grep -rn PLAYWRIGHT_WEB_PORT tests/`) zeigt, dass kein Spec
`PLAYWRIGHT_WEB_PORT` direkt liest — dafuer war keine analoge Ergaenzung
noetig.

## Entscheidungen

- **`webServer` als Zwei-Server-Array**: analog `playwright.config.ts`, aber
  mit den Produktivbefehlen aus dem Task-Brief. Eigene Ports
  (`PLAYWRIGHT_PROD_WEB_PORT` 3200, `PLAYWRIGHT_PROD_API_PORT` 3201) und ein
  eigenes `NEXT_DIST_DIR` (`.next-e2e-prod`), damit ein Produktivlauf einen
  gleichzeitigen Dev-E2E-Lauf nicht stoert.
- **`node_modules/next/dist/lib/verify-typescript-setup.js` regeneriert
  `next-env.d.ts` auch bei `next build`**, nicht nur bei `next dev` (ruft
  dieselbe `writeAppTypeDeclarations`-Funktion mit dem aktiven `distDir`
  auf). `apps/web/package.json` ruft `test:e2e:prod` deshalb wie `test:e2e`
  ueber `node scripts/run-e2e.mjs --config=playwright.prod.config.ts` auf,
  statt Playwright direkt zu starten — derselbe Wrapper sichert und
  restauriert `next-env.d.ts` unabhaengig davon, welche Konfiguration lief.
  `run-e2e.mjs` ist dafuer bewusst konfigurationsunabhaengig geblieben (kein
  eigener Zweig fuer Dev/Prod noetig).
- **Root-Skript `test:e2e:prod`**: baut dieselben acht Pakete wie
  `test:e2e` (Turbo-Filter identisch) und ruft danach `dotenv -e .env --
  pnpm --filter @darts-platform/web test:e2e:prod`. Genutzt vom neuen
  CI-Schritt, damit CI und lokaler Lauf denselben Befehl teilen.
- **`.gitignore`**: `.next-e2e-prod/` ergaenzt (bisher stand nur `.next/`
  und `.next-e2e/` drin).
- **CI-Platzierung**: neuer Schritt „End-to-end test gegen Produktivbuild"
  direkt nach „End-to-end test", vor dem Sichern der Playwright-Berichte
  (dieselben Artefaktpfade decken beide Laeufe ab).
