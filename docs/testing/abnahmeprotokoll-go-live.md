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
| A3 20 Boards gleichzeitig | 18.09.2026 | grün | [2026-09-18-block-a.md](protokolle/2026-09-18-block-a.md) | 4'076 Anfragen, 0 Fehler, p50 252 ms, p95 298 ms, p99 373 ms, 0 Matches vorzeitig beendet. Messwerte: [2026-09-18-a3.json](protokolle/messwerte/2026-09-18-a3.json). |
| A4 Realtime-Fan-out | 18.09.2026 | grün | [2026-09-18-block-a.md](protokolle/2026-09-18-block-a.md) | 0 von 50 Sockets ohne `tournament:changed`; p50 194 ms, p95 194 ms, max 200 ms. Messwerte: [2026-09-18-a4.json](protokolle/messwerte/2026-09-18-a4.json). |
| A5 Public-Polling unter NAT | 18.09.2026 | rot | [2026-09-18-block-a.md](protokolle/2026-09-18-block-a.md) | 0 von 700 Antworten 429 (erwartet 50–150) — Folge von Befund D3-1: Staging zählt denselben Client effektiv doppelt, die reale Schwelle liegt bei rund 1200 statt 600 Anfragen/Minute. Messwerte: [2026-09-18-a5.json](protokolle/messwerte/2026-09-18-a5.json). |
| A6 Undo unter Last | 18.09.2026 | grün | [2026-09-18-block-a.md](protokolle/2026-09-18-block-a.md) | Ein 201, ein 409; Version = vorherige Version + 1; zwei aktive Visits (Undo hat gewonnen). |

## Block B – Betrieb und Wiederherstellung

