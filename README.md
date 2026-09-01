# Dart Tournament Platform

Eine robuste, mandantenfähige Plattform zur Organisation und Durchführung von Dartturnieren, Ligen und Turnierserien – vom Teilnehmermanagement über Live-Scoring bis zur öffentlichen Ergebnisanzeige.

> **Projektstatus (31. August 2026):** Die Phasen 0 bis 6 sind umgesetzt. Die
> Plattform deckt Einladung und Anmeldung, Organisationen, Spieler, Boards,
> vollständiges X01-Scoring, Turnierplanung und -leitung, öffentliche
> Live-Ansichten, Offline-Sicherheit sowie Spielerstatistiken ab. Als Nächstes
> folgt der Multi-Tenant-SaaS-Ausbau aus Phase 7.

Das Railway-Projekt für Production heisst `dartbase`. Cyon bleibt Registrar für
`dartbase.ch`; die autoritative DNS-Zone ist bei Cloudflare aktiv. Apex und
Wildcard zeigen auf den Railway-Web-Service. Die Zertifikate für Apex und
Wildcard sind gültig. Web, API, Worker, PostgreSQL und Redis sind erfolgreich
deployt. `api.dartbase.ch` zeigt über einen expliziten Cloudflare-CNAME auf den
API-Service und besitzt ein gültiges Railway-Zertifikat. Die öffentlichen Web-
und API-Smoke-Tests bestehen.

## Quick Start

Voraussetzungen: Node.js 24, pnpm, Docker Engine und Docker Compose unter WSL2.

```bash
pnpm install
cp .env.example .env
pnpm infra:up
pnpm db:migrate
pnpm dev
```

Danach sind erreichbar:

