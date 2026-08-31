# Railway Infrastructure as Code

Die Datei [`railway.ts`](./railway.ts) beschreibt die produktive Phase-0-Infrastruktur:

- Web-Service
- API-Service mit Readiness-Healthcheck
- Statistik-Worker
- PostgreSQL
- Redis
- persistente Daten-Volumes
- Custom Domains, Build-/Start-Kommandos und service-spezifische Variablen

Railway Config as Code (`railway.json` / `railway.toml`) wird bewusst nicht
verwendet, da es für neue Services abgekündigt ist.

Bestehende Production-Werte werden mit `preserve()` verwaltet, damit Secrets
nicht in Source oder Plan-Ausgaben gelangen. Benötigt werden insbesondere:

```text
BETTER_AUTH_SECRET
BETTER_AUTH_URL
WEB_ORIGIN
NEXT_PUBLIC_API_URL
```

Danach:

```bash
railway login
railway link
railway config plan
# Nur bei geprüftem, bewusst freigegebenem Plan:
railway config apply
```

Der kontrollierte Production-Abgleich vom 31. August 2026 meldete
`No changes.`.

## Erster Production-Owner

Der erste Owner wird über den kompilierten CLI-Befehl im Railway-API-Container
eingeladen:

```text
pnpm db:bootstrap:production
→ pnpm --filter @darts-platform/api bootstrap:production
→ node dist/operations/bootstrap-production.js
```

Der Guard verlangt rohe `NODE_ENV=production`- und
`ALLOW_PRODUCTION_BOOTSTRAP=true`-Werte und läuft vor Konfigurations- oder
Datenbankaufbau. Die Bootstrap-spezifischen Variablen sind exakt:

```text
ALLOW_PRODUCTION_BOOTSTRAP=true
BOOTSTRAP_OWNER_EMAIL
BOOTSTRAP_ORGANIZATION_NAME
BOOTSTRAP_ORGANIZATION_SLUG
BOOTSTRAP_TIMEZONE (optional, Europe/Zurich)
BOOTSTRAP_LOCALE (optional, de-CH)
```

Die Ausführung erfolgt einmalig über eine kurzlebige Railway-SSH-Identität im
kompilierten API-Image. Der Schlüssel wird direkt danach aus Railway und vom
lokalen Dateisystem entfernt und per `railway ssh keys list` verifiziert. Der
CLI-Output ist ein einzelnes sicheres JSON-Ereignis mit `created`, `pending` oder
`already-complete`; Passwörter, Datenbank-URLs und Secrets erscheinen nicht.
Die 48-Stunden-OWNER-Einladung wird nach der Registrierung und authentifizierten
Annahme des Owners aktiv. Der persistente System-Prinzipal ist nicht anmeldbar
und besitzt keine Account-, Session- oder Membership-Daten. Der normale
öffentliche Einladungsweg akzeptiert weiterhin kein `OWNER`.

Die vollständige SSH- und Smoke-Test-Prozedur steht im
[Railway-Runbook](../infrastructure/railway.md). Ein Railway-CI-Gate ist damit
nicht automatisch aktiviert: Der aktuelle IaC-Stand kann `checkSuites: false`
enthalten. Die spätere, separat zu prüfende und freizugebende Railway-
Rollout-Planung muss `checkSuites: true` für Web, API und Worker setzen und
anschließend per Readback bestätigen.

Produktionswerte und die Reihenfolge der ersten Inbetriebnahme stehen im
[Railway-Runbook](../infrastructure/railway.md).
