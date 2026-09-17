# Abnahmeprotokoll Go-Live-Testprogramm

Stand: 17.09.2026. Gehört zu Spec
[2026-09-17-go-live-testprogramm-design.md](../superpowers/specs/2026-09-17-go-live-testprogramm-design.md).
Fasst den Stand je Block/Fall zusammen. Die einzelnen Nachweise liegen unter
`docs/testing/protokolle/`; dieses Dokument verlinkt sie, ersetzt sie aber
nicht. Ergebnis-Werte: `grün` (Kriterium erfüllt), `rot` (Kriterium verletzt,
Befund offen), `akzeptiert` (rot, aber bewusst mit Begründung als bekanntes
Risiko hingenommen), `offen` (noch nicht gemessen).

## Block A – Nebenläufigkeit und Last

Voraussetzung: eigenes Vitest-Projekt `apps/api/test/staging/`,
`pnpm test:staging` gegen `STAGING_API_URL`. Blockiert, weil die erste
Staging-Organisation noch nicht bootstrapped ist (Betreiberaktion via
Railway-SSH gemäss Runbook) und `staging.dartbase.ch` / `api-staging.dartbase.ch`
noch nicht per DNS aufgelöst sind.

| Fall | Datum | Ergebnis | Protokoll | Befund |
| --- | --- | --- | --- | --- |
| A1 Zwei Scorer, ein Match | – | offen (wartet auf Staging-Konto/Deploy) | – | – |
| A2 Gleicher Command doppelt | – | offen (wartet auf Staging-Konto/Deploy) | – | – |
| A3 20 Boards gleichzeitig | – | offen (wartet auf Staging-Konto/Deploy) | – | – |
| A4 Realtime-Fan-out | – | offen (wartet auf Staging-Konto/Deploy) | – | – |
| A5 Public-Polling unter NAT | – | offen (wartet auf Staging-Konto/Deploy) | – | – |
| A6 Undo unter Last | – | offen (wartet auf Staging-Konto/Deploy) | – | – |

## Block B – Betrieb und Wiederherstellung

| Fall | Datum | Ergebnis | Protokoll | Befund |
| --- | --- | --- | --- | --- |
| B1 Backup-Stand Production | 17.09.2026 | rot | – | `railway postgres pitr status` auf der Production-Datenbank liefert `enabled: false`, `bucketWired: false` — keine kontinuierliche Sicherung. Gleicher Befund für Staging. Einschalten von PITR ist laut Spec ein separater Betreiberentscheid (Mutation an Production); Entscheid steht aus. |
| B2 Restore-Probe auf Staging | – | offen (wartet auf Staging-Konto/Deploy) | – | – |
| B3 Migrationsprobe | – | offen (wartet auf Staging-Konto/Deploy) | – | – |
| B4 Redis-Ausfall | – | offen (wartet auf Staging-Konto/Deploy) | – | – |
| B5 Worker-Neustart | – | offen (wartet auf Staging-Konto/Deploy) | – | – |
| B6 API-Neustart mit offenen Sockets | – | offen (wartet auf Staging-Konto/Deploy) | – | – |

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
| D1 Tenant-Isolationsmatrix | 17.09.2026 | grün | [2026-09-17-tenant-isolation.md](protokolle/2026-09-17-tenant-isolation.md) | 65/65 tenant-bezogene Routen isoliert (403/404), 0 Leaks. Routenliste automatisch aus dem Fastify-Router gelesen. |
| D2 Permission-Matrix | 17.09.2026 | grün | [2026-09-17-permission-matrix.md](protokolle/2026-09-17-permission-matrix.md) | 162/162 Rollen-Permission-Paare stimmen mit `hasOrganizationPermission` überein. Zwei kleine Wartungsbefunde (niedrig): `organization:update` und `organization:read` werden von keiner Route eigenständig geprüft, ihre Proben laufen ersatzweise über eine andere Permission, die aktuell an denselben Rollen hängt — kein Sicherheitsrisiko, aber ein blinder Fleck bei künftigem Auseinanderlaufen der Rollentabelle. Ausserdem: Validierung läuft vor Autorisierung (400 statt 403 bei leerem Payload einer Rolle ohne Berechtigung) — niedrig, da keine Daten preisgegeben werden. |
| D3 Rate-Limits auf Staging | 17.09.2026 | rot | [2026-09-17-staging-rate-limits-fehlerformat.md](protokolle/2026-09-17-staging-rate-limits-fehlerformat.md) | Befund D3-1 (hoch): unter gleichzeitigen Anfragen zählt der Limiter nur etwa die Hälfte (nach 401 Anfragen stand der Zähler bei 198; beim Login kamen 17 statt 10 Versuche durch) — Muster eines nicht-atomaren Zählers oder eines Schlüssels, der nicht je Client stabil ist; Verdacht: `request.ip` entspricht der Proxy-Adresse hinter Railway, das laut Railway-Dokumentation `X-Real-IP` verwendet. Befund D3-2 (mittel): im seriellen Login-Fall blieb innerhalb des Fensters jedes 429 aus, Ursache offen. Diagnose-Log-Felder (`ip`, `addressHeaders`) sind bereits im API-Request-Log ergänzt (Commit ac55705); die erneute Messung gegen Staging steht aus, weil das Staging-Konto noch nicht bootstrapped ist. |
| D4 Auth-Flows gegen Staging | – | offen (wartet auf Staging-Konto/Deploy) | – | Umsetzung als Task 12 Step 1 bewusst zurückgestellt (Test noch nicht geschrieben). |
| D5 Öffentliche Routen | – | offen (wartet auf Staging-Konto/Deploy) | – | Umsetzung als Task 12 Step 1 bewusst zurückgestellt (Test noch nicht geschrieben). |
| D6 Fehlerformat | 17.09.2026 | grün | [2026-09-17-staging-rate-limits-fehlerformat.md](protokolle/2026-09-17-staging-rate-limits-fehlerformat.md) | Alle vier Fälle (ungültiges JSON, unbekannte Route, 2-MB-Body, fehlende Session) liefern das einheitliche Format mit `correlationId`, ohne Stacktrace. Befund D6-1 (klein): der Fehlercode `AVATAR_TOO_LARGE` erscheint auch bei zu grossem Body auf der Login-Route — irreführend, kein Sicherheitsproblem. |

