# Railway Deployment Runbook

## Aktueller Stand

Stand: 18.09.2026

| Bereich | Wert |
| --- | --- |
| Railway Workspace | `BitWhatElse Projects` |
| Railway-Projekt | `dartbase` |
| Environments | `production`, `staging` (siehe [Staging-Environment](#staging-environment)) |
| Tarif | Hobby |
| App-Services | `@darts-platform/web`, `@darts-platform/api`, `@darts-platform/worker` |
| Datenservices | `Postgres`, `Redis` |
| Registrar | Cyon |
| Autoritatives DNS | Cloudflare Free |
| Plattformdomains am Web-Service | `dartbase.ch`, `*.dartbase.ch` |
| Release-Stand Production | `main` 051ddbf (Release-PR #49, `develop` → `main`, 51 Commits, PRs #45–#48, grüne CI, Merge-Commit 051ddbf, 18.09.2026 16:29) |

Cloudflare meldet die Zone als aktiv. Die Zertifikate für `dartbase.ch` und
`*.dartbase.ch` sowie `api.dartbase.ch` sind gültig. Web, API, Worker,
PostgreSQL und Redis sind erfolgreich deployt und die internen Healthchecks
bestehen. Die öffentlichen Web- und API-Smoke-Tests bestehen ebenfalls.

Release-PR #49 wurde am 18.09.2026 nach `main` gemergt und ist seither auf
Production deployt: API, Web und Worker liefen ab ca. 16:40 mit
Deployment-Stand `main` 051ddbf, `https://dartbase.ch` antwortet mit HTTP
200, `GET /api/v1/health` meldet `ok`.

## Staging-Environment

Stand: 18.09.2026

Neben `production` existiert im Projekt `dartbase` das Environment
`staging` (ID `ade64d16-d5ff-4be6-bd80-39e582335a20`). Es ist eine
Duplikation von `production` mit eigenen, leeren Postgres- und Redis-Instanzen
samt eigenen Volumes und Zugangsdaten. Staging enthält keine Production-Daten.

Am 18.09.2026 hat der Betreiber die erste Staging-Organisation gemäss diesem
Runbook bootstrapped: «Staging Testverein» (Slug `staging-testverein`). Das
fiktive Testkonto `test-runner@example.test` (Rolle MEMBER) ist darin
registriert; seine Zugangsdaten liegen in der git-ignorierten `.env.staging`
(siehe [Staging-Tests und Lastläufe](#staging-tests-und-lastläufe)).

| Bereich | production | staging |
| --- | --- | --- |
| Git-Branch | `main` | `develop` |
| Railway `checkSuites` | `true` laut IaC | `true` |
| Web-Domain | `dartbase.ch`, `*.dartbase.ch` | `staging.dartbase.ch`, `darts-platformweb-staging.up.railway.app` |
| API-Domain | `api.dartbase.ch` | `api-staging.dartbase.ch`, `darts-platformapi-staging.up.railway.app` |
| `BETTER_AUTH_URL` | `https://api.dartbase.ch` | `https://api-staging.dartbase.ch` |
| `WEB_ORIGIN` | `https://dartbase.ch` | `https://staging.dartbase.ch` |
| `WEB_ADDITIONAL_ORIGINS` | `https://www.dartbase.ch` | leer |
| `NEXT_PUBLIC_API_URL` | `https://api.dartbase.ch/api/v1` | `https://api-staging.dartbase.ch/api/v1` |
| `BETTER_AUTH_SECRET` | eigener Wert | eigener, von Production abweichender Wert |
| `ALLOW_SELF_SERVICE_ORGANIZATIONS` | nicht gesetzt (`false`) | `true` (Testorganisationen ohne Bootstrap) |
| `DATABASE_URL`, `REDIS_URL` | Referenz auf Production-Datenservices | Referenz auf Staging-Datenservices |
| PITR (Postgres) | aktiviert seit 18.09.2026, 15:41 UTC (`enabled: true`, `bucketWired: true`) — Befund B1 behoben, Health blieb während/nach dem dadurch ausgelösten Redeploy der Datenbank `ok` | aktiviert seit 18.09.2026 (`enabled: true`, `bucketWired: true`), Restore-Probe B2 grün gemessen |

Alle übrigen Variablen (`NODE_ENV=production`, `TRUST_PROXY_HOPS=1`,
Rate-Limits, Ports, `LOG_LEVEL`) sind identisch zu Production, damit Staging
dieselben Startprüfungen und dieselbe Proxy-Konfiguration durchläuft.

### Deployment-Fluss

```text
PR   → develop (Merge) → GitHub CI (Phase 0 quality gate, Deployment artifacts)
                       → Railway staging (wartet auf grüne Check Suites)
PR develop → main       → GitHub CI
                       → Railway production
```

Der CI-Workflow reagiert seit dem 17.09.2026 auch auf `push` nach `develop`
(nicht nur auf Pull Requests); ohne diesen Trigger hätte `checkSuites: true`
in Staging keinen Check zum Abwarten. Seit der Branch-Protection vom
18.09.2026 (siehe [GitHub-CI-Gate](#github-ci-gate)) entsteht dieser Push
ausschliesslich als Merge-Commit eines Pull Requests — direkte Pushes auf
`develop` sind seither technisch unterbunden.

**Vorübergehende GitHub-Actions-Pause (15.–18.09.2026).** Wegen ausstehender
GitHub-Abrechnung führte GitHub Actions vom 15.09.2026 bis zum 18.09.2026
keinen einzigen Workflow-Lauf aus — weder `Phase 0 quality gate` noch
`Deployment artifacts` liefen in diesem Fenster. `checkSuites: true` blieb in
Staging während der gesamten Pause gesetzt; ohne Check Suite wartete Railway
dort einfach weiter, statt ungeprüft zu deployen. Seit das Repository am
18.09.2026 öffentlich wurde, laufen GitHub-Actions-Workflows wieder normal.

### Custom Domains für Staging

Die Wildcard `*.dartbase.ch` am Production-Web-Service fängt in DNS jede nicht
explizit definierte Subdomain ab. Für Staging sind deshalb explizite Einträge
nötig; Railway routet die exakten Hostnamen zum Staging-Service. Die Cookies
von Better Auth laufen mit `SameSite=Lax`; Web und API müssen darum wie in
Production unter derselben Site `dartbase.ch` liegen. Die generierten
`up.railway.app`-Domains eignen sich nur für API-Tests ohne Browser-Login.

| Typ | Name | Ziel / Inhalt | Proxy |
| --- | --- | --- | --- |
| CNAME | `staging` | `6291r31z.up.railway.app` | DNS only |
| TXT | `_railway-verify.staging` | `railway-verify=fce1377ce18995d0d210ab746fc04824e237285a1099348e03047f469edaa758` | DNS only |
| CNAME | `api-staging` | `sq7xife8.up.railway.app` | DNS only |
| TXT | `_railway-verify.api-staging` | `railway-verify=13a256c3ef813cf5997c9a84241f7722a11f5f7b1b203455e5621b2874f5cbad` | DNS only |

Die vier Einträge sind seit dem 18.09.2026 gesetzt; Railway hat beide Domains
verifiziert, die Zertifikate sind gültig, und der CORS-Preflight von
`https://staging.dartbase.ch` auf die Staging-API antwortet mit 204.

Kontrolle:

```bash
railway domain list --project b72b141e-1685-44d7-960e-06c6b3998b34 \
  --environment staging --service @darts-platform/web --json
curl -sS https://api-staging.dartbase.ch/api/v1/health
```

### IaC-Hinweis

[`.railway/railway.ts`](../.railway/railway.ts) beschreibt ausschliesslich
`production` (Branch `main`, Production-Domains). `railway config plan` oder
`apply` dürfen nur mit verlinktem Environment `production` laufen; gegen
`staging` würde der Plan Branch und Domains überschreiben.

### Betriebsregeln

- Staging darf jederzeit kaputtgehen, gelöscht und neu dupliziert werden.
- Lasttests, Restore-Proben und Migrationsproben laufen gegen Staging, nie
  gegen Production.
- Ein Import maskierter Production-Daten in Staging ist eine eigene, zu
  dokumentierende Operation; bis dahin bleibt Staging mit Seed-Daten befüllt.

### Staging-Tests und Lastläufe

Stand: 18.09.2026.

Die Staging-Tests liegen als eigenes Vitest-Projekt unter
`apps/api/test/staging/` (Konfiguration
`apps/api/test/staging/vitest.config.mts`). Sie laufen gegen die echte
Staging-API und schreiben dort Daten; Zugangsdaten und Ziel-URLs kommen aus
der git-ignorierten `.env.staging` im Repository-Wurzelverzeichnis:

`.env.staging` gehört in den Haupt-Checkout
(`/home/sut/projects/darts-platform/.env.staging`) und wird von dort bei
Bedarf in einen Worktree kopiert. Ein entfernter Worktree nimmt
git-ignorierte Dateien mit sich; eine dort abgelegte `.env.staging` ist
damit verloren, sobald der Worktree gelöscht wird.

| Variable | Zweck |
| --- | --- |
| `STAGING_API_URL` | Basis-URL der Staging-API |
| `STAGING_WEB_ORIGIN` | erlaubter Origin des Staging-Web-Frontends |
| `STAGING_EMAIL` | Anmeldeadresse des Testkontos `test-runner@example.test` |
| `STAGING_PASSWORD` | Passwort des Testkontos |
| `STAGING_ORGANIZATION_ID` | ID der Organisation «Staging Testverein» |
| `STAGING_LOAD_BOARDS` | Anzahl Boards für Fall A3 (Vorgabe 20; kleinere Werte für einen Smoke-Lauf) |
| `STAGING_LOAD_SECONDS` | Laufzeit von Fall A3 in Sekunden (Vorgabe 120) |

Alle Fälle auf einmal (inklusive des rund zweiminütigen Lasttests):

```bash
pnpm test:staging
```

Eine einzelne Datei gezielt ausführen:

```bash
cd apps/api && npx dotenv -e ../../.env.staging -- npx vitest run \
  --config test/staging/vitest.config.mts test/staging/<datei>
```

**Sign-in-Budget.** Die sensiblen Routen (Login, Registrierung,
Einladungsannahme) sind serverseitig auf `RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE`
(Vorgabe 10) je Client und Minute begrenzt. Staging-Testfälle, die sich
mehrfach anmelden, müssen mit diesem Budget planen (z. B. eine Sitzung
wiederverwenden statt pro Fall neu anzumelden). Ein voller Lauf von
`pnpm test:staging` verbraucht **7 von 10** Logins/Minute: 1 Smoke-Test
(`staging-client.staging.spec.ts`) + 1 Nebenläufigkeit (`concurrency…`) +
1 Last (`load…`) + 1 Realtime (`realtime…`) + 3 Auth-Flows
(`auth-flows…`, D4-1/D4-2/D4-3). Die Vitest-Konfiguration
(`apps/api/test/staging/vitest.config.mts`, `fileParallelism: false`) führt
die Dateien deshalb nacheinander statt parallel aus — nur so bleiben die
Logins über die Minute verteilt statt gleichzeitig anzufallen.

**Exit-Code von `pnpm test:staging`.** Solange Befund D3-1 offen ist, endet
`pnpm test:staging` wegen Fall A5 bewusst mit Exit-Code ≠ 0 (roter Testfall,
siehe `docs/testing/protokolle/2026-09-18-block-a.md`). Das ist kein
Ausführungsfehler des Laufs selbst; ein grüner Exit-Code ist erst nach
Behebung (oder explizit begründeter Akzeptanz) von D3-1 zu erwarten.

**Datenwachstum in Staging.** Jeder volle Lauf legt in der Staging-Datenbank
neue, nie automatisch gelöschte Organisationen an — pro Lauf fünf, mit dem
Slug-Präfix `lasttest-` und den Läufer-Präfixen `conc-`, `load-`, `rt-`,
`d5-` und `run-` (z. B. `lasttest-load-1758...`), plus die dazugehörigen
Spieler, Matches und Visits. Aufräumen:

```sql
DELETE FROM organizations WHERE slug LIKE 'lasttest-%';
```

direkt auf der Staging-Datenbank, oder alternativ Staging komplett neu aus
Production duplizieren (siehe Betriebsregeln oben — Staging darf jederzeit
kaputtgehen und neu entstehen).

**Limits für Lastläufe vorübergehend anheben.** Die Fälle A3/A4/A6 (Block A)
und die B4/B5-Proben brauchen mehr als das reguläre Rate-Limit. Jeder
`railway`-Befehl trägt dabei explizit
`--project b72b141e-1685-44d7-960e-06c6b3998b34 --environment staging`
sowie den passenden `--service`; ohne diese Flags entscheidet der zuletzt
verlinkte Kontext, welches Projekt/Environment/Service getroffen wird.
Ablauf:

1. Beide Variablen auf der Staging-API auf einen hohen Wert setzen:

   ```bash
   railway variable set RATE_LIMIT_MAX_PER_MINUTE=100000 \
     RATE_LIMIT_SOCKET_MAX_PER_MINUTE=100000 \
     --project b72b141e-1685-44d7-960e-06c6b3998b34 \
     --environment staging --service @darts-platform/api
   ```

2. ```bash
   railway redeploy --yes \
     --project b72b141e-1685-44d7-960e-06c6b3998b34 \
     --environment staging --service @darts-platform/api
   ```

   (ohne `--from-source`), damit die neuen Werte greifen.
3. Lastlauf ausführen.
4. Beide Variablen wieder löschen — `railway variable delete <KEY>` nimmt
   jeweils nur einen einzelnen Schlüssel entgegen, also zwei Aufrufe, je mit
   denselben `--project`/`--environment`/`--service`-Flags wie in Schritt 1.
5. Erneut

   ```bash
   railway redeploy --yes \
     --project b72b141e-1685-44d7-960e-06c6b3998b34 \
     --environment staging --service @darts-platform/api
   ```

   danach mit einer Anfrage den `x-ratelimit-limit`-Antwort-Header prüfen:
   er muss wieder die Vorgabewerte zeigen (300 allgemein, 60 für
   Socket-Handshakes). **Einschränkung:** `x-ratelimit-limit` zeigt nur das
   allgemeine Limit (`RATE_LIMIT_MAX_PER_MINUTE`); das
   Socket-Handshake-Limit (`RATE_LIMIT_SOCKET_MAX_PER_MINUTE`) erscheint in
   keinem Antwort-Header und lässt sich nur indirekt über das Verhalten der
   Socket-Verbindungen selbst prüfen.

**Redis- und Worker-Neustart unter Last (B4/B5).** Dieselben expliziten
Flags gelten für die Restart-Proben, jeweils mit dem Namen des betroffenen
Service statt der API:

```bash
railway restart --project b72b141e-1685-44d7-960e-06c6b3998b34 \
  --environment staging --service Redis
railway restart --project b72b141e-1685-44d7-960e-06c6b3998b34 \
  --environment staging --service @darts-platform/worker
```

**Beobachtung zu SKIPPED-Deploys.** Mit `checkSuites: true` verwirft Railway
in Staging einen Deploy, der allein durch eine Variablenänderung ausgelöst
wird, als `SKIPPED`, solange am betroffenen Commit keine Check-Suite vorliegt.
`railway redeploy --yes` (ohne `--from-source`) läuft davon unabhängig und
übernimmt die geänderten Variablen trotzdem — das ist der verlässliche Weg,
um eine Variablenänderung tatsächlich auszurollen.

**Restore-Probe (B2).** Am 18.09.2026 gegen 14:44–15:04 UTC gegen Staging
gefahren, Deploy Staging-API `develop` 2311f2c/c4ad4eb. Skript:
`apps/api/test/staging/b2-probe.ts` (Betriebsprobe, kein Vitest-Fall,
einzeln aufzurufen). Ablauf und genaue Befehle:

1. PITR auf der Staging-Datenbank einschalten (löst laut Railway selbst
   einen einmaligen Redeploy der Datenbank aus) und den Stand prüfen:

   ```bash
   railway postgres pitr enable --project b72b141e-1685-44d7-960e-06c6b3998b34 \
     --environment staging --service Postgres
   railway postgres pitr status --project b72b141e-1685-44d7-960e-06c6b3998b34 \
     --environment staging --service Postgres
   ```

   Ergebnis: `enabled: true`, `bucketWired: true`.

2. Manuelles Backup versuchen (nur zur Kontrolle, für den Restore nicht
   nötig — PITR erlaubt Restore auf jeden Zeitpunkt aus dem laufenden WAL):

   ```bash
   railway postgres pitr backup create --project b72b141e-1685-44d7-960e-06c6b3998b34 \
     --environment staging --service Postgres
   ```

   Ergebnis: „You do not have access to this resource" — manuelle Backups
   sind auf diesem Plan/dieser Ebene nicht verfügbar.

3. Referenzdaten erzeugen (`b2-probe.ts before`): zählt die Organisationen
   des Testkontos, hält den Zeitpunkt T1 fest, wartet 5 s und legt danach
   eine weitere Organisation an. Gemessen: 10 Organisationen vor T1
   (14:59:07 UTC), 11 danach (14:59:12 UTC, `lasttest-b2-after-…`).

4. Restore auf T1 in einen neuen Service:

   ```bash
   railway postgres pitr restore --project b72b141e-1685-44d7-960e-06c6b3998b34 \
     --environment staging --service Postgres \
     --at 2026-09-18T14:59:10Z --new-service-name postgres-restored --yes --json
   ```

   `--yes` ist für den nicht-interaktiven Aufruf nötig; die Aktion ist
   asynchron. Beobachtet: pgbackrest spielte das Backup-Set
   `20260918-140417F` zurück und replayte den WAL bis zur letzten
   abgeschlossenen Transaktion um 14:59:08 UTC; „database system is ready"
   um 15:03:39 UTC — Restore-Dauer ≈ 1,5 Minuten ab Start des Befehls.

5. Verifikation über die Staging-API, ohne sie dauerhaft umzuhängen:

   ```bash
   railway variable set DATABASE_URL='${{postgres-restored.DATABASE_URL}}' \
     --project b72b141e-1685-44d7-960e-06c6b3998b34 \
     --environment staging --service @darts-platform/api
   railway redeploy --yes --project b72b141e-1685-44d7-960e-06c6b3998b34 \
     --environment staging --service @darts-platform/api
   # b2-probe.ts verify 10   → Health "ok", 10 Organisationen, nach-T1-Organisation fehlt
   railway variable set DATABASE_URL='${{Postgres.DATABASE_URL}}' \
     --project b72b141e-1685-44d7-960e-06c6b3998b34 \
     --environment staging --service @darts-platform/api
   railway redeploy --yes --project b72b141e-1685-44d7-960e-06c6b3998b34 \
     --environment staging --service @darts-platform/api
   # b2-probe.ts verify 11   → wieder 11 Organisationen, nach-T1-Organisation vorhanden
   ```

   Beide Umschaltungen bestätigt: Restore ohne Schreibvorgänge nach dem
   Zielzeitpunkt, Zurückschalten auf die Original-Datenbank funktioniert.

6. Aufräumen (Betreiberentscheid, destruktiv, nicht Teil der Probe selbst):

   ```bash
   railway service delete --project b72b141e-1685-44d7-960e-06c6b3998b34 \
     --environment staging postgres-restored
   ```

   Der Service `postgres-restored` aus der Probe vom 18.09.2026 ist am selben
   Abend gelöscht worden; Staging besteht wieder nur aus `api`, `web`,
   `worker`, Postgres und Redis.

Details und Messwerte: `docs/testing/protokolle/2026-09-18-block-b.md`,
Abschnitt „B2 Restore-Probe auf Staging".

## Provider-Zuständigkeiten

```text
Cyon
└── Registrierung von dartbase.ch
    └── Nameserver-Delegation an Cloudflare

Cloudflare
└── autoritative DNS-Zone für dartbase.ch
    └── DNS-only-Einträge zu Railway

Railway
├── App-Services und Datenservices
├── Domain-Verifikation
└── Ausstellung und Erneuerung der TLS-Zertifikate
```

Die frühere Cyon-Zone ist nach der Nameserver-Umstellung nicht mehr
autoritativ. Cyon-SOA- und Cyon-NS-Einträge werden nicht nach Cloudflare
kopiert; Cloudflare verwaltet diese Einträge selbst.

## Domain- und DNS-Konfiguration

Die folgenden Einträge sind in der Cloudflare-Zone eingerichtet:

| Typ | Name | Ziel / Inhalt | Proxy |
| --- | --- | --- | --- |
| CNAME | `@` | `n18cxml4.up.railway.app` | DNS only |
| CNAME | `*` | `c6ftjs65.up.railway.app` | DNS only |
| CNAME | `api` | `un846eur.up.railway.app` | DNS only |
| CNAME | `_acme-challenge` | `c6ftjs65.authorize.railwaydns.net` | DNS only |
| TXT | `_railway-verify` | `railway-verify=d209d5f282cc48c684e1432b410f81b25ada9cbb46912cb993490aa2419356a6` | DNS only |
| TXT | `_railway-verify.api` | `railway-verify=47edcca29b3dad19837747d76f6a90dc8313cf7f81d4cb7c09f2cb4882330107` | DNS only |

Cloudflare stellt den CNAME am Zone Apex über CNAME Flattening bereit. Der
ACME-Eintrag muss immer `DNS only` bleiben. Die übrigen Railway-Einträge bleiben
bis zur erfolgreichen Inbetriebnahme ebenfalls `DNS only`; ein späteres
Aktivieren des Cloudflare-Proxys ist eine eigene, zu testende Betriebsänderung.

Der TXT-Wert ist kein Anwendungsschlüssel, wird aber nur geändert oder entfernt,
wenn Railway für die Domain keine Ownership-Verifikation mehr verlangt.

### Verhalten der Wildcard-Domain

`*.dartbase.ch` leitet beliebige nicht explizit definierte Subdomains zum
Web-Service. Damit daraus automatisierte Organisations-Subdomains werden, muss
die Anwendung den HTTP-Hostname validieren und serverseitig einer Organisation
zuordnen. Die Wildcard allein implementiert keine Tenant-Zuordnung.

Explizite DNS-Einträge haben Vorrang vor der Wildcard. Deshalb zeigt
`api.dartbase.ch` mit einem eigenen CNAME direkt zum API-Service.

Zum Einrichtungszeitpunkt erlaubt Railway Hobby zwei Custom Domains pro Service.
Am Web-Service werden beide Slots durch `dartbase.ch` und `*.dartbase.ch`
verwendet. Die Slots eines separaten API-Service werden davon nicht verbraucht.

### E-Mail-DNS

Die aktuelle Zone enthält keine dokumentierte Mailkonfiguration. Falls Adressen
unter `@dartbase.ch` verwendet werden sollen, müssen MX, SPF, DKIM und DMARC vom
gewählten Mailanbieter in Cloudflare ergänzt werden. Ohne Mailbetrieb werden
keine erfundenen MX-Einträge angelegt.

## Zielarchitektur und bekannte IaC-Abweichung

Der gewünschte Produktionsfluss ist:

```text
Browser -> Cloudflare DNS -> Railway Web -> Railway API
                                           ├── PostgreSQL
                                           └── Redis
Railway Worker -----------------------------┘
```

Railway PostgreSQL ist die verbindliche persistente Datenbank für `production`
und `staging`. Neon wird nur für Development und kurzlebige Preview-Branches
gemäß [Neon-Preview-Runbook](./neon-preview.md) verwendet.

Die gewünschte Infrastruktur liegt in
[`.railway/railway.ts`](../.railway/railway.ts). Sie bildet das angelegte
Projekt `dartbase` mit Web, API, Worker, PostgreSQL, Redis, persistenten Volumes,
Domains und Service-Konfigurationen ab. Der kontrollierte Abgleich vom
31. August 2026 meldete `No changes.`. Jeder spätere Plan muss erneut geprüft
werden; ein Apply ist nur bei einer erwarteten Abweichung erforderlich.

## DNS-Einträge für die Public API

Das Web-Frontend verwendet `NEXT_PUBLIC_API_URL` im Browser. Die Custom Domain
`api.dartbase.ch` ist deshalb am API-Service angelegt. In Cloudflare
übersteuern diese exakten Einträge die Web-Wildcard und bestätigen Railway das
Domain-Eigentum:

| Typ | Name | Ziel / Inhalt | Proxy |
| --- | --- | --- | --- |
| CNAME | `api` | `un846eur.up.railway.app` | DNS only |
| TXT | `_railway-verify.api` | `railway-verify=47edcca29b3dad19837747d76f6a90dc8313cf7f81d4cb7c09f2cb4882330107` | DNS only |

Beide Einträge sind propagiert, Railway hat die Domain verifiziert und das
Zertifikat ist gültig. Die Production-Variablen verwenden
`https://api.dartbase.ch`.

## Variablen

Mindestens diese Shared beziehungsweise Service-Variablen werden benötigt:

| Variable | Production-Wert | Zweck |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | zufälliger Wert mit mindestens 32 Zeichen | Signatur-/Session-Secret, niemals committen |
| `BETTER_AUTH_URL` | `https://api.dartbase.ch` | öffentliche Basis-URL der API |
| `WEB_ORIGIN` | `https://dartbase.ch` | exakt erlaubter CORS-Origin |
| `WEB_ADDITIONAL_ORIGINS` | `https://www.dartbase.ch` | kommaseparierte Liste weiterer explizit erlaubter CORS- und Auth-Origins |
| `NEXT_PUBLIC_API_URL` | `https://api.dartbase.ch/api/v1` | API-URL im Browser-Bundle |
| `DATABASE_URL` | Railway-Referenz auf PostgreSQL | persistente Production-Datenbank |
| `REDIS_URL` | Railway-Referenz auf Redis | Cache, Queue und Realtime |
| `RATE_LIMIT_MAX_PER_MINUTE` | `300` | Obergrenze je IP und Minute für alle übrigen Routen (optional, Vorgabe 300) |
| `RATE_LIMIT_PUBLIC_MAX_PER_MINUTE` | `600` | Obergrenze für `/api/v1/public/**` (optional, Vorgabe 600) |
| `RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE` | `10` | Obergrenze für Anmeldung, Registrierung und die Annahme einer Einladung (optional, Vorgabe 10) |
| `RATE_LIMIT_SOCKET_MAX_PER_MINUTE` | `60` | Obergrenze für Socket.IO-Handshakes je Client-Adresse und Minute (optional, Vorgabe 60) |
| `TRUST_PROXY_HOPS` | `1` | **Pflicht.** Anzahl vertrauter Reverse-Proxy-Hops vor der Anwendung |
| `ALLOW_SELF_SERVICE_ORGANIZATIONS` | nicht gesetzt (`false`) | öffnet `POST /organizations` für jede angemeldete Person; in Production bewusst aus |
| `LOG_CLIENT_ADDRESS` | nicht gesetzt (`false`) | Diagnose: schreibt `request.ip` und die rohen Adress-Header ins Request-Log (Staging, Plan Task 3) |

`REDIS_URL` akzeptiert `redis://` und `rediss://`; für die verschlüsselte
Verbindung wird die TLS-Variante der Railway-Referenz eingetragen.

`TRUST_PROXY_HOPS` muss genau der Anzahl vertrauter Reverse-Proxy-Hops vor der
Anwendung entsprechen — hinter Railways eigenem Edge-Proxy also `1`. Der Wert
bestimmt, welcher Eintrag der `X-Forwarded-For`-Kette Fastify als
`request.ip` gilt. Ein zu hoch gesetzter Wert macht `X-Forwarded-For` durch
den Client selbst fälschbar: wer mehr Hops vorgibt als tatsächlich vorhanden
sind, kann eine beliebige IP-Adresse als eigene ausgeben. Zulässig sind 0 bis
10.

Die tatsächlich für Rate Limiting und Audit verwendete Client-Adresse kommt
seit Plan 2026-09-17-go-live-testprogramm (Task 3, Befund D3-1) nicht aus
`request.ip`, sondern aus `resolveClientAddress`
(`apps/api/src/common/client-address.ts`): mit `TRUST_PROXY_HOPS > 0` gilt
`X-Real-IP` — von Railway überschrieben, siehe
docs.railway.com/networking/public-networking/specs-and-limits —, `request.ip`
bleibt der Rückfall, unter anderem für Railways interne Probe ohne diesen
Header.

Der Wert `1` ist eine Annahme über Railways Edge und **beim Deploy zu
verifizieren**: einmal `request.ip` und den rohen `X-Forwarded-For`-Header
einer Anfrage von einer bekannten Client-IP protokollieren. Wird der
Cloudflare-Proxy (heute `DNS only`, siehe Abschnitt DNS) später eingeschaltet,
kommt ein Hop dazu und der Wert muss auf `2` steigen — sonst teilen sich alle
Clients wieder einen Rate-Limit-Zähler.

`TRUST_PROXY_HOPS` ist in Production Pflicht: **der Deploy scheitert beim
Start, bis die Variable gesetzt ist.** Ein stillschweigendes `0` wäre in
Production ein Fehlgriff, kein sicherer Default — dann zählte Railways
Edge-Proxy selbst als Client, und das 10/min-Limit der sensiblen Routen träfe
alle Nutzer gemeinsam. Ein explizit gesetztes `0` bleibt möglich (etwa für
einen kurzzeitigen Test ohne Proxy davor), nur unbelegt ist unzulässig.

`BETTER_AUTH_SECRET` kann beispielsweise mit `openssl rand -base64 32` erzeugt
werden. Secret-Werte werden ausschließlich in Railway hinterlegt und weder im
Repository noch in Tickets oder Logs kopiert.

## Einmaliger Production-Owner-Bootstrap

Die leere Production-Datenbank wird über den kompilierten API-Befehl vorbereitet;
es gibt keinen öffentlichen Bootstrap-Endpoint, keinen automatischen
Startup-Hook, kein Default-/temporäres Passwort und keinen manuellen SQL-
Fallback. Der Root-Befehl und seine API-Delegation sind:

```text
pnpm db:bootstrap:production
→ pnpm --filter @darts-platform/api bootstrap:production
→ node dist/operations/bootstrap-production.js
```

Der Root- beziehungsweise API-pnpm-Wrapper ist der normale Bedienbefehl und
kann zusätzlich Lifecycle- oder Bannertext ausgeben. Für maschinenlesbares
Readback wird aus dem API-Image-Arbeitsverzeichnis `/app` der kompilierte
Node-Entry-Point direkt aufgerufen:

```text
node /app/apps/api/dist/operations/bootstrap-production.js
```

Der API-Build muss vor der Ausführung erfolgreich gewesen sein. Der rohe Guard
prüft zuerst `NODE_ENV=production` und exakt `ALLOW_PRODUCTION_BOOTSTRAP=true`;
erst danach werden Anwendungskonfiguration und Datenbankverbindung aufgebaut.
Beim ersten Start führt die versionierte Migration 0013 vorhandene tokenlose
`PENDING`-Einladungen als `EXPIRED`; sie müssen bei Bedarf neu ausgestellt
werden.
Die Bootstrap-spezifischen Variablen sind exakt:

```text
ALLOW_PRODUCTION_BOOTSTRAP=true
BOOTSTRAP_OWNER_EMAIL
BOOTSTRAP_INVITATION_CLAIM_TOKEN (43 Zeichen, mindestens 256 Bit Zufall)
BOOTSTRAP_ORGANIZATION_NAME
BOOTSTRAP_ORGANIZATION_SLUG
BOOTSTRAP_TIMEZONE (optional, Standard: Europe/Zurich)
BOOTSTRAP_LOCALE (optional, Standard: de-CH)
```

E-Mail-Adresse, Organisationsname, Slug, Zeitzone und Locale werden serverseitig
normalisiert und validiert. Die Transaktion erzeugt eine 48 Stunden gültige
OWNER-Einladung über den nicht anmeldbaren, persistenten System-Prinzipal
`production-bootstrap@system.dartbase.invalid`. Dieser besitzt keinen Account,
kein Passwort, keine Session und keine Membership und erhält keine Rechte; er
bleibt nur für Einladungsreferenz und Audit bestehen. Reguläre öffentliche
Einladungen lehnen `OWNER` weiterhin ab.

Der direkte kompilierte Node-Entry-Point schreibt genau eine sichere JSON-Zeile
nach stdout; bei Fehler genau eine sanitierte JSON-Zeile nach stderr. Der
pnpm-Wrapper kann zusätzlich sicheren Lifecycle-/Bannertext ausgeben. `created`
bedeutet neue Bootstrap-Daten und Einladung, `pending` eine unveränderte, noch
gültige
exakte Einladung, `already-complete` eine exakt abgeschlossene Owner-Aufnahme
ohne Schreibvorgang. Eine passende abgelaufene Einladung wird historisiert und
erneuert (`created`). Reruns liefern `pending` oder `already-complete` nur für
den jeweils exakt bestätigten Zustand; fremde oder widersprüchliche Daten
brechen fail-closed ab. Die Ausgabe enthält weder Passwort, Datenbank-URL,
Secret noch Stacktrace. Kontrollierte Fehler des direkten Node-Entry-Points
ergeben die eine sanitierte JSON-Zeile nach stderr und Exit-Code 1.

### Einmalige Railway-SSH-Ausführung

Die Ausführung erfolgt erst nach erfolgreichem API-Deployment und einmalig über
Railway SSH. Die Identität ist nur für diesen Vorgang gültig:

```bash
release_ssh_dir="$(mktemp -d)"
ssh-keygen -q -t ed25519 -N '' -f "$release_ssh_dir/id_ed25519"
railway ssh keys add --key "$release_ssh_dir/id_ed25519.pub" --name dartbase-production-bootstrap
railway ssh keys list
```

Die Ausgabe von `railway ssh keys list` liefert die temporäre Schlüssel-ID.
Diese ID wird vor der Ausführung notiert. Im verknüpften Railway-Projekt und der
Production-Umgebung wird anschließend der kompilierte API-Befehl ausgeführt;
die vorhandene Service-Umgebung muss `NODE_ENV=production` liefern:

```bash
railway ssh \
  --project b72b141e-1685-44d7-960e-06c6b3998b34 \
  --environment 94bb1675-f688-40e0-a403-e62807715120 \
  --service @darts-platform/api \
  --identity-file "$release_ssh_dir/id_ed25519" \
  env \
  ALLOW_PRODUCTION_BOOTSTRAP=true \
  BOOTSTRAP_OWNER_EMAIL="$bootstrap_owner_email" \
  BOOTSTRAP_INVITATION_CLAIM_TOKEN="$bootstrap_invitation_claim_token" \
  BOOTSTRAP_ORGANIZATION_NAME="$bootstrap_organization_name" \
  BOOTSTRAP_ORGANIZATION_SLUG="$bootstrap_organization_slug" \
  BOOTSTRAP_TIMEZONE=Europe/Zurich \
  BOOTSTRAP_LOCALE=de-CH \
  node /app/apps/api/dist/operations/bootstrap-production.js
```

Die sechs Bootstrap-Variablen werden mit den bestätigten Werten belegt; die
Optionen für Zeitzone und Locale dürfen bei abweichenden, validen Werten
entsprechend ersetzt oder weggelassen werden. Erwartet wird genau eine
`production_bootstrap_completed`-JSON-Zeile vom direkten Node-Entry-Point mit
`created` oder dem exakt
idempotenten `pending`-Status und nicht-null `expiresAt`. Bei einer bereits
abgeschlossenen Aufnahme ist `already-complete` mit `expiresAt: null` korrekt.

Unmittelbar nach der Ausführung wird die Identität aus Railway und lokal
entfernt; die Entfernung wird gelesen und bestätigt:

```bash
railway ssh keys remove "$temporary_key_id"
shred -u "$release_ssh_dir/id_ed25519" "$release_ssh_dir/id_ed25519.pub"
rmdir "$release_ssh_dir"
railway ssh keys list
```

Der temporäre Schlüssel darf in der abschließenden Liste nicht mehr erscheinen.
Der Operator verarbeitet kein Passwort. Der Einladungscode wird nur über einen
sicheren Kanal an den Owner übermittelt und weder in Logs noch in der URL
gespeichert. Der eingeladene Owner registriert sich mit exakt dieser E-Mail und
dem Code, meldet sich an und gibt denselben Code bei der Annahme ein. Erst danach
existiert die aktive OWNER-Membership.

## Demo-Seed für eine bestehende Organisation

Der Demo-Seed füllt eine **bereits existierende** Organisation mit Testdaten:
32 Spieler, 8 Boards, zwei abgeschlossene Turniere und ein laufendes Turnier mit
einem aktiven Scoring-Match. Alle Schreibvorgänge laufen über die Domain-Services,
sodass Tenant-Scoping, Autorisierung und Versionsprüfung greifen.

Die Operation legt weder Organisation noch Benutzer noch Mitgliedschaft an. Sie
handelt als der bereits vorhandene aktive OWNER der Zielorganisation und bricht
ohne Schreibzugriff ab, wenn die Organisations-ID unbekannt ist oder kein aktiver
Owner existiert. Ein zweiter Lauf erzeugt keine Duplikate.

Voraussetzungen sind ein erfolgreiches API-Deployment und eine registrierte
Railway-SSH-Identität (siehe oben). Die Service-Umgebung liefert bereits
`NODE_ENV=production`; nur der Opt-in und die Ziel-ID werden gesetzt:

```bash
railway ssh \
  --project b72b141e-1685-44d7-960e-06c6b3998b34 \
  --environment 94bb1675-f688-40e0-a403-e62807715120 \
  --service @darts-platform/api \
  --identity-file "$release_ssh_dir/id_ed25519" \
  env \
  ALLOW_DEMO_SEED=true \
  DEMO_SEED_ORGANIZATION_ID="$demo_seed_organization_id" \
  node /app/apps/api/dist/operations/seed-demo-organization.js
```

Übernimmt die CLI die Argumente nicht als Kommando, sondern öffnet eine
interaktive Sitzung, wird derselbe Aufruf ohne `railway ssh`-Präfix direkt in
dieser Sitzung ausgeführt.

Vor dem eigentlichen Lauf wird der Guard verifiziert: derselbe Aufruf **ohne**
`ALLOW_DEMO_SEED=true` muss mit Exit-Code 1 und
`{"event":"demo_seed_failed","code":"DEMO_SEED_NOT_ALLOWED",…}` scheitern, ohne
etwas zu schreiben.

Erwartet wird danach genau eine `demo_seed_completed`-JSON-Zeile mit
`players: 32`, `boards: 8`, `completedTournaments: 2` und
`runningTournaments: 1`. Fehlerausgaben sind sanitiert; weder `DATABASE_URL` noch
Stacktraces erscheinen.

Die SSH-Identität wird unmittelbar danach entfernt, wie beim Bootstrap. Registriert
die CLI beim Verbinden selbst einen Schlüssel, trägt er einen abgeleiteten Namen
statt des mit `--name` gewünschten; entfernt wird er über seinen Fingerprint:

```bash
railway ssh keys list
railway ssh keys remove "$temporary_key_fingerprint"
railway ssh keys list
```

## GitHub-CI-Gate

Stand: 18.09.2026.

Der Workflow `.github/workflows/ci.yml` veröffentlicht zwei stabile Checks:

```text
Phase 0 quality gate
Deployment artifacts
```

Das Repository ist seit dem 18.09.2026 öffentlich. `main` und `develop`
tragen seither eine Branch-Protection-Regel:

- nur per Pull Request, keine direkten Pushes
- erforderliche Status-Checks: `Phase 0 quality gate` und
  `Deployment artifacts`, jeweils `strict` (der Branch muss vor dem Merge auf
  dem aktuellen Stand des Zielbranches sein)
- gilt auch für Administratoren
- kein Force-Push, kein Löschen des Branches
- Konversationen (Review-Kommentare) müssen vor dem Merge aufgelöst sein
- keine Mindestzahl an Freigaben (Solo-Maintainer)

Konsequenz für den Ablauf: Feature-Branches gehen ausschliesslich per Pull
Request nach `develop`, `develop` ausschliesslich per Pull Request nach
`main` — direkte Pushes auf `develop` sind seither technisch unterbunden.
Der von Web, API und Worker gemeinsam genutzte Railway-GitHub-Source
verwendet weiterhin `checkSuites: true`: Railway wartet vor dem Deployment
auf erfolgreiche Check Suites des verfolgten Commits. Weil der Merge selbst
bereits grüne Checks voraussetzt, liegen sie am Merge-Commit vor, sobald der
Pull Request angenommen wird — Railway staging deployt also unmittelbar nach
dem Merge nach `develop`, ohne selbst noch auf einen laufenden Check zu
warten. Der Workflow reagiert zusätzlich auf `merge_group`, sodass er auch
nach einer künftigen Aktivierung einer Merge Queue funktioniert.

## Kontrollierter Deployment-Ablauf

1. IaC-Plan ausführen und bestätigen, dass nur erwartete Änderungen enthalten
   sind.
2. Railway PostgreSQL und Redis bereitstellen.
3. Alle erforderlichen Variablen und Service-Referenzen setzen.
4. `api.dartbase.ch` anlegen und DNS sowie Zertifikat verifizieren.
5. Konfiguration vor dem Apply prüfen:

   ```bash
   railway config plan
   ```

6. Den Plan auf unerwartete Löschungen, Umbenennungen oder Ersatzressourcen
   prüfen und erst nach bewusster Freigabe anwenden:

   ```bash
   railway config apply
   ```

7. Web, API und Worker deployen und die Deployment-Logs prüfen.
8. Smoke-Tests durchführen und erst danach Production freigeben.

Der API-Container führt vor jedem Start ausstehende Drizzle-Migrationen aus. Ein
Migrationsfehler beendet den Container, bevor die API Anfragen annimmt. Die API
läuft zunächst mit genau einer Replik, um parallele Migrationsstarts zu
verhindern. Vor horizontaler Skalierung wird ein eigenständiger
Pre-Deploy-/Migration-Job eingeführt.

## Deploy-Reihenfolge bei erweitertem Antwortvertrag

Web und API sind getrennte Railway-Dienste und werden nicht atomar
ausgerollt. Macht ein Release den Antwortvertrag um ein Pflichtfeld reicher,
scheitert der Zod-Parse im Web an einer noch alten API-Antwort, sobald das
neue Web zuerst online ist — betroffen ist dann jede Fläche, die diesen
Vertrag parst, im ersten dokumentierten Fall jede Scoringfläche.

Verbindlich:

- Bei Releases, die den Antwortvertrag um Pflichtfelder erweitern, wird die
  **API vor dem Web** ausgerollt.
- Ein Rollback läuft in umgekehrter Reihenfolge: **Web vor API**.

Erster Fall: `openedInLeg` in `matchParticipantStateSchema`
(`packages/schemas/src/match.ts`, Commits `ca38fc7`/`16bb2aa`) wurde
Pflichtfeld; `apps/web/src/components/match/match-scoreboard-route.tsx`
parst die API-Antwort damit.

Zweiter Fall: `bullOffFromLegOne` in `matchStateSchema` (Reglement 2.2.9,
Tier-2-Task 4) wurde ebenfalls Pflichtfeld — dieselbe Reihenfolge gilt.

Auch `outbox` in `healthResponseSchema` ist ein solches Pflichtfeld:
`apps/web/src/lib/health.ts` parst die Health-Antwort mit Zod, ein neues Web
gegen eine alte API bekäme deshalb die Statusübersicht nicht mehr geparst
(Anzeige „nicht erreichbar", keine weitere Auswirkung). API vor Web.

Rollback-Detail: Ein Zurückrollen der API allein strippt `checkoutSegment`
aus gespeicherten Kommandos, da `storedSubmitSchema` nicht `.strict()` ist —
betroffene Master-Out-Finishes fallen dann auf die alte Heuristik zurück; für
die von der UI erzeugten Fälle liefert sie dasselbe Ergebnis, garantiert ist
es nicht.

Dritter Fall — umgekehrte Richtung: `careerStatistics.checkoutPercentage`,
`checkoutAttempts` und `checkouts` (`packages/statistics/src/statistics.ts`)
sind neu nullable, wo sie vorher immer eine Zahl waren. Hier kippt die
Reihenfolge: ein noch altes Web-Bundle ruft auf diesen Feldern ungeprüft
`toFixed` auf `null` auf und stürzt ab; sein Zod-Schema erwartet ausserdem
weiterhin eine Pflichtzahl und lehnt die Antwort schon beim Parsen ab. Bei
dieser Art Vertragsänderung — ein Feld wird lockerer statt strenger — muss
darum das **Web mit oder vor der API** ausgerollt werden. Ein alleiniges
Rollback des Web ist dabei unsicher, solange die API weiterhin `null`
liefert: das zurückgerollte, alte Web trifft exakt auf diesen Zustand und
bricht wieder ab.

Betriebsempfehlung: API und Web im selben Deploy-Fenster ausrollen, dann
stellt sich die Reihenfolgefrage gar nicht erst. Nicht jede
Vertragserweiterung trägt dieses Risiko: `StandingsRow.minusPoints`
(`packages/league-engine/src/standings.ts`) ist additiv und
reihenfolgeunabhängig, dort gilt keine der beiden Regeln.

## Verifikation und Smoke-Test

DNS und Zertifikate werden sowohl bei Cloudflare als auch im Railway-Domainstatus
geprüft. Anschließend:

```bash
curl --fail https://api.dartbase.ch/api/v1/health
curl --fail https://dartbase.ch/
```

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
Zeilen nach `DATABASE_SCHEMA.md` §18 behandeln. Solange `deadLettered` grösser
als null ist, bleibt der Status `degraded`, bis die betroffene Zeile requeued
oder gelöscht wird — der Wert sinkt nicht von selbst.

Am 31. August 2026 lieferten beide öffentlichen Smoke-Tests HTTP 200. Der
API-Health-Endpunkt meldete PostgreSQL und Redis jeweils als `ok`.

Vor dem ersten UI-Smoke-Test muss der beschriebene einmalige Bootstrap erfolgreich
sein und der Owner die Einladung authentifiziert angenommen haben. Der
Bootstrap-CLI-Status und die Entfernung der temporären SSH-Identität werden als
Readback dokumentiert.

Danach über die Weboberfläche:

1. Mit der exakt eingeladenen E-Mail-Adresse registrieren und wieder anmelden.
2. Die offene Einladung annehmen.
3. Organisation und zugewiesene Rolle prüfen.
4. Spieler anlegen, bearbeiten und archivieren.
5. Einen zweiten Benutzer einladen und dessen Einladung annehmen.
6. Prüfen, dass ein Viewer keinen Link «Turnierleitung» erhält.
7. Einen tenant-fremden Zugriff prüfen; erwartet wird HTTP 403.
8. Eine unbekannte Subdomain aufrufen und prüfen, dass sie weder einen fremden
   Tenant auswählt noch interne Informationen offenlegt.

Der gemeinsame Railway-GitHub-Source ist in der IaC-Konfiguration mit
`checkSuites: true` definiert und wird von Web, API und Worker verwendet. Das
Repository ist seit dem 18.09.2026 öffentlich; `main` und `develop` tragen
seither die unter [GitHub-CI-Gate](#github-ci-gate) beschriebene
Branch-Protection mit beiden Checks als Required Status Checks. Railway
wartet unabhängig davon weiterhin auf erfolgreiche Check Suites des
verfolgten Commits, bevor das jeweilige Deployment beginnt. Vor dem Release
werden der separat freigegebene IaC-Apply samt leerem Readback, beide
GitHub-CI-Checks und die exakten Deployment-Revisionen aller drei Services
verifiziert.

## Logging und Diagnose

Die API schreibt in Produktion JSON-Zeilen nach stdout/stderr. Jede
abgeschlossene HTTP-Anfrage enthält `method`, `path`, `statusCode`, `durationMs`
und `correlationId`. Railway kann diese Felder filtern. Interne Fehler werden
mit derselben Correlation-ID protokolliert, während Clients keine Stacktraces
erhalten.

Wichtige Prüfungen:

```text
event = api_started
event = http_request_completed AND statusCode >= 500
event = deployment_start_failed
```

Bei fehlgeschlagenen Deployments werden zuerst Build- und Deployment-Logs des
betroffenen Service geprüft. DNS-Änderungen beheben keine Build-, Start- oder
Variablenfehler.

## Abhängigkeiten

`pnpm-workspace.yaml` erzwingt per `overrides.fastify: ^5.12.3` eine einzige
`fastify`-Version im gesamten Baum. Ohne diese Übersteuerung installiert pnpm
zwei Instanzen nebeneinander: `@nestjs/platform-fastify@11.2.1` bringt selbst
einen exakten Pin (`fastify: 5.11.3`) mit, während `apps/api`s eigene
`fastify`-Abhängigkeit auf die jeweils neueste `5.x`-Version auflöst. Zwei
Instanzen sind zur Laufzeit unauffällig, führen aber bei `tsc` zu einem
Strukturkonflikt zwischen zwei gleichnamigen, aber unterschiedlichen
`FastifyInstance`-Typen, sobald ein Fastify-Plugin (z. B. `@fastify/helmet`,
`apps/api/src/common/security-headers.ts`) gegen die `NestFastifyApplication`
registriert wird. Die Übersteuerung zwingt beide Auflösungen auf dieselbe,
gepatchte Version und behebt den Typkonflikt, ohne die von `@nestjs/platform-
fastify` gepinnte Version zu unterschreiten.

Dieser Override muss überprüft werden, sobald `@nestjs/platform-fastify` seinen
internen `fastify`-Pin anhebt: entweder deckt die neue Nest-Version denselben
Versionsbereich bereits ab (Override kann dann entfallen) oder der Floor in
`pnpm-workspace.yaml` muss auf die neue Patch-Linie nachgezogen werden, damit
weiterhin nur eine Instanz im Baum bleibt.

## Rollback

- Anwendung: vorheriges erfolgreiches Railway-Deployment redeployen.
- DNS: den betroffenen Cloudflare-Eintrag auf den letzten bekannten Zielwert
  zurücksetzen; ACME- und Verifikationseinträge nicht als Proxy aktivieren.
- Datenbank: bestehende Migrationen niemals rückwirkend verändern. Eine
  Korrektur erfolgt als neue vorwärtsgerichtete Migration.
- Secret-Kompromittierung: `BETTER_AUTH_SECRET` rotieren; dadurch werden
  bestehende Sessions ungültig.
- Nameserver: eine Rückdelegation von Cloudflare zu Cyon ist nur ein
  Notfall-Rollback. Vorher muss die vollständige aktive Zone bei Cyon
  bereitstehen, sonst entstehen Ausfälle für Web und gegebenenfalls E-Mail.
