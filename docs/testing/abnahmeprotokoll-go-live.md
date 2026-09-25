# Abnahmeprotokoll Go-Live-Testprogramm

Stand: 18.09.2026, Nachträge D3-2 vom 24.09.2026 und B3 vom 25.09.2026. Release-Stand: `main` 051ddbf (Release-PR #49, `develop` →
`main`, 51 Commits, PRs #45–#48, grüne CI, Merge 16:29), Production seit ca.
16:40 auf diesem Stand deployt (API, Web, Worker) — `https://dartbase.ch`
HTTP 200, `GET /api/v1/health` ok. Gehört zu Spec
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
| B1 Backup-Stand Production | 17.09.2026, PITR eingeschaltet 18.09.2026 | grün | [2026-09-18-block-b.md](protokolle/2026-09-18-block-b.md) | `railway postgres pitr status` lieferte am 17.09.2026 für Production `enabled: false`, `bucketWired: false` — keine kontinuierliche Sicherung. Der Betreiber hat PITR am 18.09.2026, 15:41 UTC, auf Production eingeschaltet (`enabled: true`, `bucketWired: true`); die Production-Health blieb während und nach dem dadurch ausgelösten Redeploy der Datenbank `ok` (6 Messungen über 60 s). Das Restore-Verfahren selbst ist über die Staging-Probe B2 bereits nachgewiesen. |
| B2 Restore-Probe auf Staging | 18.09.2026 | grün | [2026-09-18-block-b.md](protokolle/2026-09-18-block-b.md) | PITR in Staging eingeschaltet, Restore auf T1 = 14:59:07 UTC in einen neuen Service (`postgres-restored`) zurückgespielt, fertig 15:03:39 UTC (≈ 1,5 Minuten): 10 statt 11 Organisationen, die nach T1 angelegte fehlte wie erwartet. Nach Zurückschalten der Staging-API auf die Original-Datenbank wieder 11 Organisationen. Manuelle Backups auf diesem Plan nicht verfügbar (`pitr backup create` → kein Zugriff), für den Restore auch nicht nötig. |
| B3 Migrationsprobe | 20.09.2026 (Migration 0034), ausgewertet 25.09.2026 | grün | [2026-09-18-block-b.md](protokolle/2026-09-18-block-b.md) | Staging-Deploy `develop` e01a9dc und Production-Release #59: je genau ein Migrationslauf (`database_migration_started`/`_completed`, 80 ms bzw. 68 ms) vor dem Nest-Start, `api_started` danach. Worker lief beide Male rund 22 s vor der Migration an: auf Staging 24 Zeilen auf `error` (23× `email.tick_failed`, 1× `email.prune_failed`), funktional unschädlich, nach der Migration still. Fix 21addcc (PR #58) meldet 42P01 im Startfenster von 120 s als `tick_deferred` auf `warn`; in Production nachgewiesen (23× `warn`, 1× `email.prune_failed` noch auf `error`). Aufräumzweig mit dem Nachtrag vom 25.09.2026 nachgezogen (`prune_deferred`), nachweisbar erst mit der nächsten Migration. |
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
| D1 Tenant-Isolationsmatrix | 17.09.2026, Nachlauf mit echten Ressourcen 18.09.2026 | grün | [2026-09-17-tenant-isolation.md](protokolle/2026-09-17-tenant-isolation.md) | 17.09.: 65/65 tenant-bezogene Routen isoliert (403/404), 0 Leaks, Routenliste automatisch aus dem Fastify-Router gelesen; Einschränkung damals: zufällige UUIDs für alle Pfadparameter ausser `:organizationId`. **Nachlauf 18.09.2026:** zweiter Durchgang mit echten, als Owner B über die API angelegten Ressourcen (Spieler, Scheibe, Match, Teams, Turnier mit Anzeigeschlüssel, Wettbewerb mit Begegnung und Slots, Einladung, Mitglied) — 67/67 Routen antworten mit 403, Schnappschuss der Daten von B (inkl. Versionen und `updatedAt`) unverändert, kein Audit-Eintrag mit Owner A als Handelndem. Der Follow-up ist damit erledigt. |
| D2 Permission-Matrix | 17.09.2026, Nachtrag 18.09.2026 | grün | [2026-09-17-permission-matrix.md](protokolle/2026-09-17-permission-matrix.md) | 168/168 Rollen-Permission-Paare stimmen mit `hasOrganizationPermission` überein. Die beiden Wartungsbefunde vom 17.09. (`organization:update` und `organization:read` ohne eigene prüfende Route) sind am 18.09.2026 behoben: `GET` und `PATCH /organizations/:organizationId` prüfen genau diese Permissions, die Proben zeigen darauf. Der dritte Befund (Validierung vor Autorisierung, 400 statt 403 bei ungültigem Rumpf einer unberechtigten Rolle) ist als **akzeptiert** dokumentiert: keine Datenpreisgabe, Schemas sind öffentlich, ein Umbau wäre ein Architekturwechsel über alle Controller (Begründung im Protokoll-Nachtrag). |
| D3 Rate-Limits auf Staging und Production | 17.09.2026, Ursache bestätigt 18.09.2026, Nachmessung Staging 18.09.2026 grün, Produktionsprobe 18.09.2026 grün, D3-2 nachgemessen 24.09.2026 grün | grün (Staging und Production) | [2026-09-17-staging-rate-limits-fehlerformat.md](protokolle/2026-09-17-staging-rate-limits-fehlerformat.md) | Befund D3-1 (hoch): unter gleichzeitigen Anfragen zählte der Limiter nur etwa die Hälfte (nach 401 Anfragen stand der Zähler bei 198; beim Login kamen 17 statt 10 Versuche durch) — Muster eines nicht-atomaren Zählers oder eines Schlüssels, der nicht je Client stabil ist. **Ursache bestätigt und behoben (PR #46, Merge 2311f2c):** `request.ip` war zwei abwechselnde Railway-Proxy-Adressen statt der Client-Adresse; `x-real-ip` war dagegen stabil und wurde von Railway auch bei gefälschtem Header überschrieben. Rate-Limit-Schlüssel, Audit-`ip` und die an Better Auth gereichte Adresse laufen seither über `resolveClientAddress` (`apps/api/src/common/client-address.ts`) und nutzen `X-Real-IP` hinter einem vertrauten Hop. **Nachmessung 18.09.2026 gegen Staging (`api-staging.dartbase.ch`, Deploy 2311f2c) grün:** allgemeine Stufe 299× 401 / 101× 429 bei 400 parallelen Anfragen (ein Zähler statt zwei), sensible Stufe 10× 401 / 15× 429 bei 25 parallelen Logins, öffentliche Stufe 100× 429 bei 700 Anfragen (A5, siehe dort), Spoof-Gate mit gefälschtem `X-Real-IP`/`X-Forwarded-For` gegen die Custom-Domain: eigene Adresse im Log, gefälschte Werte kamen nie durch. **Produktionsprobe 18.09.2026 gegen `api.dartbase.ch` (Deploy `main` 051ddbf) grün:** 25 parallele Fehl-Logins mit je eigenem gefälschtem `X-Real-IP`/`X-Forwarded-For` → 10× 401, 15× 429 (ein gemeinsamer Zähler statt 25× 401); Restzähler der allgemeinen Stufe danach eine einzige fortlaufende Reihe (299…294). Die Probe lief verhaltensbasiert, da `LOG_CLIENT_ADDRESS` in Production bewusst aus bleibt. Details: Abschnitte „Nachmessung 18.09.2026 – grün" und „Produktionsprobe 18.09.2026 – grün" im verlinkten Protokoll. Befund D3-2 (mittel, seriell kein 429 im Login-Fall) hatte dieselbe Ursache: zwölf Logins nacheinander verteilten sich auf zwei Proxy-Eimer mit je etwa sechs Versuchen. **Nachmessung 24.09.2026 gegen Staging grün:** 12 serielle Fehl-Logins → 10× 401, danach 429, Restzähler fortlaufend 9…0. D3-2 ist damit geschlossen; Abschnitt „Nachmessung D3-2 24.09.2026 – grün" im verlinkten Protokoll. Der zuvor offene Restpunkt (Production-Probe nach Release) ist mit dieser Messung geschlossen. |
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

Erledigt seit 18.09.2026, 15:41 UTC: **PITR-Entscheid.** Der Betreiber hat
PITR auf der Production-Datenbank eingeschaltet (`enabled: true`,
`bucketWired: true`, Befund B1 damit behoben); die Production-Health blieb
während und nach dem dadurch ausgelösten Redeploy der Datenbank `ok`. Das
Restore-Verfahren ist über B2 (Staging) bereits nachgewiesen.

Weiterhin offen (nicht blockierend, siehe „Freigabe Block E"):

- ~~**Service `postgres-restored` löschen.**~~ Erledigt am 18.09.2026 abends:
  der bei der B2-Restore-Probe entstandene Service ist gelöscht, Staging
  besteht wieder nur aus `api`, `web`, `worker`, Postgres und Redis.
- ~~**D1 mit echten Ressourcen in Organisation B nachziehen.**~~ Erledigt am 18.09.2026, siehe Zeile D1 und den Nachtrag im Tenant-Isolations-Protokoll.
- **Neue Einladung für ein zweites Testkonto nötig.** Die Zugangsdaten des bisherigen Testkontos (`test-runner@example.test`, `.env.staging`) gingen mit einem zwischenzeitlich gelöschten Worktree verloren. Für weitere automatisierte Staging-Läufe (`pnpm test:staging`) braucht es eine neue Einladung, vorzugsweise für ein zweites Testkonto (`test-runner-2@example.test`); `.env.staging` gehört ausschliesslich in den Haupt-Checkout und wird von dort bei Bedarf in einen Worktree kopiert, damit künftige Läufe nicht wieder von einer lokal in einem Worktree gehaltenen Kopie abhängen, die ausserhalb des Haupt-Checkouts verloren gehen kann (siehe `infrastructure/railway.md`, Abschnitt „Staging-Tests und Lastläufe").

## Freigabe Block E

**Kriterium laut Spec:** „Alle Fälle in Block A bis D haben ein
protokolliertes Ergebnis. Rote Fälle sind entweder behoben oder mit
Begründung und Risiko im Protokoll als akzeptiert markiert. Erst dann startet
Block E."

**Verdikt: aus Testsicht freigegeben.**

Begründung:

- Block A: alle 6 Fälle grün (A1, A2, A3, A4, A5, A6). A5 war ursprünglich
  rot, ist nach dem D3-1-Fix (PR #46) und der Nachmessung vom 18.09.2026
  grün. Ein vollständiger Nachlauf am 18.09.2026 mit einem zweiten
  Testkonto bestätigt alle sechs Fälle erneut grün (A3 jetzt mit fester
  Taktung bei 3,0 Visits/s, siehe `2026-09-18-block-a.md`).
- Block B: B1, B2, B4, B5 und B6 sind grün. B1 war zunächst rot (PITR auf
  Production aus); der Betreiber hat PITR am 18.09.2026, 15:41 UTC,
  eingeschaltet, die Production-Health blieb während und nach dem
  dadurch ausgelösten Redeploy `ok` — Befund behoben. B3
  (Migrationsprobe) ist am 25.09.2026 anhand der Migration 0034 vom
  20.09.2026 ausgewertet und grün: genau ein Migrationslauf vor dem
  API-Start auf Staging wie in Production; der Worker lief beide Male vor
  der Migration an, was seit Fix 21addcc (Release #59) als `warn`
  statt `error` erscheint, für den Aufräumzweig mit dem Nachtrag
  nachgezogen.
- Block D: alle sechs Fälle grün. D3-1 ist sowohl auf Staging als auch in
  Production (Deploy `main` 051ddbf) nachgemessen grün — der zuvor offene
  Restpunkt (Production-Probe nach Release) ist damit geschlossen. D3-2
  (mittel, serieller Login-Fall ohne 429) hatte dieselbe Ursache wie D3-1
  und ist seit der Nachmessung vom 24.09.2026 auf Staging grün.
- Block C ist vollständig grün.

Was noch offen ist, blockiert den eigentlichen Block-E-Szenario-Test
nicht:

- **B3 (Migrationsprobe):** am 25.09.2026 ausgewertet und grün (siehe
  Block B).
- **Follow-ups:** D3-2 (serieller Login-Fall ohne 429) ist am 24.09.2026
  geklärt und nachgemessen grün. Die D1/D2-Follow-ups (echte Ressourcen in B, eigene
  Routen für `organization:read`/`organization:update`, Reihenfolge
  Validierung/Autorisierung) sind am 18.09.2026 erledigt beziehungsweise
  begründet akzeptiert.

Ein Betreiber-Punkt bleibt unabhängig davon offen, ebenfalls nicht
blockierend für den Szenario-Test (der Staging-Service `postgres-restored`
aus der B2-Restore-Probe ist am 18.09.2026 abends gelöscht worden):

- Zugangsdaten künftiger Staging-Testkonten ausschliesslich in der
  git-ignorierten `.env.staging` im Haupt-Checkout halten, nicht in
  einem Worktree, der gelöscht werden kann (siehe „Blocker beim
  Betreiber" oben).

**Damit aus Testsicht: freigegeben** — alle Blöcke A bis D sind grün;
B3 ist seit dem Nachtrag vom 25.09.2026 ebenfalls grün. Die genannten
Follow-ups und Betreiber-Punkte bleiben als nicht blockierende Nachträge
bzw. Backlog offen.
