# AGENTS.md

# Codex / Coding Agent Instructions – Dart Tournament Platform

Diese Datei enthält verbindliche Regeln für alle Coding Agents, die an diesem Repository arbeiten.

---

## 1. Primäres Ziel

Entwickle eine robuste, testbare und langfristig erweiterbare Dart-Turnierplattform.

Prioritäten:

1. Korrektheit
2. Datenintegrität
3. Security
4. Testbarkeit
5. Wartbarkeit
6. gute UX
7. Performance
8. schnelle Implementierung

Schnelle Lösungen dürfen Architektur- oder Datenintegritätsregeln nicht umgehen.

---

## 2. Tech Stack

Verwende standardmäßig:

```text
TypeScript
pnpm
Turborepo
Next.js
React
Tailwind CSS
shadcn/ui
TanStack Query
React Hook Form
Zod
NestJS
Fastify
PostgreSQL
Drizzle ORM
Redis
BullMQ
Better Auth
Vitest
Playwright
Testcontainers
Docker
GitHub Actions
Railway
Cloudflare DNS (authoritativ)
Cyon (Registrar für dartbase.ch)
Neon (nur Development/Preview)
PR-Agent
```

Neue Frameworks oder größere Dependencies nur hinzufügen, wenn ein klarer technischer Nutzen besteht.

---

## 3. Monorepo-Grenzen

```text
apps/web
apps/api
apps/realtime
apps/worker

packages/domain
packages/database
packages/scoring-engine
packages/tournament-engine
packages/league-engine
packages/scheduling-engine
packages/ranking-engine
packages/statistics
packages/integrations
packages/ui
packages/schemas
packages/config
```

Keine zyklischen Dependencies.

---

## 4. Architekturregeln

### Muss

- Business-Logik in Domain-/Engine-Paketen.
- Controller bleiben dünn.
- UI enthält keine zentrale Turnier- oder Scoring-Logik.
- Datenbankzugriff erfolgt über definierte Repositories / Data Access Layer.
- Jede geschäftliche Mutation wird autorisiert.
- Jede tenant-bezogene Query ist nach `organization_id` eingeschränkt.
- API-Eingaben werden serverseitig validiert.
- Kritische Mutationen sind transaktional.
- Realtime-Events erst nach erfolgreichem Commit.
- Score Commands sind idempotent.
- Match-/Leg-Updates nutzen Versionsprüfung.
- Kritische Benutzeraktionen werden auditiert.
- Neue Features erhalten Tests.
- Komplexe Architekturentscheidungen erhalten ADRs.

### Verboten

- `any`, außer technisch zwingend und dokumentiert.
- Secrets im Sourcecode.
- direkte DB-Verbindung im Browser.
- implizite Tenant-Auswahl aus Client-Daten ohne Serverprüfung.
- harte Rollenprüfungen über UI-Elemente als einzige Security.
- Business-Logik in React-Komponenten.
- direkte Datenbankänderung durch Integrationsadapter.
- kritische Zustände ausschließlich in Redis speichern.
- fremde Domain-Module intern umgehen.
- Migrationsdateien nach Deployment rückwirkend verändern.

---

## 5. TypeScript

`strict: true`

Bevorzuge:

- explizite Typen an Domain-Grenzen
- discriminated unions
- readonly Datenmodelle wo sinnvoll
- Value Objects bei wichtigen Domain-Werten
- exhaustive `switch`
- `unknown` statt `any`

---

## 6. Domain Design

Kernmodule:

```text
Organization
Player
Competition
Tournament
TournamentStage
Match
Scoring
Board
Scheduling
Ranking
Statistics
Integration
Notification
Audit
```

Jedes Modul besitzt eine klar definierte öffentliche Schnittstelle.

---

## 7. Scoring Engine

Die Scoring Engine ist reine Domain-Logik.

Sie darf nicht importieren:

- Drizzle
- PostgreSQL
- Redis
- NestJS
- Next.js
- Socket.IO

Sie muss deterministisch testbar sein.

Mindestfälle:

- 501 Normalwurf
- Bust
- Rest 1 bei Double Out
- Checkout
- Checkout mit weniger als 3 Darts
- Leg Win
- Set Win
- Match Win
- Undo / Revert
- ungültige Scores
- Wiederholung eines Command mit gleicher `commandId`

---

## 8. Tournament Engine

Die Tournament Engine ist ebenfalls infrastrukturfrei.

Mindesttests:

- Round Robin gerade Spielerzahl
- Round Robin ungerade Spielerzahl
- Gruppenaufteilung
- Seeding
- Single Elimination 8/16/32/64
- Byes
- Qualifikation Gruppen -> KO
- keine Spieler-Duplikate
- keine ungültigen Match-Abhängigkeiten

Spätere Formate:

- Double Elimination
- Swiss
- kombinierbare Stages

---

## 9. Scheduling Engine

Scheduler darf nur Matches als `READY` markieren, wenn:

- beide Teilnehmer bestimmt sind
- beide Spieler verfügbar sind
- keiner gleichzeitig spielt
- Match nicht beendet ist
- Board verfügbar ist
- Turnierstatus Matchstart erlaubt

Scheduler-Entscheidungen müssen nachvollziehbar sein.

---

## 10. Datenintegrität

Verwende DB-Constraints, nicht nur Applikationslogik.

Beispiele:

- Foreign Keys
- Unique Constraints
- Check Constraints
- Non-Null
- passende Indexe

Bei kritischen Abläufen:

