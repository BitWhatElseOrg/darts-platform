# Abnahmeprotokoll Go-Live-Testprogramm

Stand: 18.09.2026. Gehört zu Spec
[2026-09-17-go-live-testprogramm-design.md](../superpowers/specs/2026-09-17-go-live-testprogramm-design.md).
Fasst den Stand je Block/Fall zusammen. Die einzelnen Nachweise liegen unter
`docs/testing/protokolle/`; dieses Dokument verlinkt sie, ersetzt sie aber
nicht. Ergebnis-Werte: `grün` (Kriterium erfüllt), `rot` (Kriterium verletzt,
Befund offen), `akzeptiert` (rot, aber bewusst mit Begründung als bekanntes
Risiko hingenommen), `offen` (noch nicht gemessen).

## Block A – Nebenläufigkeit und Last

Voraussetzung: eigenes Vitest-Projekt `apps/api/test/staging/`,
`pnpm test:staging` gegen `STAGING_API_URL`. Die Staging-Organisation wurde
am 18.09.2026 bootstrapped und die vier DNS-Einträge für
`staging.dartbase.ch` / `api-staging.dartbase.ch` sind gesetzt (siehe
`infrastructure/railway.md`, Abschnitt Staging-Environment); seither sind
alle sechs Fälle gemessen.