| Fall | Datum | Ergebnis | Protokoll | Befund |
| --- | --- | --- | --- | --- |
| B1 Backup-Stand Production | 17.09.2026 | rot | [2026-09-18-block-b.md](protokolle/2026-09-18-block-b.md) | `railway postgres pitr status` auf der Production-Datenbank liefert `enabled: false`, `bucketWired: false` — keine kontinuierliche Sicherung. Gleicher Befund für Staging. Einschalten von PITR ist laut Spec ein separater Betreiberentscheid (Mutation an Production); Entscheid steht aus. |
| B2 Restore-Probe auf Staging | – | offen | [2026-09-18-block-b.md](protokolle/2026-09-18-block-b.md) | Noch nicht gefahren; PITR ist auch in Staging aus, Voraussetzung fehlt. |
| B3 Migrationsprobe | – | offen | [2026-09-18-block-b.md](protokolle/2026-09-18-block-b.md) | Wartet auf die nächste Migration in `develop` und einen Staging-Deploy; GitHub Actions startet keine Jobs. |
| B4 Redis-Ausfall | 18.09.2026 | grün | [2026-09-18-block-b.md](protokolle/2026-09-18-block-b.md) | Lastlauf 5 Boards/3 Visits/s über 90 s, `railway restart --service Redis` bei t=30 s (Ausfall 08:10:06–08:10:07 UTC): 0 von 1112 Visits mit Fehler, 0 von 25 Health-Abfragen nicht `ok`, p95 92 ms (p50 70 ms, p99 117 ms), `deadLettered` danach 0. |
| B5 Worker-Neustart | 18.09.2026 | grün | [2026-09-18-block-b.md](protokolle/2026-09-18-block-b.md) | Im selben Lauf `railway restart --service @darts-platform/worker` bei t=60 s (`worker_started` 08:10:41): Health während/nach Neustart `ok`, `publishLagSeconds` 0, `deadLettered` 0. |
| B6 API-Neustart mit offenen Sockets | – | offen | [2026-09-18-block-b.md](protokolle/2026-09-18-block-b.md) | Noch nicht gefahren; Vorgehen wie B4, zusätzlich mit den 50 Sockets aus Fall A4. |

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
| D3 Rate-Limits auf Staging | 17.09.2026 | rot | [2026-09-17-staging-rate-limits-fehlerformat.md](protokolle/2026-09-17-staging-rate-limits-fehlerformat.md) | Befund D3-1 (hoch): unter gleichzeitigen Anfragen zählt der Limiter nur etwa die Hälfte (nach 401 Anfragen stand der Zähler bei 198; beim Login kamen 17 statt 10 Versuche durch) — Muster eines nicht-atomaren Zählers oder eines Schlüssels, der nicht je Client stabil ist; Verdacht: `request.ip` entspricht der Proxy-Adresse hinter Railway, das laut Railway-Dokumentation `X-Real-IP` verwendet. Befund D3-2 (mittel): im seriellen Login-Fall blieb innerhalb des Fensters jedes 429 aus, Ursache offen. Diagnose-Log-Felder (`ip`, `addressHeaders`) sind bereits im API-Request-Log ergänzt (Commit ac55705); ein Staging-Deploy mit dem zugehörigen `LOG_CLIENT_ADDRESS`-Schalter ist Voraussetzung für die Nachmessung. Stand 18.09.2026: weiterhin blockiert, weil GitHub Actions seit dem 15.09.2026 keine Jobs mehr startet (Zahlungsproblem) und damit dieser Staging-Deploy nicht ausgelöst wird — nicht mehr der fehlende Staging-Bootstrap, der inzwischen erledigt ist. A5 (Block A) bestätigt den bekannten Effekt zusätzlich indirekt. |
| D4 Auth-Flows gegen Staging | 18.09.2026 | grün | [2026-09-18-block-d4-d5.md](protokolle/2026-09-18-block-d4-d5.md) | 4/4 Fälle grün: Session-Cookie mit `HttpOnly`, `Secure`, `SameSite=Lax`, `__Secure`-Präfix (D4-1); Logout invalidiert die Sitzung serverseitig, danach 401 (D4-2); fremde Origin bei Cookie-Anfrage an eine Auth-Route → 403 (D4-3); Cookie-Anfrage ohne Origin → 403 (D4-4, nach Korrektur der Testannahme: Better Auth prüft den Origin nur, wenn ein Cookie mitgeschickt wird). Sign-in-Budget eingehalten: 3 von 10 Logins/Minute verbraucht. |
| D5 Öffentliche Routen | 18.09.2026 | grün | [2026-09-18-block-d4-d5.md](protokolle/2026-09-18-block-d4-d5.md) | 3/3 Fälle grün: öffentliches Dashboard verrät keine internen Felder, Form entspricht `publicTournamentDashboardSchema` (D5-1); unbekannte `publicId` → 404 im einheitlichen Fehlerformat (D5-2); privates Turnier ohne Anzeige-Schlüssel antwortet ebenfalls mit 404 wie ein unbekanntes Turnier, bewusst ununterscheidbar, kein Befund (D5-3). |
| D6 Fehlerformat | 17.09.2026 | grün | [2026-09-17-staging-rate-limits-fehlerformat.md](protokolle/2026-09-17-staging-rate-limits-fehlerformat.md) | Alle vier Fälle (ungültiges JSON, unbekannte Route, 2-MB-Body, fehlende Session) liefern das einheitliche Format mit `correlationId`, ohne Stacktrace. Befund D6-1 (klein): der Fehlercode `AVATAR_TOO_LARGE` erscheint auch bei zu grossem Body auf der Login-Route — irreführend, kein Sicherheitsproblem. |

## Quality Gate und CI

