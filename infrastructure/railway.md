# Railway Deployment Runbook

## Zielarchitektur

Ein Railway-Projekt enthält pro Environment vier Ressourcen:

```text
web -> api -> PostgreSQL
           -> Redis
```

Die gewünschte Infrastruktur liegt in [`.railway/railway.ts`](../.railway/railway.ts).
API und Web werden aus demselben pnpm-Monorepo mit getrennten, reproduzierbaren
Dockerfiles gebaut.

## Erstinstallation

1. Railway CLI installieren, anmelden und das Repository mit einem neuen oder
   bestehenden Projekt verknüpfen.
2. Ein persistentes Environment `staging` beziehungsweise `production` wählen.
3. Für `api` und `web` öffentliche Railway-Domains oder eigene Domains vorsehen.
4. Folgende Shared Variables im Environment anlegen:

| Variable | Beispiel | Zweck |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | Ausgabe von `openssl rand -base64 32` | Signatur-/Session-Secret, niemals committen |
| `BETTER_AUTH_URL` | `https://api.example.com` | öffentliche Basis-URL der API |
| `WEB_ORIGIN` | `https://app.example.com` | exakt erlaubter CORS-Origin |
| `NEXT_PUBLIC_API_URL` | `https://api.example.com/api/v1` | API-URL im Browser-Bundle |

5. Konfiguration prüfen und anwenden:

```bash
railway config plan
railway config apply
```

6. Falls Domains erst nach dem ersten Apply erzeugt wurden, Shared Variables mit
   den finalen URLs aktualisieren und beide Services erneut deployen.

## Verbindliches CI-Gate

Der Workflow `.github/workflows/ci.yml` veröffentlicht zwei stabile Checks:

```text
Phase 0 quality gate
Deployment artifacts
```

Beide Checks sind im GitHub-Ruleset für `main` als required status checks zu
markieren. Direkte Pushes nach `main` werden dort gesperrt; Änderungen laufen über
Pull Requests. Der Workflow reagiert zusätzlich auf `merge_group`, sodass die
Checks auch mit einer GitHub Merge Queue zuverlässig ausgeführt werden.

## Deployment-Ablauf

Railway baut beim Push auf `main` beide Service-Images. Der API-Container führt
vor jedem Start alle ausstehenden Drizzle-Migrationen aus. Ein Migrationsfehler
beendet den Container, bevor die neue API Anfragen annimmt. Anschließend muss
`GET /api/v1/health` innerhalb von 120 Sekunden HTTP 200 liefern. Sobald
PostgreSQL oder Redis nicht erreichbar sind, liefert der Endpunkt HTTP 503.

Die Migrationen sind wiederholbar. Trotzdem wird die API in Phase 0 bewusst mit
einer Replik betrieben, damit kein paralleler Migrationsstart stattfindet. Vor
horizontaler Skalierung wird in einer späteren Phase ein eigenständiger
Pre-Deploy-/Migration-Job eingeführt.

## Smoke-Test nach Deployment

```bash
curl --fail https://api.example.com/api/v1/health
curl --fail https://app.example.com/
```

Danach über die Weboberfläche:

1. Benutzer registrieren und wieder anmelden.
2. Organisation erstellen.
3. Spieler anlegen, bearbeiten und archivieren.
4. Einladung mit einem zweiten Benutzer annehmen.
5. Einen tenant-fremden Zugriff prüfen; erwartet wird HTTP 403.

## Logging und Diagnose

Die API schreibt in Produktion JSON-Zeilen nach stdout/stderr. Jede abgeschlossene
HTTP-Anfrage enthält `method`, `path`, `statusCode`, `durationMs` und
`correlationId`. Railway kann diese Felder direkt filtern. Interne Fehler werden
mit derselben Correlation-ID protokolliert, während Clients keine Stacktraces
erhalten.

Wichtige Prüfungen:

```text
event = api_started
event = http_request_completed AND statusCode >= 500
event = deployment_start_failed
```

## Rollback

- Anwendung: vorheriges erfolgreiches Railway-Deployment redeployen.
- Datenbank: Migrationen werden nicht rückwirkend verändert. Eine notwendige
  Korrektur erfolgt als neue vorwärtsgerichtete Migration.
- Secret-Kompromittierung: `BETTER_AUTH_SECRET` rotieren; dadurch werden bestehende
  Sessions ungültig.
