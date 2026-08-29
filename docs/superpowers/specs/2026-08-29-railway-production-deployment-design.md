# Design: Railway-Produktivdeployment für den ersten Live-Test

Datum: 29.08.2026
Status: Entwurf zur Freigabe

## Problem

Die Plattform ist bis Phase 6 implementiert, aber nie deployt worden. Für den
ersten Live-Test im Dartraum muss sie öffentlich erreichbar sein.

Drei Hindernisse stehen dem heute entgegen:

1. **Kein Erstzugang.** `apps/api/src/auth/auth.factory.ts` weist jede
   Registrierung ohne gültige Einladung ab. Es existiert kein Weg, die erste
   Organisation und die erste Einladung zu erzeugen. Ohne Lösung kommt nach dem
   Deployment niemand in die Anwendung.
2. **Zirkuläre Abhängigkeit im Datenmodell.**
   `organization_invitations.invited_by_user_id` ist NOT NULL mit Fremdschlüssel
   auf `users`. Eine Einladung braucht einen einladenden Benutzer, ein Benutzer
   braucht eine Einladung.
3. **Cookie-Isolation zwischen Railway-Subdomains.** `up.railway.app` steht auf
   der Public Suffix List. Zwei Railway-Subdomains gelten damit als verschiedene
   Sites. Better Auth setzt in Produktion `SameSite=Lax`, der Browser würde das
   Session-Cookie bei API-Anfragen nicht mitsenden.

Zusätzlich fehlt der Statistik-Worker in der Railway-Konfiguration, obwohl nur
er `player_statistic_aggregates` füllt.

## Entscheidungen

| Frage | Entscheidung |
| --- | --- |
| Environments | ausschliesslich `production` |
| Erstzugang | CLI-Bootstrap-Befehl im Repository |
| Statistik-Worker | wird mit deployt |
| Domains | `app.dartbase.ch` und `api.dartbase.ch` |
| Umfang | Live-Betrieb plus Betriebsabsicherung |
| `invited_by_user_id` | Migration macht die Spalte nullable |

`dartbase.ch` ist bei cyon registriert. Beide Hosts sind Subdomains und werden
über gewöhnliche CNAME-Einträge angebunden. Der Apex `dartbase.ch` bleibt
vorerst unbelegt; ein CNAME ist dort nicht zulässig, und ob cyon ALIAS, ANAME
oder eine URL-Weiterleitung anbietet, ist ungeprüft.

## Zielarchitektur

```text
app.dartbase.ch   -> web     (Dockerfile.web,    Healthcheck /)
api.dartbase.ch   -> api     (Dockerfile.api,    Healthcheck /api/v1/health, 1 Replica)
                  +-- postgres  (PITR aktiviert)
                  +-- redis
                  worker  (Dockerfile.worker, kein Ingress)
```

Beide öffentlichen Hosts liegen unter derselben registrierbaren Domain. Damit
bleibt `SameSite=Lax` gültig, `auth.factory.ts` wird nicht angefasst und
Socket.IO verbindet direkt gegen `api.dartbase.ch`.

Die API läuft bewusst mit einer Replik. `scripts/start-api.mjs` führt vor jedem
Start die Drizzle-Migrationen aus; parallele Startvorgänge würden gleichzeitig
migrieren. Horizontale Skalierung setzt einen eigenständigen Migrationsjob
voraus und ist nicht Teil dieses Vorhabens.

Realtime läuft im API-Service, nicht als eigener Dienst. Der
`@socket.io/redis-adapter` ist bereits eingebunden und trägt spätere
Skalierung.

## Änderungen am Repository

### 1. `railway` als devDependency

`.railway/railway.ts` importiert aus `railway/iac`. Das Paket ist im Monorepo
nicht installiert. Es kommt als devDependency in die Wurzel.

### 2. `.railway/railway.ts` erweitern

- fünfter Service `worker` mit `RAILWAY_DOCKERFILE_PATH=/Dockerfile.worker`,
  `DATABASE_URL` aus dem Postgres-Service, ohne Healthcheck und ohne Ingress
- `domains: ["app.dartbase.ch"]` am Web-Service
- `domains: ["api.dartbase.ch"]` am API-Service
- `worker` gehört in die Gruppe `Applications`

Die Domains werden ohne feste Portangabe deklariert. `apps/api/src/main.ts`
bindet an `PORT ?? API_PORT`, und Railway setzt `PORT` selbst. Ein
festgeschriebenes `port: 3001` würde am tatsächlichen Listen-Port vorbeirouten.
`EXPOSE 3001` im Dockerfile bleibt als Dokumentation des lokalen Standardfalls
erhalten.

Der Repository-Slug `BitWhatElse/darts-platform` stimmt mit dem Git-Remote
überein und bleibt unverändert.

### 3. Migration: `invited_by_user_id` nullable

Eine neue Drizzle-Migration entfernt die NOT-NULL-Bedingung. NULL bedeutet
fortan: vom System erzeugt, kein einladender Benutzer.

Der Umfang ist klein und wurde geprüft: Die Spalte wird ausschliesslich
geschrieben (`organizations.repository.ts` sowie zwei Testdateien) und ist in
`invitationSchema` nicht enthalten, wird also nie an Clients ausgegeben. Kein
Lesepfad und keine Oberfläche müssen angepasst werden.

### 4. Bootstrap-Befehl

Neue Datei `apps/api/src/cli/bootstrap-organization.ts`, gebaut nach
`apps/api/dist/cli/bootstrap-organization.js` und damit im API-Image vorhanden.

Aufruf mit `--name`, `--slug`, `--email`, optional `--timezone` (Standard
`Europe/Zurich`), `--locale` (Standard `de-CH`) und `--expires-in-days`
(Standard 7).