## Quality Gate und CI

| Fall | Datum | Ergebnis | Protokoll | Befund |
| --- | --- | --- | --- | --- |
| Quality Gate lokal (develop 9fa0384) | 17.09.2026 | grün | – | `pnpm lint` 0 Fehler, `pnpm typecheck` sauber, 1'137 Unit-/Integrationstests grün, `pnpm build` grün, 24 E2E grün. |
| GitHub Actions | seit 15.09.2026 | rot | – | Keine Jobs mehr gestartet („recent account payments have failed or your spending limit needs to be increased"). Letzter grüner CI-Lauf 09.09.2026. Alles seit dann auf `main` Gemergte erreichte Production ohne CI-Durchlauf. |

## Blocker beim Betreiber

- **GitHub Actions blockiert.** Zahlungs-/Limit-Problem auf Organisationsebene seit 15.09.2026; kein CI-Lauf seit 09.09.2026, seither ungeprüfte Deploys auf `main`.
- **Staging-Bootstrap fehlt.** Die erste Staging-Organisation ist noch nicht angelegt (Railway-SSH-Aktion gemäss Runbook); dadurch sind Block A vollständig sowie B2–B6, D3-Nachmessung, D4 und D5 blockiert.
- **DNS für Staging-Domains ausstehend.** Vier DNS-Einträge für `staging.dartbase.ch` / `api-staging.dartbase.ch` sind beim Betreiber gemäss `infrastructure/railway.md` (Abschnitt Staging-Environment) angefragt, aber noch nicht gesetzt; Browser-Login gegen Staging (Better-Auth-Cookies mit `SameSite=Lax`) und damit Block E sind erst danach möglich.
- **PITR-Entscheid aussteht.** `railway postgres pitr status` zeigt für Production `enabled: false`, `bucketWired: false` (Befund B1, hoch). Einschalten ist eine Mutation an Production und bewusst ein separater Betreiberentscheid, kein Automatismus dieses Programms.

## Freigabe Block E

**Kriterium laut Spec:** „Alle Fälle in Block A bis D haben ein
protokolliertes Ergebnis. Rote Fälle sind entweder behoben oder mit
Begründung und Risiko im Protokoll als akzeptiert markiert. Erst dann startet
Block E."

**Verdikt: nicht freigegeben.**

Begründung:

- Block A hat noch kein einziges protokolliertes Ergebnis (6 von 6 Fällen
  `offen`) — blockiert durch fehlenden Staging-Bootstrap und ausstehende DNS.
- Block B hat ein protokolliertes, aber rotes und nicht akzeptiertes Ergebnis
  (B1, PITR aus) sowie fünf offene Fälle (B2–B6).
- Block D hat zwei protokollierte, aber nicht akzeptierte rote Befunde
  (D3-1 hoch, D3-2 mittel) und zwei offene Fälle (D4, D5).
- Block C ist vollständig grün; das allein genügt nicht, weil das Kriterium
  alle vier Blöcke verlangt.

Block E kann erst starten, wenn: der Staging-Bootstrap erfolgt ist, die
DNS-Einträge live sind, Block A vollständig gemessen wurde, die Blöcke B und
D entweder grün sind oder ihre roten Befunde (B1, D3-1, D3-2) mit
Begründung und Risiko explizit als akzeptiert markiert wurden, und D4/D5
nachgezogen sind.
