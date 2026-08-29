# Railway Deployment Runbook

## Zielarchitektur

Die aktuelle Railway-IaC enthält pro Environment fünf Ressourcen:

```text
web    -> api    -> PostgreSQL
                  -> Redis
worker           -> PostgreSQL
                  -> Redis
```

Die gewünschte Infrastruktur liegt in [`.railway/railway.ts`](../.railway/railway.ts).
Web, API und der Statistik-Worker werden aus demselben pnpm-Monorepo mit
getrennten, reproduzierbaren Dockerfiles gebaut (`Dockerfile.web`,
`Dockerfile.api`, `Dockerfile.worker`).

## Erstinstallation

1. Railway CLI installieren, anmelden und das Repository mit einem neuen oder
   bestehenden Projekt verknüpfen.
2. Das Environment `production` anlegen beziehungsweise verwenden. Es gibt für
   diese Plattform bewusst kein separates `staging`.
3. Für `api` und `web` die eigenen Domains als Custom Domains in Railway
   hinterlegen: `api.dartbase.ch` für den API-Service, `app.dartbase.ch` für
   den Web-Service. Die Domain `dartbase.ch` ist bei cyon registriert; dort die
   von Railway angezeigten CNAME-Einträge für beide Hosts setzen.
4. Folgende Shared Variables im Environment `production` anlegen:

| Variable | Produktionswert | Zweck |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | Ausgabe von `openssl rand -base64 32` | Signatur-/Session-Secret, niemals committen |
| `BETTER_AUTH_URL` | `https://api.dartbase.ch` | öffentliche Basis-URL der API |
| `WEB_ORIGIN` | `https://app.dartbase.ch` | exakt erlaubter CORS-Origin |
| `NEXT_PUBLIC_API_URL` | `https://api.dartbase.ch/api/v1` | API-URL im Browser-Bundle. Railway stellt sie beim Build von `Dockerfile.web` automatisch bereit; fehlt sie am `web`-Service, greift dort stillschweigend der Vorgabewert `http://localhost:3001/api/v1` |

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

Railway baut beim Push auf `main` die Service-Images für Web, API und Worker.
Der API-Container führt vor jedem Start alle ausstehenden Drizzle-Migrationen
aus. Ein Migrationsfehler beendet den Container, bevor die neue API Anfragen
annimmt. Anschliessend muss `GET /api/v1/health` innerhalb von 120 Sekunden
HTTP 200 liefern. Sobald PostgreSQL oder Redis nicht erreichbar sind, liefert
der Endpunkt HTTP 503.

Die Migrationen sind wiederholbar. Trotzdem wird die API in Phase 0 bewusst mit
einer Replik betrieben, damit kein paralleler Migrationsstart stattfindet. Vor
horizontaler Skalierung wird in einer späteren Phase ein eigenständiger
Pre-Deploy-/Migration-Job eingeführt.

## Smoke-Test nach Deployment

```bash
curl --fail https://api.dartbase.ch/api/v1/health
curl --fail https://app.dartbase.ch/
```

Beide Befehle müssen mit HTTP 200 antworten. Schlägt einer fehl, zuerst die
Railway-Logs des jeweiligen Service prüfen (siehe «Logging und Diagnose»).

### Build-Arg-Prüfung: NEXT_PUBLIC_API_URL

Railway stellt Service-Variablen sowohl beim Build als auch zur Laufzeit
bereit; Voraussetzung ist allein, dass das Dockerfile sie im jeweiligen Stage
mit `ARG` deklariert. `Dockerfile.web` tut das bereits für
`NEXT_PUBLIC_API_URL`. Die eigentliche Falle liegt im Vorgabewert dieser
Deklaration: `ARG NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1`. Fehlt die
Variable am `web`-Service, greift beim Build stillschweigend dieser
Vorgabewert — der Build läuft grün durch, der Healthcheck wird grün, und
niemand merkt es, bis im Browser jede API-Anfrage scheitert. Deshalb wird am
gebauten Artefakt geprüft, nicht am Build-Log:

```bash
curl -s https://app.dartbase.ch/ | grep -o "https://api.dartbase.ch" | head -1
curl -s https://app.dartbase.ch/ | grep -c "localhost:3001"
```