| Fall | Datum | Ergebnis | Protokoll | Befund |
| --- | --- | --- | --- | --- |
| Quality Gate lokal (develop 9fa0384) | 17.09.2026 | grün | – | `pnpm lint` 0 Fehler, `pnpm typecheck` sauber, 1'137 Unit-/Integrationstests grün, `pnpm build` grün, 24 E2E grün. |
| GitHub Actions | seit 15.09.2026 | rot | – | Keine Jobs mehr gestartet („recent account payments have failed or your spending limit needs to be increased"). Letzter grüner CI-Lauf 09.09.2026. Alles seit dann auf `main` Gemergte erreichte Production ohne CI-Durchlauf. |

## Blocker beim Betreiber

Erledigt seit 18.09.2026: Staging-Bootstrap (Organisation «Staging
Testverein», Slug `staging-testverein`, Testkonto
`test-runner@example.test`, Rolle MEMBER) und die vier DNS-Einträge für
`staging.dartbase.ch` / `api-staging.dartbase.ch`. Beide waren bis dahin
Blocker für Block A, B2–B6, D3-Nachmessung, D4 und D5; siehe
`infrastructure/railway.md`, Abschnitt Staging-Environment.

Weiterhin offen:

- **GitHub Actions blockiert.** Zahlungs-/Limit-Problem auf Organisationsebene seit 15.09.2026; kein CI-Lauf seit 09.09.2026, seither ungeprüfte Deploys auf `main`. Blockiert damit auch den Staging-Deploy des `LOG_CLIENT_ADDRESS`-Diagnose-Fixes (D3-Nachmessung), die Migrationsprobe B3 und die weiteren Schritte aus Aufgabe 3 (ab Schritt 3).
- **PITR-Entscheid aussteht.** `railway postgres pitr status` zeigt für Production `enabled: false`, `bucketWired: false` (Befund B1, hoch). Einschalten ist eine Mutation an Production und bewusst ein separater Betreiberentscheid, kein Automatismus dieses Programms.
- **B2/B6 noch nicht gefahren.** Restore-Probe auf Staging (B2, wartet zusätzlich auf den PITR-Entscheid) und API-Neustart mit offenen Sockets (B6, Vorgehen wie B4 mit den 50 Sockets aus A4) stehen aus.
- **D1 mit echten Ressourcen in Organisation B nachziehen.** Die aktuelle Tenant-Isolationsmatrix nutzt zufällige UUIDs für alle Pfadparameter ausser `:organizationId`; ein Nachlauf mit tatsächlich in Organisation B angelegten Ressourcen würde 404 (nicht existent) und 403 (existent, aber fremder Tenant) sauber trennen.

## Freigabe Block E

**Kriterium laut Spec:** „Alle Fälle in Block A bis D haben ein
protokolliertes Ergebnis. Rote Fälle sind entweder behoben oder mit
Begründung und Risiko im Protokoll als akzeptiert markiert. Erst dann startet
Block E."

**Verdikt: nicht freigegeben.**

Begründung:

- Block A: 5 von 6 Fällen grün (A1, A2, A3, A4, A6). A5 ist rot — nicht als
  eigenständiger Befund, sondern als direkte Folge von D3-1: der verdoppelte
  Rate-Limit-Zähler lässt das Public-Limit mit der vorgegebenen Anfragezahl
  nicht scharf prüfen.
- Block B: B4 und B5 sind grün. B1 ist rot und nicht akzeptiert (PITR aus,
  Betreiberentscheid aussteht). B2, B3 und B6 sind offen.
- Block D: D1, D2, D4, D5 und D6 sind grün. D3 ist weiterhin rot — die
  Befunde D3-1 (hoch) und D3-2 (mittel) sind unbehoben, ihre Nachmessung ist
  blockiert, weil der dafür nötige Staging-Deploy GitHub Actions voraussetzt.
- Block C ist vollständig grün; das allein genügt nicht, weil das Kriterium
  alle vier Blöcke verlangt.

Block E kann erst starten, wenn: B1, D3-1 und D3-2 entweder behoben oder mit
Begründung und Risiko explizit im Protokoll als akzeptiert markiert sind,
B2, B3 und B6 gemessen wurden und A5 im Licht einer behobenen oder
akzeptierten D3-1 neu bewertet ist.
