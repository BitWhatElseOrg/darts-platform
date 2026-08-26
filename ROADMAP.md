# ROADMAP.md

# Dart Tournament Platform – Implementierungs-Roadmap

Die Roadmap führt vom technischen Fundament bis zum Vollausbau als Multi-Tenant Dart-Plattform.

---

# Phase 0 – Foundation

## Ziel

Saubere technische Basis schaffen.

## Scope

- Monorepo
- pnpm + Turborepo
- Next.js
- NestJS + Fastify
- PostgreSQL
- Drizzle
- Redis
- Better Auth
- Organizations
- Memberships
- Rollen / Permissions
- Basis-Spielerverwaltung
- Docker Development
- GitHub Actions
- Railway Staging / Production
- Logging
- Health Checks

## Deliverables

- Login / Logout
- Organisation erstellen
- Mitglieder einladen
- Spieler CRUD
- Tenant-Isolation
- CI/CD

## Exit Criteria

- Production Deployment funktioniert
- DB-Migrationen automatisiert
- Auth und Tenant-Isolation getestet
- CI ist verpflichtend grün

---

# Phase 1 – Playable Match MVP

## Ziel

Ein vollständiges X01-Match spielen.

## Scope

- Board
- Match
- Match Participants
- Leg
- Visit
- 501
- Double Out
- Best of Legs
- Score-Eingabe
- Bust-Erkennung
- Checkout
- Dart Count
- Undo / Revert
- Match Result
- Optimistic Concurrency
- Idempotency

## UI

- Scoreboard für Tablet / Smartphone
- Restscore
- Legs
- letzte Aufnahmen
- Undo
- Checkout-Hinweis optional

## Exit Criteria

Zwei Spieler können ein vollständiges 501-Match fehlerfrei spielen.

---

# Phase 2 – Tournament MVP

## Ziel

Ein reales Vereinsturnier komplett durchführen.

## Scope

- Tournament
- Teilnehmer
- Tournament Stages
- Round Robin
- Groups
- Single Elimination
- Groups -> KO
- Seeding
- Ranking
- Match Generation
- Board Assignment
- Tournament Dashboard
- Result Correction
- Audit Log

## Referenzszenario

```text
32 Spieler
8 Gruppen
4 Spieler pro Gruppe
Top 2 qualifizieren
16er KO
8 Boards
```

## Exit Criteria

Das Referenzturnier kann vollständig ohne manuelle Tabellen durchgeführt werden.

---

# Phase 3 – Realtime & Public Live

## Ziel

Turnierdaten live verteilen.

## Scope

- Realtime Gateway
- Socket.IO
- Redis Pub/Sub
- Live Match
- Live Boards
- Public Tournament Page
- Gruppenranglisten
- KO-Bracket
- TV Mode
- QR-Code je Board
- Connection Status

## Exit Criteria

Score-Änderungen erscheinen live auf:

- Turnierleitung
- TV
- Zuschauer-Smartphone

---

# Phase 4 – Advanced Tournament Engine

## Ziel

Komplexere Turnierformate.

## Scope

- Double Elimination
- Swiss System
- Sets
- Teams
- Pairs
- flexible Stage Composition
- Advanced Seeding
- Qualification Rules
- Byes
- Platzierungsspiele optional

## Exit Criteria

Turnierleitung kann mehrstufige Formate konfigurieren.

---

# Phase 5 – PWA & Reliability

## Ziel

Robuster Betrieb im Turnieralltag.

## Scope

- PWA installierbar
- Offline Assets
- Pending Command Queue
- Reconnect
- Replay / Sync
- Konfliktbehandlung
- Board Controller Lock
- Heartbeat
- Recovery
- Match Resume
- sichtbarer Online/Offline-Status

## Exit Criteria

Kurze WLAN-Ausfälle führen zu keinem Score-Verlust.

---

# Phase 6 – Statistics & Player Platform

## Ziel

Langfristige Spieler- und Matchdaten.

## Scope

- Player Profiles
- Match History
- Average
- First 9
- Checkout %
- 180
- High Finish
- Best Leg
- Darts per Leg
- Head-to-Head
- Ranking History
- Career Statistics
- Statistics Worker
- Aggregates