Der erste Befehl muss `https://api.dartbase.ch` liefern, der zweite muss `0`
ergeben. Liefert der zweite Befehl mehr als `0`, steckt im Bundle der
Vorgabewert statt der echten API-URL, und im Browser scheitert jede
API-Anfrage. Abhilfe: am `web`-Service in Railway kontrollieren, ob
`NEXT_PUBLIC_API_URL` überhaupt gesetzt ist. `.railway/railway.ts`
referenziert sie über `context.shared.NEXT_PUBLIC_API_URL` — es lohnt sich
also der Blick, ob die Shared Variable im Environment `production` existiert
und exakt so heisst (ein Tippfehler dort fällt vorher nirgends auf, weil der
Typ offen ist). Danach den Service über Railway neu **deployen** (ein reiner
Neustart baut das Image nicht neu).

### Erstbenutzer (Bootstrap)

Die öffentliche Registrierung hat absichtlich keinen Bootstrap-Bypass
(ADR 0010). Der erste Zugang entsteht über einen eigenen CLI-Befehl im
laufenden API-Container. Er legt Organisation, ADMIN-Einladung und
Audit-Eintrag in einer Transaktion an und nimmt dafür eine
Postgres-Advisory-Sperre.

1. In den laufenden API-Container einloggen:

   ```bash
   railway ssh --service api
   ```

2. Im Container den Bootstrap-Befehl ausführen:

   ```bash
   node apps/api/dist/cli/bootstrap-organization.js \
     --name "Dart Ost" \
     --slug "dart-ost" \
     --email "<admin-adresse>"
   ```

   Optionale Flags mit Vorgabewert: `--timezone` (`Europe/Zurich`), `--locale`
   (`de-CH`), `--expires-in-days` (`7`).

3. Erfolg zeigt sich an Exit-Code `0` und einer Ausgabe der Form:

   ```text
   Bootstrap erfolgreich.
     Organisation: Dart Ost (dart-ost)
     Organisation-ID: <uuid>
     Eingeladen: <admin-adresse> als ADMIN
     Einladung gueltig bis: <ISO-Zeitstempel>
   ```

4. Jeder weitere Aufruf verweigert sich kontrolliert mit Exit-Code `1`
   (`Refusing to bootstrap: the database already contains …`), sobald
   irgendeine Organisation existiert. Der Befehl ist ausschliesslich für die
   einmalige Erstinstallation gedacht, nicht für weitere Organisationen.

Danach über die Weboberfläche unter `https://app.dartbase.ch`:

1. Mit exakt der eingeladenen E-Mail-Adresse registrieren und wieder anmelden.
2. Die offene Einladung annehmen.
3. Organisation «Dart Ost» und Rolle `ADMIN` prüfen.
4. Spieler anlegen, bearbeiten und archivieren.
5. Einen zweiten Benutzer einladen und dessen Einladung annehmen.
6. Prüfen, dass ein Viewer keinen Link «Turnierleitung» erhält.
7. Einen tenant-fremden Zugriff prüfen; erwartet wird HTTP 403.
8. Realtime prüfen: dieselbe Live-Ansicht auf zwei Geräten öffnen und auf
   einem Gerät eine Änderung auslösen. Sie muss auf dem anderen Gerät ohne
   Neuladen erscheinen. Bleibt sie aus, in der Browser-Konsole nach
   `connect_error` suchen: Socket.IO läuft im API-Service über eine eigene
   Verbindung und kann unabhängig vom HTTP-Healthcheck ausfallen.

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

## Backups

PITR (Point-in-Time Recovery) wird im Backups-Tab des PostgreSQL-Service in
Railway aktiviert. Railway legt dabei automatisch einen Storage-Bucket an,
setzt die `WAL_ARCHIVE_*`-Variablen auf dem Postgres-Service und deployt ihn
neu. Danach den Healthcheck erneut prüfen:

```bash
curl --fail https://api.dartbase.ch/api/v1/health
```

Das Restore-Fenster beträgt rund vier Wochen (die letzten vier vollständigen
Backups werden aufbewahrt). Ein Restore erzeugt einen **neuen** PostgreSQL-
Service nach dem Muster `<quelle>-restored-JJJJMMTT-HHMM`, mit dem
wiederhergestellten Stand; die produktive Datenbank bedient währenddessen
unverändert weiter Anfragen. Wer den wiederhergestellten Stand tatsächlich
übernehmen will, muss `DATABASE_URL` in `api` und `worker` bewusst auf den
neuen Service umstellen — das passiert nicht automatisch.

Ein Restore sollte einmal geprobt werden, bevor man sich im Ernstfall darauf
verlässt.