- Web: [http://localhost:3000](http://localhost:3000)
- API Health: [http://localhost:3001/api/v1/health](http://localhost:3001/api/v1/health)

Vor einem Deployment muss `BETTER_AUTH_SECRET` in `.env` beziehungsweise in den
Deployment-Variablen durch einen zufälligen Wert mit mindestens 32 Zeichen ersetzt
werden, beispielsweise aus `openssl rand -base64 32`.

## Zielbild

Die Dart Tournament Platform soll Vereinen und Veranstaltern ermöglichen, ein vollständiges Turnier ohne Excel-Tabellen oder Papierhilfen durchzuführen. Der erste öffentlich nutzbare Stand umfasst Gruppenphase und K.-o.-Runde auf mehreren Boards sowie live aktualisierte Ergebnisse für Turnierleitung, Spieler und Zuschauer.

Geplante Kernfunktionen:

- Organisationen, Mitglieder, Rollen und granulare Berechtigungen
- Spieler, Teams, Turniere, Ligen und Turnierserien
- Round Robin, Gruppen, Single/Double Elimination und Schweizer System
- X01-Scoring mit Legs, Sets, Bust, Checkout und Undo/Revert
- Boardverwaltung und nachvollziehbare automatische Zuweisung
- Live-Ansichten, TV-Modus, öffentliche Turnierseiten und QR-Codes
- PWA mit sichtbarer Offline-Queue und zuverlässiger Synchronisation
- Statistiken, Rankings, Benachrichtigungen, API und Webhooks
- optionale Autodarts- und Scolia-Anbindung über Adapter

## Architektur

Das System startet als modularer Monolith in einem TypeScript-Monorepo. Fachlogik liegt in infrastrukturell unabhängigen Domain- und Engine-Paketen; Web, API, Realtime und Worker greifen ausschliesslich über definierte Schnittstellen darauf zu.

```text
Browser / PWA ───────┐
Board-Gerät ─────────┼──> Next.js Web ──> NestJS API ──> PostgreSQL
TV / Beamer ─────────┘          │              │
                                │              ├──> Redis / BullMQ
                                └──> Realtime <┘

Autodarts / Scolia ──> Integration Adapter ──> Domain Command
```

Zentrale Architekturprinzipien:

- **Multi-Tenancy ab Tag 1:** Jede tenant-bezogene Abfrage wird serverseitig über `organization_id` eingeschränkt.
- **Serverseitige Autorisierung:** Jede geschäftliche Mutation benötigt eine explizite Permission.
- **Deterministische Engines:** Scoring-, Turnier- und Scheduling-Logik bleiben frei von Framework- und Infrastrukturabhängigkeiten.
- **Datenintegrität:** Kritische Abläufe verwenden Transaktionen, Datenbank-Constraints, Audit-Einträge und das Outbox-Muster.
- **Idempotenz:** Score- und Match-Commands besitzen eine `commandId` und dürfen bei Wiederholung keine Duplikate erzeugen.
- **Optimistic Concurrency:** Aktive Matches und Legs werden über eine Version vor konkurrierenden Änderungen geschützt.
- **Realtime nach Commit:** WebSocket-Events werden erst nach erfolgreicher Persistierung veröffentlicht.

Der aktuelle Stand bietet zusätzlich zur Foundation:

- Registrierung ausschliesslich mit gültiger Einladung, Login, Logout und
  persistente HttpOnly-Sessions über Better Auth
- Organisationserstellung mit transaktionaler OWNER-Mitgliedschaft
- zeitlich begrenzte Einladungen mit kryptografischem Einladungscode; der Code
  wird bei Registrierung und Annahme serverseitig geprüft
- serverseitige Rollen und Permissions für jeden Tenant-Zugriff
- Spieler anlegen, lesen, bearbeiten und revisionssicher archivieren
- Audit-Einträge innerhalb derselben Transaktion wie die jeweilige Mutation
- reproduzierbare Production-Images für Web, API und Worker
- Railway Infrastructure as Code für Web, API, Worker, PostgreSQL und Redis
- ein vorbereitetes Production-Projekt `dartbase` mit Web-, API- und Worker-Service
- Cloudflare als autoritatives DNS für `dartbase.ch`, Cyon als Registrar sowie
  Apex- und Wildcard-Domain am Railway-Web-Service
- automatische Migrationen vor dem API-Start und dependency-sensitive Healthchecks
- strukturierte JSON-Logs mit stabilen Correlation-IDs
- eine infrastrukturfrei getestete X01-Scoring-Engine
- tenant-sichere Board- und Matchverwaltung mit granularen Permissions
- persistente Legs und Visits inklusive Restscore, Bust und Double-Out-Checkout
- idempotente Score-/Undo-Commands und Optimistic Concurrency mit HTTP 409
- transaktionale Audit- und Outbox-Einträge für jeden Score-Zustandswechsel
- ein touchfreundliches Scoreboard für Smartphone und Tablet
- vollständige Turnierverwaltung für Round Robin, Gruppen und K.-o. inklusive
  Setzung, Board-Zuweisung und auditierter Ergebniskorrektur
- öffentliche Live-, Board- und TV-Ansichten mit Socket.IO und HTTP-Fallback
- installierbare PWA mit persistenter Offline-Queue und Board-Controller-Lock
- Spielerprofile mit Matchverlauf, Average, Checkout-Quote, Head-to-Head und
  Rankingverlauf

Weitere Details stehen in der [Zielarchitektur](./ARCHITECTURE.md) und im [Datenbankschema](./DATABASE_SCHEMA.md).

## Ziel-Tech-Stack

| Bereich | Technologien |
| --- | --- |
| Sprache & Monorepo | TypeScript, pnpm, Turborepo |
| Frontend | Next.js, React, Tailwind CSS, shadcn/ui |
| Daten & Formulare | TanStack Query, React Hook Form, Zod |
| Backend | NestJS, Fastify, REST unter `/api/v1` |
| Persistenz | PostgreSQL, Drizzle ORM; Railway in Production/Staging, Neon nur für Development/Preview |
| Realtime & Jobs | WebSocket/Socket.IO, Redis, BullMQ |
| Authentifizierung | Better Auth |
| Tests | Vitest, Playwright, Testcontainers |
| Betrieb | Docker, GitHub Actions, Railway; Cloudflare DNS; Cyon als Registrar |
| Observability | OpenTelemetry, Sentry |

## Monorepo-Struktur

```text
.
├── apps/
│   ├── web/                 # Next.js Web-App und PWA
│   ├── api/                 # NestJS/Fastify API und Realtime Gateway
│   └── worker/              # asynchrone Statistikverarbeitung
├── packages/
│   ├── domain/              # Gemeinsame Domain-Bausteine
│   ├── scoring-engine/       # Deterministische X01-Regeln und Command-Replay
│   ├── tournament-engine/    # Turnierformate, Setzung und Matchgraphen
│   ├── scheduling-engine/    # nachvollziehbare Matchbereitschaft
│   ├── statistics/           # reproduzierbare Statistikberechnung
│   ├── database/            # Drizzle-Schema, Migrationen und DB-Client
│   ├── ui/                  # Gemeinsame UI-Komponenten
│   ├── schemas/             # Geteilte Zod-Schemas
│   └── config/              # Geteilte Environment-Validierung
├── .railway/                # Railway Infrastructure as Code
├── infrastructure/          # Deployment- und Betriebs-Runbooks
├── Dockerfile.api           # Production-Image der API
├── Dockerfile.web           # Production-Image des Web-Frontends
├── ARCHITECTURE.md
├── DATABASE_SCHEMA.md
└── ROADMAP.md
```

Zyklische Abhängigkeiten sind nicht erlaubt. Controller bleiben dünn, zentrale Geschäftslogik gehört nicht in React-Komponenten, und Datenbankzugriff erfolgt ausschliesslich über definierte Repositories beziehungsweise den Data Access Layer.

## Roadmap

Die Umsetzung erfolgt inkrementell:

1. **Foundation:** Monorepo, Auth, Organisationen, Berechtigungen, Spieler, Datenbank und CI/CD
2. **Playable Match MVP:** vollständiges 501-Double-Out-Match mit Undo, Idempotenz und Versionsprüfung
3. **Tournament MVP:** Gruppen, Round Robin, K.-o.-Phase, Seeding, Boards und Audit-Log
4. **Realtime & Public Live:** Live-Matches, Ranglisten, Brackets, TV-Modus und öffentliche Seiten
5. **Reliability & Expansion:** PWA/Offline, Statistiken, weitere Formate, SaaS und Integrationen

Alle Phasen und Exit-Kriterien sind in der [Roadmap](./ROADMAP.md) beschrieben.

## Lokale Entwicklung

`pnpm dev` startet Web und API parallel über Turborepo. PostgreSQL und Redis laufen lokal in Docker; die Node.js-Anwendungen selbst nicht.

| Befehl | Zweck |
| --- | --- |
| `pnpm dev` | Web und API im Watch-Modus starten |
| `pnpm infra:up` | PostgreSQL und Redis starten |
| `pnpm infra:down` | lokale Infrastruktur stoppen |
| `pnpm infra:logs` | Infrastruktur-Logs verfolgen |
| `pnpm db:generate` | Drizzle-Migration aus Schemaänderungen erzeugen |
| `pnpm db:migrate` | versionierte Migrationen anwenden |
| `pnpm db:seed:dev` | lokale Demo-Daten idempotent ergänzen |
| `pnpm lint` | ESLint für das gesamte Monorepo ausführen |
| `pnpm typecheck` | TypeScript-Prüfung aller Workspaces ausführen |
| `pnpm test` | Unit- und Integrationstests ausführen |
| `pnpm test:e2e` | Anmeldung, Rollen, Turnier- und Scoring-Abläufe im Browser prüfen |
| `pnpm build` | alle produktiven Builds erstellen |

Die produktiven Container können zusätzlich lokal gebaut werden:

```bash
docker build -f Dockerfile.api -t darts-platform-api .
docker build -f Dockerfile.web \
  --build-arg NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1 \
  -t darts-platform-web .
```

Railway-Einrichtung, die Domain- und DNS-Zuständigkeiten, Variablen, Smoke-Tests
und Rollback beschreibt das [Deployment-Runbook](./infrastructure/railway.md).

### Erster Production-Owner

Die leere Production-Datenbank wird über den einmaligen, kompilierten
CLI-Befehl `pnpm db:bootstrap:production` vorbereitet. Er delegiert an
`pnpm --filter @darts-platform/api bootstrap:production` und läuft ausschließlich
im Railway-API-Container. Der rohe Guard verlangt `NODE_ENV=production` und
`ALLOW_PRODUCTION_BOOTSTRAP=true`, bevor Konfiguration oder Datenbankverbindung
aufgebaut werden. Es gibt keinen öffentlichen Endpoint, keinen Startup-Hook,
kein Default- oder temporäres Passwort und keinen manuellen SQL-Fallback.

Die Bootstrap-spezifischen Variablen sind exakt:

```text
ALLOW_PRODUCTION_BOOTSTRAP=true
BOOTSTRAP_OWNER_EMAIL
BOOTSTRAP_INVITATION_CLAIM_TOKEN (43 Zeichen, mindestens 256 Bit Zufall)
BOOTSTRAP_ORGANIZATION_NAME
BOOTSTRAP_ORGANIZATION_SLUG
BOOTSTRAP_TIMEZONE (optional, Europe/Zurich)
BOOTSTRAP_LOCALE (optional, de-CH)
```

Der direkte kompilierte Node-Entry-Point
`node /app/apps/api/dist/operations/bootstrap-production.js` gibt genau eine
sichere JSON-Zeile mit Status, Organisation, normalisierter Owner-E-Mail und
Ablaufzeit aus. Der Root- beziehungsweise API-pnpm-Wrapper bleibt der normale
Bedienbefehl, kann aber zusätzlich sicheren Lifecycle- oder Bannertext ausgeben.
Der direkte Entry-Point ist für maschinenlesbares Readback zu verwenden.
`created` legt die erwartete
Organisation und 48-Stunden-OWNER-Einladung an, `pending` verwendet eine noch
gültige exakte Einladung wieder, und `already-complete` bestätigt eine bereits
akzeptierte OWNER-Membership ohne Schreibvorgang. Der persistente
System-Prinzipal dient nur als nicht anmeldbarer Einladungs- und Audit-Actor;
reguläre API-Einladungen können weiterhin keine OWNER-Rolle erzeugen. Die
einmalige Railway-SSH-Ausführung und der authentifizierte Smoke-Test sind im
[ADR 0012](./docs/adr/0012-production-owner-bootstrap.md) und im
[Railway-Runbook](./infrastructure/railway.md) beschrieben.

Die Auth-, Tenant-Isolations-, PostgreSQL- und Redis-Integrationstests benötigen die laufende Compose-Infrastruktur. Sie werden zusammen mit den Unit- und API-Tests über `pnpm test` ausgeführt. Die CI stellt dafür eigene Service-Container bereit.

Für den UI-Smoke-Test muss Chromium einmalig mit seinen Systembibliotheken installiert werden:

```bash
pnpm --filter @darts-platform/web exec playwright install --with-deps chromium
pnpm test:e2e
```

Falls Port `5432` lokal bereits belegt ist, kann `POSTGRES_PORT` in der ignorierten `.env` angepasst werden; `DATABASE_URL` muss denselben Hostport verwenden.

### Lokale Demo-Daten

Nach `pnpm infra:up` und `pnpm db:migrate` ergänzt `pnpm db:seed:dev` eine Demo-Organisation mit 32 fiktiven Spielern, acht Boards, zwei abgeschlossenen Turnieren und einem laufenden 32er-Turnier. Der Befehl ist idempotent und löscht oder ersetzt keine bestehenden lokalen Daten.

```text
E-Mail: demo@dartbase.local
Passwort: DartBaseDemo2026!
```

Bereits vorhandene lokale Demo-Daten mit früheren Kennungen werden nicht
umbenannt oder gelöscht. Ein erneuter Seed-Lauf ergänzt das aktuelle
DartBase-Demo-Profil daneben.

Der Seed verweigert Production und standardmässig jede nicht-lokale PostgreSQL-Adresse. Für bewusst isolierte Remote-Entwicklungsdatenbanken ist zusätzlich `ALLOW_REMOTE_DEV_SEED=true` erforderlich.

## Qualitätsanforderungen

Vor Abschluss einer Änderung müssen mindestens diese Prüfungen erfolgreich sein:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Bei relevanten UI-Änderungen kommt hinzu:

```bash
pnpm test:e2e
```

Besonders kritisch sind Scoring-Korrektheit, Turnierintegrität, Tenant-Isolation und Autorisierung. Änderungen an diesen Bereichen benötigen passende Unit-, Integrations- oder E2E-Tests.

## Pull-Request-Review mit PR-Agent

Der Workflow [`.github/workflows/pr-agent.yml`](./.github/workflows/pr-agent.yml)
startet für interne Pull Requests automatisch ein Review. Er läuft im
eingeschränkten Modus mit Schreibrechten nur für Issues und Pull Requests; das
verwendete PR-Agent-Image ist auf einen unveränderlichen Digest gepinnt.

Vor der ersten Ausführung muss im GitHub-Repository das Actions-Secret
`OPENAI_KEY` hinterlegt werden. Automatische Reviews aus Forks sind deaktiviert.
Mitglieder, Owner und Collaborators können auf einem Pull Request zusätzlich
PR-Agent-Kommandos wie `/review`, `/describe` oder `/improve` kommentieren. Die
projektspezifischen Review-Regeln stehen in [`.pr_agent.toml`](./.pr_agent.toml).

## Mitwirken

1. Ein Issue oder eine klar abgegrenzte Aufgabe wählen.
2. Einen Branch mit Präfix `feature/`, `fix/`, `refactor/` oder `chore/` erstellen.
3. Kleine, verständliche Änderungen mit Tests umsetzen.
4. Die Qualitätsprüfungen lokal ausführen.
5. Conventional Commits verwenden, zum Beispiel `feat: add x01 scoring engine`.
6. Einen Pull Request mit Problem, Lösung, Architektur-, Datenbank- und Security-Auswirkungen sowie den ausgeführten Tests eröffnen.

Verbindliche Architektur- und Arbeitsregeln stehen in [AGENTS.md](./AGENTS.md).

## Dokumentation

| Dokument | Inhalt |
| --- | --- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Zielarchitektur, Domänen, Datenflüsse und Betriebsmodell |
| [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) | Logisches PostgreSQL-Zielschema und Integritätsregeln |
| [ROADMAP.md](./ROADMAP.md) | Implementierungsphasen, Scope und Exit-Kriterien |
| [PRODUCT.md](./PRODUCT.md) | Produktnutzen, Nutzergruppen und aktueller Funktionsumfang |
| [DESIGN.md](./DESIGN.md) | Marken-, Farb-, Typografie- und Komponentenregeln |
| [AGENTS.md](./AGENTS.md) | Verbindliche Regeln für Entwicklung und Coding Agents |
| [ADR 0001](./docs/adr/0001-foundation-architecture.md) | Foundation als modularer Monolith |
| [ADR 0002](./docs/adr/0002-identity-tenancy.md) | Identität, Tenant-Kontext, Permissions und Audit |
| [ADR 0003](./docs/adr/0003-phase-0-production-operations.md) | Railway, Migrationen, Healthchecks, Logging und CI-Gate |
| [ADR 0004](./docs/adr/0004-phase-1-x01-match.md) | X01-Engine, Idempotenz, Versionsprüfung, Undo und Transaktionen |
| [ADR 0005](./docs/adr/0005-phase-2-tournament-command-model.md) | Turnier-Engine, persistenter Matchgraph und Commands |
| [ADR 0006](./docs/adr/0006-phase-3-realtime-public-live.md) | Realtime und öffentliche Live-Ansichten |
| [ADR 0007](./docs/adr/0007-phase-4-advanced-formats.md) | Erweiterte Turnierformate und Stage-Komposition |
| [ADR 0008](./docs/adr/0008-phase-5-offline-reliability.md) | Offline-Queue und Board-Controller-Lock |
| [ADR 0009](./docs/adr/0009-phase-6-statistics.md) | Reproduzierbare Spielerstatistiken |
| [ADR 0010](./docs/adr/0010-invite-only-registration.md) | Einladungsgebundene Registrierung und rollenbasierter Verwaltungszugang |
| [ADR 0011](./docs/adr/0011-preview-database-strategy.md) | Neon für Development/Preview und Railway PostgreSQL für Production/Staging |
| [ADR 0012](./docs/adr/0012-production-owner-bootstrap.md) | Einmaliger Production-Owner-Bootstrap über eine interne OWNER-Einladung |
| [Bedienungsanleitung](./apps/web/public/bedienungsanleitung.html) | Öffentlich zugängliche deutsche Anleitung für Administration, Turnierleitung und Scoring |
| [Railway-Runbook](./infrastructure/railway.md) | Deployment, Variablen, Smoke-Test, Diagnose und Rollback |
| [Neon-Preview-Runbook](./infrastructure/neon-preview.md) | Isolierte Development- und Preview-Datenbanken mit Neon |

## Lizenz

Aktuell ist keine Lizenz veröffentlicht. Bis eine Lizenzdatei ergänzt wird, bleiben alle Rechte bei den jeweiligen Rechteinhabern.