---

# Phase 7 – Multi-Tenant SaaS

## Ziel

Mehrere Vereine / Veranstalter professionell betreiben.

## Scope

- Organization Settings
- Invitations
- Usage Limits
- Plans
- Branding
- Sponsor Assets
- Custom Domains
- Billing vorbereiten
- Audit Ausbau
- Organization Dashboard

## Mögliche Pläne

```text
FREE
CLUB
PRO
ENTERPRISE
```

---

# Phase 8 – Autoscoring

## Ziel

Externe automatische Scoring-Systeme anbinden.

## Scope

- ScoreProvider Interface
- Manual Adapter
- Autodarts Adapter
- Scolia Adapter
- Integration Secrets
- Connection Health
- Mapping Board <-> External Board
- Retry / Deduplication
- External Event Audit

## Datenfluss

```text
Autodarts / Scolia
↓
Integration Adapter
↓
Normalize
↓
Domain Command
↓
Scoring Engine
↓
PostgreSQL
↓
Outbox
↓
Realtime
```

---

# Phase 9 – League Platform

## Ziel

Liga- und Saisonbetrieb.

## Scope

- Season
- League
- Division
- Teams
- Fixtures
- Home/Away
- Team Rosters
- League Tables
- Promotion / Relegation
- Transfers
- Season Statistics

---

# Phase 10 – Tournament Series

## Ziel

Mehrere Turniere als Serie zusammenfassen.

## Scope

- Series
- Events
- Series Points
- Best-X Results
- Season Ranking
- Qualification
- Finals Qualification
- Series Statistics

---

# Phase 11 – Notifications

## Scope

- Web Push
- Email
- In-App Notifications

Beispiele:

- „Du spielst als Nächstes.“
- „Bitte zu Board 7.“
- „Board 4 ist frei.“
- „Dein Match wurde verschoben.“
- „Finale startet.“

Später optional:

- SMS
- WhatsApp

---

# Phase 12 – Public API

## Scope

```text
GET /api/public/v1/tournaments
GET /api/public/v1/tournaments/:id
GET /api/public/v1/matches/:id
GET /api/public/v1/players/:id
GET /api/public/v1/rankings/:id
```

Zusätzlich:

- API Keys
- Rate Limits
- Scopes
- Dokumentation
- OpenAPI

---

# Phase 13 – Webhooks

## Events

```text
match.started
visit.recorded
match.finished
board.assigned
tournament.started
tournament.finished
ranking.updated
```

## Anforderungen

- Signaturen
- Retry
- Dead Letter Queue
- Delivery Log
- Secret Rotation

---

# Phase 14 – Enterprise / Scale

Nur bei tatsächlichem Bedarf.

## Scope

- API horizontal scaling
- Realtime horizontal scaling
- Redis HA
- Connection Pooling
- Managed PostgreSQL / HA
- Read Replicas
- Worker Pools
- CDN
- WAF
- Multi-Region
- getrennte Services

## Mögliche Service-Extraktion

```text
Realtime Service
Statistics Service
Notification Service
Integration Service
```

---

# Empfohlene Entwicklungsreihenfolge

```text
Foundation
↓
Scoring Engine
↓
Match
↓
Tournament Engine
↓
Boards
↓
Tournament UI
↓
Realtime
↓
Public Portal
↓
PWA / Reliability
↓
Statistics
↓
Advanced Formats
↓
SaaS
↓
Autoscoring
↓
League
↓
Tournament Series
↓
Notifications
↓
Public API
↓
Enterprise Scaling
```

---

# Priorisierung nach Nutzen

## Must Have

- Phase 0–3

## Für echten Turnierbetrieb sehr wichtig

- Phase 5

## Produktdifferenzierung

- Phase 6
- Phase 8

## Plattformausbau

- Phase 7
- Phase 9–13

## Nur bei Skalierungsbedarf

- Phase 14

---

# MVP-Erfolgskriterium

Die erste öffentlich nutzbare Version gilt als erfolgreich, wenn ein Verein ohne Excel oder Papierhilfen ein komplettes Turnier mit Gruppenphase und KO auf mehreren Boards durchführen kann und Zuschauer die Ergebnisse live verfolgen können.
