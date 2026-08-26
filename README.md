# Dart Tournament Platform

Eine robuste, mandantenfähige Plattform zur Organisation und Durchführung von Dartturnieren, Ligen und Turnierserien – vom Teilnehmermanagement über Live-Scoring bis zur öffentlichen Ergebnisanzeige.

> **Projektstatus:** Phase 1 abgeschlossen. Zwei Spieler können ein vollständiges 501-Double-Out-Match auf einem mobilen Scoreboard spielen – mit Bust, Checkout, Dart Count, Best of Legs, Undo, Idempotenz und Versionsschutz. Als Nächstes folgt das Tournament MVP.

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

Das System startet als modularer Monolith in einem TypeScript-Monorepo. Fachlogik liegt in infrastrukturell unabhängigen Domain- und Engine-Paketen; Web, API, Realtime und Worker greifen ausschließlich über definierte Schnittstellen darauf zu.

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

- Registrierung, Login, Logout und persistente HttpOnly-Sessions über Better Auth
- Organisationserstellung mit transaktionaler OWNER-Mitgliedschaft
- zeitlich begrenzte, an eine E-Mail-Adresse gebundene Einladungen
- serverseitige Rollen und Permissions für jeden Tenant-Zugriff
- Spieler anlegen, lesen, bearbeiten und revisionssicher archivieren
- Audit-Einträge innerhalb derselben Transaktion wie die jeweilige Mutation
- reproduzierbare Production-Images für Web und API
- Railway Infrastructure as Code für Web, API, PostgreSQL und Redis
- automatische Migrationen vor dem API-Start und dependency-sensitive Healthchecks
- strukturierte JSON-Logs mit stabilen Correlation-IDs
- eine infrastrukturfrei getestete X01-Scoring-Engine
- tenant-sichere Board- und Matchverwaltung mit granularen Permissions
- persistente Legs und Visits inklusive Restscore, Bust und Double-Out-Checkout
- idempotente Score-/Undo-Commands und Optimistic Concurrency mit HTTP 409
- transaktionale Audit- und Outbox-Einträge für jeden Score-Zustandswechsel
- ein touchfreundliches Scoreboard für Smartphone und Tablet

Weitere Details stehen in der [Zielarchitektur](./ARCHITECTURE.md) und im [initialen Datenbankschema](./DATABASE_SCHEMA.md).

## Ziel-Tech-Stack

| Bereich | Technologien |
| --- | --- |
| Sprache & Monorepo | TypeScript, pnpm, Turborepo |
| Frontend | Next.js, React, Tailwind CSS, shadcn/ui |
| Daten & Formulare | TanStack Query, React Hook Form, Zod |
| Backend | NestJS, Fastify, REST unter `/api/v1` |
| Persistenz | PostgreSQL, Drizzle ORM |
| Realtime & Jobs | WebSocket/Socket.IO, Redis, BullMQ |
| Authentifizierung | Better Auth |
| Tests | Vitest, Playwright, Testcontainers |
| Betrieb | Docker, GitHub Actions, Railway |
| Observability | OpenTelemetry, Sentry |

## Monorepo-Struktur

```text
.
├── apps/
│   ├── web/                 # Next.js Web-App und PWA
│   └── api/                 # NestJS/Fastify API
├── packages/
│   ├── domain/              # Gemeinsame Domain-Bausteine
│   ├── scoring-engine/       # Deterministische X01-Regeln und Command-Replay
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

Zyklische Abhängigkeiten sind nicht erlaubt. Controller bleiben dünn, zentrale Geschäftslogik gehört nicht in React-Komponenten, und Datenbankzugriff erfolgt ausschließlich über definierte Repositories beziehungsweise den Data Access Layer.

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
| `pnpm lint` | ESLint für das gesamte Monorepo ausführen |
| `pnpm typecheck` | TypeScript-Prüfung aller Workspaces ausführen |
| `pnpm test` | Unit- und Integrationstests ausführen |
| `pnpm test:e2e` | vollständiges 501-Match im Browser ausführen |
| `pnpm build` | alle produktiven Builds erstellen |

Die produktiven Container können zusätzlich lokal gebaut werden:

```bash
docker build -f Dockerfile.api -t darts-platform-api .
docker build -f Dockerfile.web \
  --build-arg NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1 \
  -t darts-platform-web .
```

Railway-Einrichtung, Variablen, Smoke-Tests und Rollback beschreibt das
[Deployment-Runbook](./infrastructure/railway.md).

Die Auth-, Tenant-Isolations-, PostgreSQL- und Redis-Integrationstests benötigen die laufende Compose-Infrastruktur. Sie werden zusammen mit den Unit- und API-Tests über `pnpm test` ausgeführt. Die CI stellt dafür eigene Service-Container bereit.

Für den UI-Smoke-Test muss Chromium einmalig mit seinen Systembibliotheken installiert werden:

```bash
pnpm --filter @darts-platform/web exec playwright install --with-deps chromium
pnpm test:e2e
```

Falls Port `5432` lokal bereits belegt ist, kann `POSTGRES_PORT` in der ignorierten `.env` angepasst werden; `DATABASE_URL` muss denselben Hostport verwenden.

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
| [AGENTS.md](./AGENTS.md) | Verbindliche Regeln für Entwicklung und Coding Agents |
| [ADR 0002](./docs/adr/0002-identity-tenancy.md) | Identität, Tenant-Kontext, Permissions und Audit |
| [ADR 0003](./docs/adr/0003-phase-0-production-operations.md) | Railway, Migrationen, Healthchecks, Logging und CI-Gate |
| [ADR 0004](./docs/adr/0004-phase-1-x01-match.md) | X01-Engine, Idempotenz, Versionsprüfung, Undo und Transaktionen |
| [Railway-Runbook](./infrastructure/railway.md) | Deployment, Variablen, Smoke-Test, Diagnose und Rollback |

## Lizenz

Aktuell ist keine Lizenz veröffentlicht. Bis eine Lizenzdatei ergänzt wird, bleiben alle Rechte bei den jeweiligen Rechteinhabern.
