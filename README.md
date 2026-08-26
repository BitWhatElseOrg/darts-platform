# Dart Tournament Platform

Eine robuste, mandantenfähige Plattform zur Organisation und Durchführung von Dartturnieren, Ligen und Turnierserien – vom Teilnehmermanagement über Live-Scoring bis zur öffentlichen Ergebnisanzeige.

> **Projektstatus:** Architektur- und Planungsphase. Die Zielarchitektur, das initiale Datenmodell und die Implementierungs-Roadmap sind definiert; das Anwendungs-Monorepo wird in Phase 0 aufgebaut.

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

Weitere Details stehen in der [Zielarchitektur](./ARCHITECTURE.md) und im [initialen Datenbankschema](./DATABASE_SCHEMA.md).

## Tech Stack

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

## Geplante Monorepo-Struktur

```text
.
├── apps/
│   ├── web/                 # Next.js Web-App und PWA
│   ├── api/                 # NestJS/Fastify API
│   ├── realtime/            # WebSocket Gateway
│   └── worker/              # Hintergrundjobs
├── packages/
│   ├── domain/              # Gemeinsame Domain-Bausteine
│   ├── database/            # Drizzle-Schemas und Repositories
│   ├── scoring-engine/      # Deterministische Dartregeln
│   ├── tournament-engine/   # Formate, Seeding und Advancement
│   ├── scheduling-engine/   # Match- und Boardplanung
│   ├── ranking-engine/      # Ranglistenberechnung
│   ├── statistics/          # Statistiken und Aggregate
│   ├── integrations/        # Ports und externe Adapter
│   ├── ui/                  # Gemeinsame UI-Komponenten
│   ├── schemas/             # Geteilte Zod-Schemas
│   └── config/              # Gemeinsame Tool-Konfiguration
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

Das ausführbare Monorepo wird in **Phase 0** initialisiert. Danach gilt folgender Standard-Workflow:

### Voraussetzungen

- Node.js (aktive LTS-Version)
- pnpm
- Docker mit Docker Compose

### Geplanter Start

```bash
pnpm install
docker compose up -d
pnpm dev
```

Konkrete Umgebungsvariablen, Ports und Datenbankbefehle werden mit dem Phase-0-Scaffold ergänzt. Secrets dürfen niemals ins Repository eingecheckt werden.

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

## Lizenz

Aktuell ist keine Lizenz veröffentlicht. Bis eine Lizenzdatei ergänzt wird, bleiben alle Rechte bei den jeweiligen Rechteinhabern.