```text
BEGIN
domain write
dependent writes
outbox event
audit record
COMMIT
```

---

## 11. Idempotency

Score-/Match-Commands tragen eine `commandId`.

Wiederholte Übertragung derselben `commandId` darf keinen zweiten Visit erzeugen.

---

## 12. Optimistic Concurrency

Aktive Legs / Matches tragen eine Version.

Client sendet:

```json
{
  "expectedVersion": 12
}
```

Server aktualisiert nur bei passender Version.

Bei Konflikt:

- HTTP 409
- aktueller Serverzustand zurückgeben
- Client muss synchronisieren

---

## 13. Auth & Authorization

Server entscheidet.

Nicht zulässig:

```ts
if (user.role === "ADMIN") {
   // einzige Sicherheitsprüfung im Frontend
}
```

Stattdessen Permission-System:

```text
match:score
match:undo
board:assign
tournament:update
```

---

## 14. Multi-Tenancy

Jede tenant-bezogene Repository-Funktion erhält explizit:

```ts
organizationId
```

Bevorzuge APIs wie:

```ts
getTournament({
  organizationId,
  tournamentId
})
```

Nicht:

```ts
getTournament(tournamentId)
```

---

## 15. API-Konventionen

Base:

```text
/api/v1
```

Ressourcenorientiert.

Fehlerformat einheitlich:

```json
{
  "error": {
    "code": "MATCH_VERSION_CONFLICT",
    "message": "The match state changed.",
    "correlationId": "..."
  }
}
```

Keine internen Stacktraces an Clients.

---

## 16. Realtime

WebSockets verteilen Änderungen.

Sie sind nicht primärer Write-Kanal für Business Commands.

Grundregel:

```text
HTTP Command
→ DB Commit
→ Domain/Outbox Event
→ Realtime Broadcast
```

---

## 17. Integrationen

Verwende Ports/Adapter.

```text
ScoreProvider
├── Manual
├── Autodarts
└── Scolia
```

Externe Daten werden validiert, normalisiert und erst dann als Domain Command verarbeitet.

---

## 18. Frontend

### UI-Regeln

- Mobile First
- Touch Targets >= sinnvoller Mobilgröße
- Scoring mit möglichst wenigen Interaktionen
- Live-Ansichten ohne manuelles Refresh
- Fehlerzustände sichtbar
- Verbindungsstatus sichtbar
- Offline-Queue sichtbar
- kein versteckter Datenverlust

### State

- Server State: TanStack Query
- Formular-State: React Hook Form
- globale UI-Zustände sparsam
- kein globaler Store ohne Notwendigkeit

---

## 19. Accessibility

Mindestens:

- semantisches HTML
- Keyboard-Navigation für Admin
- ausreichender Kontrast
- sichtbarer Fokus
- ARIA nur wenn nötig
- keine Information ausschließlich über Farbe

---

## 20. Tests vor Abschluss

Vor Abschluss eines Features ausführen:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Bei relevantem UI zusätzlich:

```bash
pnpm test:e2e
```

Fehlschläge nicht ignorieren.

---

## 21. Datenbankmigrationen

- ausschließlich versionierte Migrationen
- Migrationen werden reviewt
- keine manuellen Production-Schema-Änderungen
- nach Deployment keine bestehende Migration umschreiben
- Neon wird ausschließlich für Development- und kurzlebige Preview-Branches
  verwendet; Production und Staging nutzen Railway PostgreSQL.
- Preview-Datenbanken enthalten keine unmaskierten Production-Daten.

---

## Workflow für neue Features

FEATURE
   ↓
Superpowers / Plan
   ↓
Implement
   ↓
Unit Tests
   ↓
Browser Test
   ↓
Impeccable UI Audit
   ↓
Codex Security
   ↓
Self Review
   ↓
Full Test Suite
   ↓
GitHub Pull Request
   ↓
PR-Agent
   ↓
Fix Findings
   ↓
Full Test Suite
   ↓
Merge
   ↓
Render / Railway
   ↓
Sentry

---

## 22. Git

Branches:

```text
feature/*
fix/*
refactor/*
chore/*
```

Conventional Commits:

```text
feat:
fix:
refactor:
test:
docs:
chore:
```

Kleine, verständliche Commits.

---

## 23. Pull Requests

Jeder PR beschreibt:

- Problem
- Lösung
- Architektur-Auswirkung
- DB-Migrationen
- Tests
- Security-Auswirkungen
- Screenshots bei UI-Änderungen

---

## 24. Definition of Done

Ein Feature ist fertig, wenn:

- Funktion implementiert
- Typen korrekt
- serverseitig validiert
- autorisiert
- tenant-sicher
- DB-Constraints vorhanden
- Tests vorhanden
- Fehlerfälle behandelt
- Logging sinnvoll
- Dokumentation aktualisiert
- CI grün

---

## 25. Codex-Arbeitsweise

Vor größeren Änderungen:

1. relevante Architekturdateien lesen
2. bestehende Domänengrenzen prüfen
3. existierende Tests lesen
4. kleinste sinnvolle Änderung planen
5. implementieren
6. Tests hinzufügen
7. Tests ausführen
8. Änderungen zusammenfassen

Bei Unklarheit bevorzugt bestehende Architekturregeln beibehalten statt neue Parallelstrukturen einzuführen.

---

## 26. Kritische Regel

> Keine Abkürzung darf Scoring-Korrektheit, Turnierintegrität, Tenant-Isolation oder Autorisierung gefährden.