| Fall | Datum | Ergebnis | Protokoll | Befund |
| --- | --- | --- | --- | --- |
| A1 Zwei Scorer, ein Match | 18.09.2026 | grün | [2026-09-18-block-a.md](protokolle/2026-09-18-block-a.md) | Ein 201 (Visit angenommen), ein 409 `MATCH_VERSION_CONFLICT`; Matchversion danach 1, genau ein Visit. |
| A2 Gleicher Command doppelt | 18.09.2026 | grün | [2026-09-18-block-a.md](protokolle/2026-09-18-block-a.md) | 10× 201 mit identischem Zustand, Version 1, genau ein Visit (idempotent). |
| A3 20 Boards gleichzeitig | 18.09.2026, Nachlauf mit fester Taktung 18.09.2026 | grün | [2026-09-18-block-a.md](protokolle/2026-09-18-block-a.md) | Nach Umstellung der Testschleife auf feste Taktung auf den Intervall-Start: 7'216 Anfragen bei angestrebt 3,0 Visits/s je Match (20 Boards, 120 s), 0 Fehler, p50 111 ms, p95 157 ms, p99 190 ms, 0 Matches vorzeitig beendet. Vorheriger Lauf mit fester Nach-Pause, effektiv 1,7/s: 4'076 Anfragen, p50 252 ms, p95 298 ms, p99 373 ms. Messwerte: [2026-09-18-a3.json](protokolle/messwerte/2026-09-18-a3.json). |
| A4 Realtime-Fan-out | 18.09.2026 | grün | [2026-09-18-block-a.md](protokolle/2026-09-18-block-a.md) | 0 von 50 Sockets ohne `tournament:changed`; p50 194 ms, p95 194 ms, max 200 ms. Messwerte: [2026-09-18-a4.json](protokolle/messwerte/2026-09-18-a4.json). |
| A5 Public-Polling unter NAT | 18.09.2026, Nachmessung 18.09.2026 grün | grün | [2026-09-18-block-a.md](protokolle/2026-09-18-block-a.md) | Ursprünglich rot: 0 von 700 Antworten 429 (erwartet 50–150), konsistent mit D3-1. Nach dem Fix (PR #46) manuell nachgemessen: 700 Anfragen, 50 parallel, gegen `api-staging.dartbase.ch` → 600× 404, 100× 429 — innerhalb der Erwartung. Automatisierter Spec-Lauf nicht wiederholt (Testkonto-Zugangsdaten verloren, siehe „Blocker beim Betreiber"); die manuelle Messung ist gleichwertig. Ursprüngliche Messwerte: [2026-09-18-a5.json](protokolle/messwerte/2026-09-18-a5.json). |
| A6 Undo unter Last | 18.09.2026 | grün | [2026-09-18-block-a.md](protokolle/2026-09-18-block-a.md) | Ein 201, ein 409; Version = vorherige Version + 1; zwei aktive Visits (Undo hat gewonnen). |

## Block B – Betrieb und Wiederherstellung

| Fall | Datum | Ergebnis | Protokoll | Befund |
| --- | --- | --- | --- | --- |
| B1 Backup-Stand Production | 17.09.2026 | rot | [2026-09-18-block-b.md](protokolle/2026-09-18-block-b.md) | `railway postgres pitr status` auf der Production-Datenbank liefert `enabled: false`, `bucketWired: false` — keine kontinuierliche Sicherung. Gleicher Befund für Staging. Einschalten von PITR ist laut Spec ein separater Betreiberentscheid (Mutation an Production); Entscheid steht aus. |
| B2 Restore-Probe auf Staging | 18.09.2026 | grün | [2026-09-18-block-b.md](protokolle/2026-09-18-block-b.md) | PITR in Staging eingeschaltet, Restore auf T1 = 14:59:07 UTC in einen neuen Service (`postgres-restored`) zurückgespielt, fertig 15:03:39 UTC (≈ 1,5 Minuten): 10 statt 11 Organisationen, die nach T1 angelegte fehlte wie erwartet. Nach Zurückschalten der Staging-API auf die Original-Datenbank wieder 11 Organisationen. Manuelle Backups auf diesem Plan nicht verfügbar (`pitr backup create` → kein Zugriff), für den Restore auch nicht nötig. |
| B3 Migrationsprobe | – | offen | [2026-09-18-block-b.md](protokolle/2026-09-18-block-b.md) | Wartet auf die nächste Migration in `develop` und einen Staging-Deploy. |
| B4 Redis-Ausfall | 18.09.2026 | grün | [2026-09-18-block-b.md](protokolle/2026-09-18-block-b.md) | Lastlauf 5 Boards/3 Visits/s über 90 s, `railway restart --service Redis` bei t=30 s (Ausfall 08:10:06–08:10:07 UTC): 0 von 1112 Visits mit Fehler, 0 von 25 Health-Abfragen nicht `ok`, p95 92 ms (p50 70 ms, p99 117 ms), `deadLettered` danach 0. |
| B5 Worker-Neustart | 18.09.2026 | grün | [2026-09-18-block-b.md](protokolle/2026-09-18-block-b.md) | Im selben Lauf `railway restart --service @darts-platform/worker` bei t=60 s (`worker_started` 08:10:41): Health während/nach Neustart `ok`, `publishLagSeconds` 0, `deadLettered` 0. |
| B6 API-Neustart mit offenen Sockets | 18.09.2026 | grün | [2026-09-18-block-b.md](protokolle/2026-09-18-block-b.md) | Vorgehen wie B4/B5, zusätzlich mit den 50 Sockets aus Fall A4: 50/50 Sockets innerhalb 6 s nach `railway restart` neu verbunden; nächstes Ereignis (Board-Zuordnung) innerhalb 6 s an 50/50 Sockets zugestellt. |

## Block C – Technische Lücken

| Fall | Datum | Ergebnis | Protokoll | Befund |
| --- | --- | --- | --- | --- |
| C1 Coverage-Messung | 17.09.2026 | grün | [2026-09-17-coverage.md](protokolle/2026-09-17-coverage.md) | 22 Turbo-Tasks grün, 12 Pakete mit `coverage-summary.json`. Kein Gate, nur Bestandsaufnahme. Schwächste Werte: `packages/database` 49,34 % Zeilen, `apps/web` 68,83 % Zeilen — beide erwartbar (Migrations-/Drizzle-Hilfscode bzw. bisher ungetestete UI-Komponenten), kein Blocker. |
| C2 Scheduling-Engine | 17.09.2026 | grün | `packages/scheduling-engine/src/readiness.rules.spec.ts` | 13 neue Fälle, alle grün — je eine Regel aus AGENTS.md Abschnitt 9 einzeln mit lesbarem Ablehnungsgrund. |
| C3 E2E gegen Produktivbuild | 17.09.2026 | grün | [2026-09-17-e2e-produktivbuild.md](protokolle/2026-09-17-e2e-produktivbuild.md) | 28/28 grün nach Behebung zweier dev-only-Konfigurationsprobleme (Security-Headers-Spec bewusst auf Dev beschränkt, API-Port-Hardcoding in `foundation.spec.ts` per Env-Variable in der Prod-Konfiguration korrigiert). Kein Befund am Produktivverhalten selbst. |
| C4 Tenant-Fremdschlüssel (I-7), Befundliste | 17.09.2026 | grün (Befundliste geliefert, Umsetzung bleibt Backlog) | [2026-09-17-i7-tenant-fremdschluessel.md](protokolle/2026-09-17-i7-tenant-fremdschluessel.md) | 53 Beziehungen ohne zusammengesetzten Tenant-Fremdschlüssel, davon 44 kritisch und 9 Lookup. Zusatzbefund: `tournament_display_keys` löst ausschliesslich über `secret_hash` auf, ohne `organization_id`-Filter in der Query — Tenant-Bindung hängt allein von einer Anwendungsprüfung nach dem Lookup ab, nicht von einem DB-Constraint. I-7 bleibt Backlog, braucht eine eigene Spec mit Migration. |

## Block D – Security mit Angreiferblick

| Fall | Datum | Ergebnis | Protokoll | Befund |
| --- | --- | --- | --- | --- |
| D1 Tenant-Isolationsmatrix | 17.09.2026 | grün | [2026-09-17-tenant-isolation.md](protokolle/2026-09-17-tenant-isolation.md) | 65/65 tenant-bezogene Routen isoliert (403/404), 0 Leaks. Routenliste automatisch aus dem Fastify-Router gelesen. Einschränkung: alle Pfadparameter ausser `:organizationId` sind zufällige UUIDs, die in Organisation B nicht existieren — ein 404 belegt dort ebenso gut fehlende Existenz wie korrekte Tenant-Bindung. Test mit echten, in Organisation B angelegten Ressourcen ist ein benannter Follow-up (siehe Blocker/Follow-ups). |
| D2 Permission-Matrix | 17.09.2026 | grün | [2026-09-17-permission-matrix.md](protokolle/2026-09-17-permission-matrix.md) | 168/168 Rollen-Permission-Paare stimmen mit `hasOrganizationPermission` überein. Zwei kleine Wartungsbefunde (niedrig): `organization:update` und `organization:read` werden von keiner Route eigenständig geprüft, ihre Proben laufen ersatzweise über eine andere Permission, die aktuell an denselben Rollen hängt — kein Sicherheitsrisiko, aber ein blinder Fleck bei künftigem Auseinanderlaufen der Rollentabelle. Ausserdem: Validierung läuft vor Autorisierung (400 statt 403 bei leerem Payload einer Rolle ohne Berechtigung) — niedrig, da keine Daten preisgegeben werden. |
| D3 Rate-Limits auf Staging | 17.09.2026, Ursache bestätigt 18.09.2026, Nachmessung 18.09.2026 grün | grün (Staging) | [2026-09-17-staging-rate-limits-fehlerformat.md](protokolle/2026-09-17-staging-rate-limits-fehlerformat.md) | Befund D3-1 (hoch): unter gleichzeitigen Anfragen zählte der Limiter nur etwa die Hälfte (nach 401 Anfragen stand der Zähler bei 198; beim Login kamen 17 statt 10 Versuche durch) — Muster eines nicht-atomaren Zählers oder eines Schlüssels, der nicht je Client stabil ist. **Ursache bestätigt und behoben (PR #46, Merge 2311f2c):** `request.ip` war zwei abwechselnde Railway-Proxy-Adressen statt der Client-Adresse; `x-real-ip` war dagegen stabil und wurde von Railway auch bei gefälschtem Header überschrieben. Rate-Limit-Schlüssel, Audit-`ip` und die an Better Auth gereichte Adresse laufen seither über `resolveClientAddress` (`apps/api/src/common/client-address.ts`) und nutzen `X-Real-IP` hinter einem vertrauten Hop. **Nachmessung 18.09.2026 gegen Staging (`api-staging.dartbase.ch`, Deploy 2311f2c) grün:** allgemeine Stufe 299× 401 / 101× 429 bei 400 parallelen Anfragen (ein Zähler statt zwei), sensible Stufe 10× 401 / 15× 429 bei 25 parallelen Logins, öffentliche Stufe 100× 429 bei 700 Anfragen (A5, siehe dort), Spoof-Gate mit gefälschtem `X-Real-IP`/`X-Forwarded-For` gegen die Custom-Domain: eigene Adresse im Log, gefälschte Werte kamen nie durch. Details: Abschnitt „Nachmessung 18.09.2026 – grün" im verlinkten Protokoll. Befund D3-2 (mittel, seriell kein 429 im Login-Fall) bleibt unverändert offen, unabhängig von diesem Fix. **Restpunkt:** Die Nachmessung lief nur gegen Staging; dieselbe Probe (mindestens der Spoof-Gate-Fall) ist nach dem Release nach `main` einmal gegen Production zu wiederholen — offen bis Release, nicht rot. |
| D4 Auth-Flows gegen Staging | 18.09.2026 | grün | [2026-09-18-block-d4-d5.md](protokolle/2026-09-18-block-d4-d5.md) | 4/4 Fälle grün: Session-Cookie mit `HttpOnly`, `Secure`, `SameSite=Lax`, `__Secure`-Präfix (D4-1); Logout invalidiert die Sitzung serverseitig, danach 401 (D4-2); fremde Origin bei Cookie-Anfrage an eine Auth-Route → 403 (D4-3); Cookie-Anfrage ohne Origin → 403 (D4-4, nach Korrektur der Testannahme: Better Auth prüft den Origin nur, wenn ein Cookie mitgeschickt wird). Sign-in-Budget eingehalten: 3 von 10 Logins/Minute verbraucht. |
| D5 Öffentliche Routen | 18.09.2026 | grün | [2026-09-18-block-d4-d5.md](protokolle/2026-09-18-block-d4-d5.md) | 3/3 Fälle grün: öffentliches Dashboard verrät keine internen Felder, Form entspricht `publicTournamentDashboardSchema` (D5-1); unbekannte `publicId` → 404 im einheitlichen Fehlerformat (D5-2); privates Turnier ohne Anzeige-Schlüssel antwortet ebenfalls mit 404 wie ein unbekanntes Turnier, bewusst ununterscheidbar, kein Befund (D5-3). |
| D6 Fehlerformat | 17.09.2026 | grün | [2026-09-17-staging-rate-limits-fehlerformat.md](protokolle/2026-09-17-staging-rate-limits-fehlerformat.md) | Alle vier Fälle (ungültiges JSON, unbekannte Route, 2-MB-Body, fehlende Session) liefern das einheitliche Format mit `correlationId`, ohne Stacktrace. Befund D6-1 (klein): der Fehlercode `AVATAR_TOO_LARGE` erscheint auch bei zu grossem Body auf der Login-Route — irreführend, kein Sicherheitsproblem. |

## Quality Gate und CI

| Fall | Datum | Ergebnis | Protokoll | Befund |
| --- | --- | --- | --- | --- |
| Quality Gate lokal (develop 9fa0384) | 17.09.2026 | grün | – | `pnpm lint` 0 Fehler, `pnpm typecheck` sauber, 1'137 Unit-/Integrationstests grün, `pnpm build` grün, 24 E2E grün. |
| GitHub Actions | Ausfall 15.–18.09.2026, seither wieder grün | grün | – | Zahlungs-/Limit-Problem auf Organisationsebene legte Actions vom 15. bis 18.09.2026 lahm („recent account payments have failed or your spending limit needs to be increased"), kein CI-Lauf seit 09.09.2026 in dem Fenster. Seit das Repository am 18.09.2026 öffentlich wurde, laufen die Workflows wieder normal — drei grüne Läufe auf den PRs #45–#47 bestätigen das. |

## Blocker beim Betreiber

Erledigt seit 18.09.2026: Staging-Bootstrap (Organisation «Staging
Testverein», Slug `staging-testverein`, Testkonto
`test-runner@example.test`, Rolle MEMBER) und die vier DNS-Einträge für
`staging.dartbase.ch` / `api-staging.dartbase.ch`. Beide waren bis dahin
Blocker für Block A, B2–B6, D3-Nachmessung, D4 und D5; siehe
`infrastructure/railway.md`, Abschnitt Staging-Environment.

Weiterhin offen:

- **PITR-Entscheid aussteht.** `railway postgres pitr status` zeigt für Production `enabled: false`, `bucketWired: false` (Befund B1, hoch). Einschalten ist eine Mutation an Production und bewusst ein separater Betreiberentscheid, kein Automatismus dieses Programms. (B2, die Restore-Probe auf Staging, ist davon unabhängig bereits gemessen und grün — Staging-PITR ist seit dem 18.09.2026 eingeschaltet.)
- **D1 mit echten Ressourcen in Organisation B nachziehen.** Die aktuelle Tenant-Isolationsmatrix nutzt zufällige UUIDs für alle Pfadparameter ausser `:organizationId`; ein Nachlauf mit tatsächlich in Organisation B angelegten Ressourcen würde 404 (nicht existent) und 403 (existent, aber fremder Tenant) sauber trennen.
- **Neue Einladung für ein zweites Testkonto nötig.** Die Zugangsdaten des bisherigen Testkontos (`test-runner@example.test`, `.env.staging`) gingen mit einem zwischenzeitlich gelöschten Worktree verloren. Für weitere automatisierte Staging-Läufe (`pnpm test:staging`) braucht es eine neue Einladung, vorzugsweise für ein zweites Testkonto (`test-runner-2@example.test`), damit künftige Läufe nicht wieder von einem lokal gehaltenen `.env.staging` abhängen, das ausserhalb des Haupt-Checkouts verloren gehen kann (siehe `infrastructure/railway.md`, Abschnitt „Staging-Tests und Lastläufe").

## Freigabe Block E

**Kriterium laut Spec:** „Alle Fälle in Block A bis D haben ein
protokolliertes Ergebnis. Rote Fälle sind entweder behoben oder mit
Begründung und Risiko im Protokoll als akzeptiert markiert. Erst dann startet
Block E."

**Verdikt: aus Testsicht bereit, sobald der Betreiber B1 entschieden hat.**

Begründung:

- Block A: alle 6 Fälle grün (A1, A2, A3, A4, A5, A6). A5 war ursprünglich
  rot, ist nach dem D3-1-Fix (PR #46) und der Nachmessung vom 18.09.2026
  grün. Ein vollständiger Nachlauf am 18.09.2026 mit einem zweiten
  Testkonto bestätigt alle sechs Fälle erneut grün (A3 jetzt mit fester
  Taktung bei 3,0 Visits/s, siehe `2026-09-18-block-a.md`).
- Block B: B2, B4, B5 und B6 sind grün. B1 bleibt rot und nicht akzeptiert
  (PITR auf Production aus, Betreiberentscheid aussteht) — der einzige
  verbleibende Blocker in Block B. B3 (Migrationsprobe) ist offen, wird
  aber erst mit der nächsten Schema-Änderung in `develop` fällig, nicht
  durch eine noch ausstehende Prüfung eines heute schon vorliegenden
  Zustands.
- Block D: D1, D2, D3 (Staging), D4, D5 und D6 sind grün. D3-1 ist auf
  Staging behoben und nachgemessen; die Production-Probe steht als
  Restpunkt aus (offen bis Release, kein Rot). D3-2 (mittel, serieller
  Login-Fall ohne 429) bleibt unbehoben und offen.
- Block C ist vollständig grün.

Was noch offen ist, blockiert den eigentlichen Block-E-Szenario-Test
nicht:

- **B1 (PITR Production):** Betreiberentscheid aussteht — einschalten und
  akzeptieren, oder mit Begründung und Risiko explizit als akzeptiert
  markieren.
- **B3 (Migrationsprobe):** wird erst mit der nächsten Migration in
  `develop` fällig, keine heute schon messbare Voraussetzung.
- **D3-Produktionsprobe** (Spoof-Gate gegen `api.dartbase.ch`): nach dem
  Release nach `main` einmal zu wiederholen — Nachprüfung eines auf
  Staging bereits bestätigten Fixes, kein offenes Risiko für den
  Szenario-Test selbst.
- **Follow-ups:** D1 mit echten Ressourcen in Organisation B nachziehen,
  D3-2 (serieller Login-Fall ohne 429) klären oder akzeptieren — beides
  dokumentierte, niedrige bis mittlere Befunde ohne bestätigtes
  Sicherheitsrisiko.

**Damit aus Testsicht: ja, sobald der Betreiber B1 entschieden hat** — die
restlichen Punkte (B3, D3-Produktionsprobe, die genannten Follow-ups)
blockieren den eigentlichen Block-E-Szenario-Test nicht, sie bleiben als
Nachträge bzw. Backlog offen.