Ablauf in einer einzigen Transaktion:

1. Abbruch mit Exit-Code 1, falls bereits eine Organisation existiert.
2. Organisation anlegen.
3. Einladung anlegen: E-Mail normalisiert (getrimmt, Kleinschreibung), Rolle
   `ADMIN`, Status `PENDING`, `invited_by_user_id` NULL, Ablauf gemäss Parameter.
4. `audit_events` schreiben: `action` `organization.bootstrapped`, `entity_type`
   `organization`, frisch erzeugte `correlation_id`, `actor_user_id` NULL.

Die Rolle ist `ADMIN`, nicht `OWNER`: Der Check-Constraint
`organization_invitations_role_check` lässt `OWNER` nicht zu.

Der Befehl gibt Organisation, Slug, eingeladene E-Mail und Ablaufzeitpunkt aus.
Er ist bewusst nicht idempotent im Sinne von «erzeugt beim zweiten Aufruf
dasselbe», sondern verweigert den zweiten Aufruf. Das verhindert, dass ein
versehentlicher Zweitaufruf gegen eine laufende Produktion eine zweite
Organisation erzeugt.

Ausgeführt wird er einmalig über `railway ssh --service api` und dort:

```bash
node apps/api/dist/cli/bootstrap-organization.js \
  --name "..." --slug "..." --email "..."
```

Damit läuft er im Container über das private Netz; die Datenbank muss nicht
öffentlich exponiert werden.

### 5. ADR

`docs/adr/0011-railway-production-deployment.md` hält fest, warum eine eigene
Domain nötig ist, warum die API mit einer Replik läuft und warum der Bootstrap
als expliziter Befehl statt als Startlogik umgesetzt ist.

## Tests

- Der Bootstrap-Befehl erhält einen Integrationstest gegen Testcontainers:
  erfolgreicher Erstlauf, Verweigerung bei bestehender Organisation,
  Audit-Eintrag vorhanden, E-Mail normalisiert.
- Der bestehende Integrationstest in `auth.integration.spec.ts` wird um einen
  Fall erweitert: Registrierung gegen eine Einladung mit
  `invited_by_user_id = NULL` gelingt.
- Vor Abschluss laufen `pnpm lint`, `pnpm typecheck`, `pnpm test` und
  `pnpm build`.

## Inbetriebnahme

1. Railway-Projekt anlegen, `railway login`, `railway link`.
2. Shared Variables im Environment `production` setzen:
   `BETTER_AUTH_SECRET` (`openssl rand -base64 32`),
   `BETTER_AUTH_URL` = `https://api.dartbase.ch`,
   `WEB_ORIGIN` = `https://app.dartbase.ch`,
   `NEXT_PUBLIC_API_URL` = `https://api.dartbase.ch/api/v1`.
3. `railway config plan` prüfen, dann `railway config apply`.
4. CNAME-Einträge gemäss `railway domain status` setzen, Zertifikate abwarten.
5. **Verifizieren, dass `NEXT_PUBLIC_API_URL` im ausgelieferten Browser-Bundle
   steht.** Railway reicht Service-Variablen nicht automatisch als Build-Args
   durch. `Dockerfile.web` deklariert das `ARG` im Build-Stage korrekt, der
   tatsächliche Wert muss aber am gebauten Artefakt geprüft werden. Steht dort
   `localhost:3001`, schlägt jede API-Anfrage im Browser fehl.
6. `GET https://api.dartbase.ch/api/v1/health` muss HTTP 200 liefern.
7. Bootstrap ausführen.
8. Smoke-Test nach `infrastructure/railway.md`: registrieren, Einladung
   annehmen, Spieler anlegen, zweiten Benutzer einladen, Viewer-Sicht prüfen,
   tenant-fremden Zugriff prüfen (erwartet HTTP 403).

## Betriebsabsicherung

- PITR im Backups-Tab des Postgres-Service aktivieren.
- Einen Restore auf einen Zeitpunkt einmal durchführen und das Ergebnis prüfen.
  Ein Backup, das nie zurückgespielt wurde, ist kein Backup.
- Rollback über Redeploy eines früheren Deployments einmal auslösen, um den Weg
  im Ernstfall zu kennen.
- Railway-Logfilter für `event = http_request_completed AND statusCode >= 500`
  und `event = deployment_start_failed` vorbereiten.

## Risiken

| Risiko | Auswirkung | Abfederung |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` fehlt im Bundle | Anwendung im Browser funktionslos | eigener Verifikationsschritt vor dem Smoke-Test |
| DNS- oder Zertifikatsverzögerung | Deployment steht, Domain nicht erreichbar | Domain früh registrieren, Puffer vor dem Termin |
| Migration schlägt beim Start fehl | API startet nicht | `start-api.mjs` beendet den Container vor Annahme von Anfragen; Fehlerbild ist eindeutig |
| Bootstrap gegen falsches Environment | zweite Organisation in Produktion | Befehl verweigert den Lauf bei bestehender Organisation |
| WLAN-Ausfall im Dartraum | Scoring unterbrochen | Offline-Queue aus Phase 5 vorhanden, im Smoke-Test nicht abgedeckt |

## Bewusst nicht enthalten

- staging-Environment
- eigenständiger Migrationsjob und Skalierung über eine Replik hinaus
- E-Mail-Versand für Einladungen; Einladungen werden weiterhin mündlich oder
  manuell weitergegeben
- Generalprobe mit vollständigem Testturnier vor dem Termin
- Belegung des Apex `dartbase.ch`; wer ihn eintippt, landet vorerst nicht auf
  der Anwendung
