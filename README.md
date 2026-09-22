# Dart Tournament Platform

Eine robuste, mandantenfähige Plattform zur Organisation und Durchführung von
Dartturnieren, Ligen und Turnierserien – vom Teilnehmermanagement über
Live-Scoring bis zur öffentlichen Ergebnisanzeige.

> **Projektstatus (5. September 2026):** Die Roadmap-Phasen 0 bis 6 sind
> umgesetzt, dazu der Ligabetrieb mit Team-Begegnungen und Ligatabelle nach
> [VFC-Reglement](./LIGA-REGLEMENT.md). Die
> Plattform deckt Einladung und Anmeldung, Organisationen, Spieler, Teams,
> Boards, vollständiges X01-Scoring, Turnierplanung und -leitung,
> Team-Begegnungen, öffentliche Live-Ansichten, Offline-Sicherheit sowie
> Spielerstatistiken ab. Production läuft auf Railway unter
> [dartbase.ch](https://dartbase.ch). Als Nächstes folgt der
> Multi-Tenant-SaaS-Ausbau aus Phase 7.

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
Deployment-Variablen durch einen zufälligen Wert mit mindestens 32 Zeichen
ersetzt werden, beispielsweise aus `openssl rand -base64 32`.

## Zielbild

Die Dart Tournament Platform soll Vereinen und Veranstaltern ermöglichen, ein
vollständiges Turnier oder eine ganze Ligasaison ohne Excel-Tabellen oder
Papierhilfen durchzuführen. Der Vollausbau umfasst:

- Organisationen, Mitglieder, Rollen und granulare Berechtigungen
- Spieler, Teams, Turniere, Ligen und Turnierserien
- Round Robin, Gruppen, Single/Double Elimination und Schweizer System
- X01-Scoring mit Legs, Sets, Bust, Checkout und Undo/Revert
- Boardverwaltung und nachvollziehbare automatische Zuweisung
- Live-Ansichten, TV-Modus, öffentliche Turnierseiten und QR-Codes
- PWA mit sichtbarer Offline-Queue und zuverlässiger Synchronisation
- Statistiken, Rankings, Benachrichtigungen, API und Webhooks
- optionale Autodarts- und Scolia-Anbindung über Adapter

## Funktionsumfang heute

**Identität und Mandanten**

- Registrierung ausschliesslich mit gültiger, zeitlich begrenzter Einladung,
  Login, Logout und persistente HttpOnly-Sessions über Better Auth
- Einladung und Passwort-Reset per E-Mail: Versandauftrag in derselben
  Transaktion wie die Mutation, Zustellung durch den Worker, Zustellzustand je
  Einladung sichtbar, erneutes Senden rotiert den Code
- Einladungsseite mit Vorschau auf Organisation und Rolle; Konto und
  Mitgliedschaft entstehen in einem Schritt
- Organisationserstellung mit transaktionaler OWNER-Mitgliedschaft, wahlweise
  als Selbstbedienung freigeschaltet
- serverseitige Rollen und Permissions für jeden Tenant-Zugriff
- Spieler und Teams anlegen, lesen, bearbeiten und revisionssicher archivieren
- Spielerprofilbilder in Postgres, serverseitig normalisiert
- Verknüpfung eines Mitgliedskontos mit einem Spieler der Organisation
- Audit-Einträge innerhalb derselben Transaktion wie die jeweilige Mutation

**Scoring**

- infrastrukturfrei getestete X01-Scoring-Engine
- persistente Legs und Visits inklusive Restscore, Bust und Double-Out-Checkout
- idempotente Score-/Undo-Commands und Optimistic Concurrency mit HTTP 409
- transaktionale Audit- und Outbox-Einträge für jeden Score-Zustandswechsel
- touchfreundliches Scoreboard für Smartphone und Tablet

**Wettbewerbe**

- Turnierverwaltung für Round Robin, Gruppen und K.-o. inklusive Setzung,
  Board-Zuweisung und auditierter Ergebniskorrektur
- Team-Begegnungen als Ligamodus nach [VFC-Reglement](./LIGA-REGLEMENT.md):
  Teams mit Kader, Begegnungsvorlage, beidseitige Aufstellung, 18 beziehungsweise
  19 Spiele auf mehreren Boards, automatische Wertung und Ligatabelle
- Einzelrangliste je Wettbewerb nach Reglement A1.6–A1.9
- tenant-sichere Board- und Matchverwaltung mit granularen Permissions

**Ansichten und Betrieb**

- öffentliche Live-, Board- und TV-Ansichten mit Socket.IO und HTTP-Fallback
- Anzeige-Schlüssel für die Board-Ansicht nicht freigegebener Turniere
- Staging-Environment auf Railway, das `develop` folgt
- installierbare PWA mit persistenter Offline-Queue und Board-Controller-Lock
- Spielerprofile mit Matchverlauf, Average, Checkout-Quote, Head-to-Head und
  Rankingverlauf
- reproduzierbare Production-Images, Railway Infrastructure as Code,
  automatische Migrationen vor dem API-Start, dependency-sensitive Healthchecks
  und strukturierte JSON-Logs mit stabilen Correlation-IDs

## Architektur

Das System startet als modularer Monolith in einem TypeScript-Monorepo.
Fachlogik liegt in infrastrukturell unabhängigen Domain- und Engine-Paketen;
Web, API, Realtime und Worker greifen ausschliesslich über definierte
Schnittstellen darauf zu.

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
- **Deterministische Engines:** Scoring-, Turnier-, Liga- und Scheduling-Logik bleiben frei von Framework- und Infrastrukturabhängigkeiten.
- **Datenintegrität:** Kritische Abläufe verwenden Transaktionen, Datenbank-Constraints, Audit-Einträge und das Outbox-Muster.
- **Idempotenz:** Score- und Match-Commands besitzen eine `commandId` und dürfen bei Wiederholung keine Duplikate erzeugen.
- **Optimistic Concurrency:** Aktive Matches und Legs werden über eine Version vor konkurrierenden Änderungen geschützt.
- **Realtime nach Commit:** WebSocket-Events werden erst nach erfolgreicher Persistierung veröffentlicht.

Weitere Details stehen in der [Zielarchitektur](./ARCHITECTURE.md) und im
[Datenbankschema](./DATABASE_SCHEMA.md).

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
│   ├── web/                  # Next.js Web-App und PWA
│   ├── api/                  # NestJS/Fastify API und Realtime Gateway
│   └── worker/               # asynchrone Statistik- und Mailverarbeitung
├── packages/
│   ├── domain/               # Gemeinsame Domain-Bausteine
│   ├── scoring-engine/       # Deterministische X01-Regeln und Command-Replay
│   ├── tournament-engine/    # Turnierformate, Setzung und Matchgraphen
│   ├── league-engine/        # Team-Begegnungen: Vorlage, Aufstellung, Wertung
│   ├── scheduling-engine/    # nachvollziehbare Matchbereitschaft
│   ├── statistics/           # reproduzierbare Statistikberechnung
│   ├── notifications/        # Mailvorlagen und Versandadapter
│   ├── database/             # Drizzle-Schema, Migrationen und DB-Client
│   ├── ui/                   # Gemeinsame UI-Komponenten
│   ├── schemas/              # Geteilte Zod-Schemas
│   └── config/               # Geteilte Environment-Validierung
├── .railway/                 # Railway Infrastructure as Code
├── infrastructure/           # Deployment- und Betriebs-Runbooks
├── docs/adr/                 # Architecture Decision Records
├── Dockerfile.api            # Production-Image der API
├── Dockerfile.web            # Production-Image des Web-Frontends
└── Dockerfile.worker         # Production-Image des Workers
```

Zyklische Abhängigkeiten sind nicht erlaubt. Controller bleiben dünn, zentrale
Geschäftslogik gehört nicht in React-Komponenten, und Datenbankzugriff erfolgt
ausschliesslich über definierte Repositories beziehungsweise den Data Access
Layer.

## Roadmap

Die Umsetzung erfolgt inkrementell. Umgesetzt sind Foundation (0), Playable
Match MVP (1), Tournament MVP (2), Realtime & Public Live (3), Advanced
Tournament Engine (4), PWA & Reliability (5) und Statistics & Player Platform
(6). Danach folgen Multi-Tenant SaaS (7), Autoscoring (8), League Platform (9),
Turnierserien (10), Benachrichtigungen (11), Public API (12), Webhooks (13) und
Enterprise/Scale (14).

Alle Phasen und Exit-Kriterien sind in der [Roadmap](./ROADMAP.md) beschrieben.

## Lokale Entwicklung

`pnpm dev` startet Web und API parallel über Turborepo. PostgreSQL und Redis
laufen lokal in Docker; die Node.js-Anwendungen selbst nicht.

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

Die Auth-, Tenant-Isolations-, PostgreSQL- und Redis-Integrationstests benötigen
die laufende Compose-Infrastruktur und werden über `pnpm test` mit ausgeführt;
die CI stellt dafür eigene Service-Container bereit. Für den UI-Smoke-Test muss
Chromium einmalig mit seinen Systembibliotheken installiert werden:

```bash
pnpm --filter @darts-platform/web exec playwright install --with-deps chromium
pnpm test:e2e
```

Die produktiven Container können zusätzlich lokal gebaut werden:

```bash
docker build -f Dockerfile.api -t darts-platform-api .
docker build -f Dockerfile.web \
  --build-arg NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1 \
  -t darts-platform-web .
```

Falls Port `5432` lokal bereits belegt ist, kann `POSTGRES_PORT` in der
ignorierten `.env` angepasst werden; `DATABASE_URL` muss denselben Hostport
verwenden.

### Lokale Demo-Daten

Nach `pnpm infra:up` und `pnpm db:migrate` ergänzt `pnpm db:seed:dev` eine
Demo-Organisation mit 32 fiktiven Spielern, acht Boards, zwei abgeschlossenen
Turnieren und einem laufenden 32er-Turnier. Der Befehl ist idempotent und
löscht, ersetzt oder benennt keine bestehenden lokalen Daten um; ein erneuter
Lauf ergänzt das aktuelle DartBase-Demo-Profil daneben.

```text
E-Mail: demo@dartbase.local
Passwort: DartBaseDemo2026!
```

Der Seed verweigert Production und standardmässig jede nicht-lokale
PostgreSQL-Adresse. Für bewusst isolierte Remote-Entwicklungsdatenbanken ist
zusätzlich `ALLOW_REMOTE_DEV_SEED=true` erforderlich.

## Betrieb

Das Railway-Projekt für Production heisst `dartbase` und betreibt Web, API,
Worker, PostgreSQL und Redis. Cyon bleibt Registrar für `dartbase.ch`, die
autoritative DNS-Zone liegt bei Cloudflare: Apex und Wildcard zeigen auf den
Web-Service, `api.dartbase.ch` über einen expliziten CNAME auf den API-Service.
Alle Zertifikate sind gültig, die öffentlichen Web- und API-Smoke-Tests
bestehen.

Railway-Einrichtung, Domain- und DNS-Zuständigkeiten, Variablen, Smoke-Tests,
Diagnose und Rollback beschreibt das
[Deployment-Runbook](./infrastructure/railway.md).

### Erster Production-Owner

Die leere Production-Datenbank wird über den einmaligen, kompilierten
CLI-Befehl `pnpm db:bootstrap:production` vorbereitet. Er läuft ausschliesslich
im Railway-API-Container und verlangt `NODE_ENV=production` sowie
`ALLOW_PRODUCTION_BOOTSTRAP=true`, bevor Konfiguration oder Datenbankverbindung
aufgebaut werden. Es gibt keinen öffentlichen Endpoint, keinen Startup-Hook,
kein Default- oder temporäres Passwort und keinen manuellen SQL-Fallback. Der
Befehl legt eine Organisation mit 48-Stunden-OWNER-Einladung an, verwendet eine
noch gültige Einladung wieder oder bestätigt eine bereits akzeptierte
OWNER-Membership ohne Schreibvorgang.

Die benötigten Variablen, der maschinenlesbare Node-Entry-Point, die einmalige
Railway-SSH-Ausführung und der authentifizierte Smoke-Test stehen im
[ADR 0012](./docs/adr/0012-production-owner-bootstrap.md) und im
[Railway-Runbook](./infrastructure/railway.md).

## Qualitätsanforderungen

Vor Abschluss einer Änderung müssen mindestens diese Prüfungen erfolgreich sein:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Bei relevanten UI-Änderungen kommt `pnpm test:e2e` hinzu.

Besonders kritisch sind Scoring-Korrektheit, Turnierintegrität, Tenant-Isolation
und Autorisierung. Änderungen an diesen Bereichen benötigen passende Unit-,
Integrations- oder E2E-Tests.

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
| [LIGA-REGLEMENT.md](./LIGA-REGLEMENT.md) | VFC-Liga-Reglement im E-Dart als fachliche Grundlage der Team-Begegnungen |
| [DRA-REGELWERK.md](./DRA-REGELWERK.md) | Deutsche Arbeitsübersetzung des DRA Rule Book 2026; verbindlich ist die englische Fassung |
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
| [ADR 0013](./docs/adr/0013-oeffentliche-turnier-adressen.md) | Öffentliche Turnier-Adressen, Anzeige-Schlüssel und Kanal-Autorisierung |
| [ADR 0014](./docs/adr/0014-csp-nonce-static-rendering.md) | CSP-Nonce zwingt fünf Routen auf dynamisches Rendering |
| [ADR 0015](./docs/adr/0015-spieler-konto-verknuepfung.md) | Konto und Spieler bleiben getrennt und werden optional verknüpft |
| [ADR 0016](./docs/adr/0016-profilbilder-in-postgres.md) | Profilbilder liegen als Bytes in Postgres, nicht in einem Bucket |
| [ADR 0017](./docs/adr/0017-ausgehende-emails.md) | Ausgehende E-Mails über eine Versandtabelle und den Worker |
| [Team-Begegnung als Ligamodus](./docs/superpowers/specs/2026-09-02-team-encounter-league-design.md) | Fachliche Umsetzung des VFC-Reglements in Vorlage, Aufstellung und Wertung |
| [Bedienungsanleitung](./apps/web/public/bedienungsanleitung.html) | Öffentlich zugängliche deutsche Anleitung für Administration, Turnierleitung und Scoring |
| [Railway-Runbook](./infrastructure/railway.md) | Deployment, Variablen, Smoke-Test, Diagnose und Rollback |
| [Neon-Preview-Runbook](./infrastructure/neon-preview.md) | Isolierte Development- und Preview-Datenbanken mit Neon |

## Lizenz

Aktuell ist keine Lizenz veröffentlicht. Bis eine Lizenzdatei ergänzt wird,
bleiben alle Rechte bei den jeweiligen Rechteinhabern.
