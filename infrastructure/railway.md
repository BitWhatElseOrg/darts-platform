# Railway Deployment Runbook

## Aktueller Stand

Stand: 31. August 2026

| Bereich | Wert |
| --- | --- |
| Railway Workspace | `BitWhatElse Projects` |
| Railway-Projekt | `dartbase` |
| Environment | `production` |
| Tarif | Hobby |
| App-Services | `@darts-platform/web`, `@darts-platform/api`, `@darts-platform/worker` |
| Datenservices | `Postgres`, `Redis` |
| Registrar | Cyon |
| Autoritatives DNS | Cloudflare Free |
| Plattformdomains am Web-Service | `dartbase.ch`, `*.dartbase.ch` |

Cloudflare meldet die Zone als aktiv. Die Zertifikate für `dartbase.ch` und
`*.dartbase.ch` sowie `api.dartbase.ch` sind gültig. Web, API, Worker,
PostgreSQL und Redis sind erfolgreich deployt und die internen Healthchecks
bestehen. Die öffentlichen Web- und API-Smoke-Tests bestehen ebenfalls.

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
| `NEXT_PUBLIC_API_URL` | `https://api.dartbase.ch/api/v1` | API-URL im Browser-Bundle |
| `DATABASE_URL` | Railway-Referenz auf PostgreSQL | persistente Production-Datenbank |
| `REDIS_URL` | Railway-Referenz auf Redis | Cache, Queue und Realtime |

`BETTER_AUTH_SECRET` kann beispielsweise mit `openssl rand -base64 32` erzeugt
werden. Secret-Werte werden ausschließlich in Railway hinterlegt und weder im
Repository noch in Tickets oder Logs kopiert.

## Verbindliches CI-Gate

Der Workflow `.github/workflows/ci.yml` veröffentlicht zwei stabile Checks:

```text
Phase 0 quality gate
Deployment artifacts
```

Beide Checks sollen im GitHub-Ruleset für `main` als required status checks
markiert werden. Das private Repository läuft derzeit auf GitHub Free; GitHub
verweigert Rulesets für private Repositories in diesem Tarif. Bis zu einem
Upgrade bleibt das Repository privat und das Team prüft beide Checks vor jedem
Release manuell. Der Workflow reagiert zusätzlich auf `merge_group`, sodass er
nach einer späteren Ruleset-Aktivierung auch mit einer Merge Queue funktioniert.

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

## Verifikation und Smoke-Test

DNS und Zertifikate werden sowohl bei Cloudflare als auch im Railway-Domainstatus
geprüft. Anschließend:

```bash
curl --fail https://api.dartbase.ch/api/v1/health
curl --fail https://dartbase.ch/
```

Der Health-Endpunkt muss HTTP 200 liefern. Sobald PostgreSQL oder Redis nicht
erreichbar sind, wird HTTP 503 erwartet.

Am 31. August 2026 lieferten beide öffentlichen Smoke-Tests HTTP 200. Der
API-Health-Endpunkt meldete PostgreSQL und Redis jeweils als `ok`.

Vor dem ersten UI-Smoke-Test muss eine gültige Einladung für den ersten
Administrator bereitgestellt werden. Die öffentliche Registrierung besitzt
absichtlich keinen Bootstrap-Bypass. Das Repository enthält derzeit noch keinen
automatisierten Erstbenutzer-Befehl; vor der ersten Production-Inbetriebnahme
muss deshalb ein kontrollierter, auditierbarer Bootstrap-Prozess ergänzt oder
als Betriebsprozess freigegeben werden.

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
