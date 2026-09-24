# ROADMAP.md

# Dart Tournament Platform – Implementierungs-Roadmap

Die Roadmap führt vom technischen Fundament bis zum Vollausbau als Multi-Tenant Dart-Plattform.

**Aktueller Stand (24. September 2026):** Phasen 0 bis 6 sind implementiert
und laufen in Production; das Go-Live-Testprogramm ist seit dem 18.09.2026
abgeschlossen. Vorgezogen und in Betrieb sind der Ligabetrieb mit
Team-Begegnungen, Ligatabelle und Einzelrangliste nach VFC-Reglement (Phase 9
teilweise) sowie E-Mails für Einladung und Passwort-Reset (Phase 11
teilweise). Von Phase 7 steht die Basis mit Organisationen, Rollen,
Permissions und Einladungen; Settings, Limits, Branding, eigene Domains und
Billing sind der nächste geplante Produktabschnitt. Registrierung neuer Konten
ist einladungsgebunden; Turnierverwaltung wird nur Rollen mit der
entsprechenden Permission angeboten.

---

# Phase 0 – Foundation

**Status:** Implementiert – 26. August 2026

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
- Registrierung nur auf gültige Einladung
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

- [x] reproduzierbare Production-Images und Railway IaC sind vorhanden
- [x] DB-Migrationen laufen vor dem API-Start automatisiert
- [x] Auth und Tenant-Isolation sind getestet
- [x] nicht eingeladene Registrierungen werden serverseitig mit HTTP 403 abgewiesen
- [x] Verwaltungszugänge werden rollenabhängig angezeigt und serverseitig autorisiert
- [x] CI prüft Lint, Typen, Tests, Build, E2E und Deployment-Images

## Betriebsstatus Production

- [x] Railway Hobby ist aktiviert und das Production-Projekt heisst `dartbase`.
- [x] Web, API und Worker sind als Railway-Services angelegt.
- [x] Cyon delegiert `dartbase.ch` an die autoritativen Cloudflare-Nameserver.
- [x] Apex-, Wildcard-, ACME- und Railway-Verifikationseinträge sind in
  Cloudflare als `DNS only` eingerichtet und die Cloudflare-Zone ist aktiv.
- [x] Das Wildcard-Zertifikat ist gültig.
- [x] Das separate Zertifikat für `dartbase.ch` ist gültig.
- [x] Web, API, Worker, PostgreSQL und Redis sind erfolgreich deployt; die
  internen Healthchecks bestehen.
- [x] Der exakte Cloudflare-CNAME `api` zeigt auf den API-Service und das
  Zertifikat für `api.dartbase.ch` ist gültig.
- [x] Die öffentlichen Web- und API-Smoke-Tests bestehen.
- [x] Die beiden stabilen GitHub-Checks sind definiert und werden vor Releases
  verifiziert. Seit das Repository am 18.09.2026 öffentlich ist, verlangen
  `main` und `develop` per Branch-Protection einen PR mit beiden Checks als
  Required Status Checks, auch für Admins.
- [x] Das Environment `staging` folgt `develop`, mit eigenen Datenservices und
  eigenen Zugangsdaten; Production und Staging laufen mit aktivierter
  Point-in-Time-Recovery.
- [x] Ausgehende E-Mails laufen seit dem 21.09.2026 über einen echten
  Versanddienst; davor schrieb der Log-Adapter nur ins Protokoll.

Einrichtung, Diagnose, IaC-Abgleich und das GitHub-CI-Gate stehen im
[Railway-Runbook](./infrastructure/railway.md).

---

# Phase 1 – Playable Match MVP

**Status:** Implementiert – 26. August 2026

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

- [x] Zwei Spieler können ein vollständiges 501-Double-Out-Match fehlerfrei spielen.
- [x] Bust, Checkout, Dart Count, Best of Legs und Undo werden deterministisch getestet.
- [x] Score-Commands sind idempotent und Versionskonflikte liefern den aktuellen Serverzustand.
- [x] Match-, Visit-, Audit- und Outbox-Daten werden gemeinsam transaktional persistiert.
- [x] Ein Browser-Test bildet den vollständigen Matchablauf ab.

---

# Phase 2 – Tournament MVP

**Status:** Implementiert – 26. August 2026

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

Aktueller Stand:

- [x] Infrastrukturfreie Engine für Round Robin, Gruppen, Setzung, K.-o. und Byes
- [x] Persistenter tenant-sicherer Turniergraph mit Constraints und Migrationen
- [x] Autorisierte, idempotente und versionsgesicherte Board-Zuweisung
- [x] Scoring-Ergebnis aktualisiert Gruppe beziehungsweise K.-o.-Abhängigkeit transaktional
- [x] Turnierliste, Setup, Engine-Vorschau und Kommandozentrale verwenden echte API-Daten
- [x] Unit- und API-Integrationstests für Erzeugung, Isolation, Zuweisung und Ergebnis-Synchronisierung
- [x] Result Correction inklusive Audit-Workflow und sicherem Reopen des Scoring-Matches
- [x] Vollständiger automatisierter Durchlauf des 32/8/2/16-Referenzturniers mit 63 Matches

Das Exit Criterion wird durch einen persistenten Integrationstest des gesamten
Referenzturniers und einen Browserablauf von Erstellung, Board-Zuweisung,
Scoring und Result Correction abgedeckt.

---

# Phase 3 – Realtime & Public Live

**Status:** Implementiert – 26. August 2026

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

Umgesetzt sind ein transaktionales Outbox-Relay über Redis und Socket.IO,
ereignisbasierte Aktualisierung der Turnierleitung sowie öffentliche Live-,
TV- und Board-Ansichten mit Gruppenranglisten, K.-o.-Tableau,
Verbindungsstatus und QR-Code je Board. Bei unterbrochener Socket-Verbindung
fällt die Oberfläche sichtbar auf periodische Synchronisierung zurück.

---

# Phase 4 – Advanced Tournament Engine

**Status:** Implementiert – 26. August 2026

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

Die Formatwerkstatt validiert frei kombinierte Stages serverseitig und zeigt
Teilnehmerfluss, Qualifikation, Matchanzahl und Byes. Die infrastrukturfrei
getestete Engine deckt Double Elimination, Schweizer Paarungen ohne vermeidbare
Wiederholungen, regionale Setzung, Einzel, Paare und Teams ab. X01-Matches und
Turniere unterstützen Best of Sets zusätzlich zu Best of Legs.

---

# Phase 5 – PWA & Reliability

**Status:** Implementiert – 26. August 2026

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

Die installierbare PWA hält statische Assets und eine datenschutzneutrale
Offline-Seite bereit. Nicht übertragene Score-Commands werden mit ihrer
`commandId` dauerhaft in IndexedDB gespeichert, nach Reconnect idempotent
wiederholt und bei HTTP 409 sichtbar zur manuellen Synchronisierung angehalten.
Ein geräteübergreifender Board-Controller-Lock mit Heartbeat verhindert
gleichzeitige Eingaben und kann nach Ablauf oder bewusstem Takeover übernommen
werden. Match Resume lädt stets den autoritativen Serverstand.

---

# Phase 6 – Statistics & Player Platform

**Status:** Implementiert – 26. August 2026

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

Die reine Statistik-Domain aggregiert abgeschlossene Match-, Leg- und
Visit-Daten deterministisch. Tenant-sichere Spielerprofile zeigen Match
History, Average, First 9, Checkout-Quote auf Basis explizit erfasster
Doppelversuche, 180er, High Finish, Best Leg, Darts pro Leg, Head-to-Head,
Rankingverlauf und Karrierewerte. Der separate Worker verarbeitet
`MATCH_COMPLETED` aus der transaktionalen Outbox unabhängig vom
Realtime-Publikationsstatus und aktualisiert persistente Spieleraggregate.

## Vollbild-Scoring-Fläche

**Status:** Umgesetzt – 05. September 2026. Die Scoring-Fläche läuft auf
einer geräteweiten Vollbildansicht mit zwei Eingabearten (Wurf für Wurf als
Standard, Rundensumme als Alternative, umschaltbar im Einstellungs-Modal),
Checkout-Erfassung in beiden Modi und dauerhafter Einzelwurf-Speicherung in
`visit_darts` (siehe [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md)).

**Offene Folgearbeit:** Statistik über Wurfdaten — Segmentverteilung,
Checkout-Muster je Doppel/Triple und ähnliche Auswertungen auf Basis der in
`visit_darts` gespeicherten Einzelwürfe sind noch nicht gebaut; die
bestehenden Spielerprofile werten bisher nur Aufnahme- und Leg-Ebene aus.

---

# Phase 7 – Multi-Tenant SaaS

**Status:** Basis vorhanden – Organisationen, Mitgliedschaften, Rollen,
Permissions und Einladungen sind umgesetzt; Settings sind teilweise
umgesetzt (Name, Zeitzone, Sprache, Löschen), Limits, Branding, kundeneigene
Organisationsdomains und Billing bleiben offen. Die technische
Plattformdomain `dartbase.ch` ist davon unabhängig bereits eingerichtet.

## Ziel

Mehrere Vereine / Veranstalter professionell betreiben.

## Scope

- Organization Settings
- Invitations (Basis implementiert)
- Usage Limits
- Plans
- Branding
- Sponsor Assets
- kundeneigene Custom Domains pro Organisation
- Billing vorbereiten
- Audit Ausbau
- Organization Dashboard

## Mögliche Pläne

```text
FREE
TEAM
CLUB
LIGA
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

**Status:** Teilweise umgesetzt – Teams mit Kader und Captain, Ligawettbewerbe
mit Begegnungsvorlage, Begegnungen mit Spieltag, Heim/Gast, Termin und Ort,
beidseitige Aufstellung, Ausspielen der Einzel und Doppel auf mehreren Boards,
automatische Wertung und die daraus gerechnete Ligatabelle sind umgesetzt.
Saison, Divisionen, automatische Spielplangenerierung, Auf- und Abstieg,
Transfers und Saisonstatistik bleiben offen.

## Ziel

Liga- und Saisonbetrieb.

## Scope

- Teams (implementiert)
- Team Rosters (implementiert)
- League (Wettbewerb mit Begegnungsvorlage implementiert)
- Team-Begegnungen: Aufstellung, Einzel/Doppel, Wertung (implementiert)
- Home/Away je Begegnung (implementiert)
- League Tables (implementiert)
- Fixtures (Begegnungen werden manuell angesetzt; Spielplangenerierung offen)
- Season
- Division
- Promotion / Relegation
- Transfers
- Season Statistics

## Grundlagen

Fachliche Grundlage der umgesetzten Team-Begegnung ist das
[VFC-Liga-Reglement](./LIGA-REGLEMENT.md); die Umsetzung beschreibt die
[Design-Spec](./docs/superpowers/specs/2026-09-02-team-encounter-league-design.md).

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

## Vorgezogen und in Betrieb

Transaktionale E-Mails für Einladung und Passwort-Reset sind seit dem
20.09.2026 umgesetzt und laufen seit dem 21.09.2026 über einen echten
Versanddienst (ADR 0017). Der Weg — Versandauftrag in derselben Transaktion,
Zustellung durch den Worker, Zustand sichtbar je Einladung — steht damit für
weitere Mailarten bereit.

## Scope

- Web Push
- Email für Spielbetrieb und Turnierverlauf (die transaktionalen Mails oben
  sind bereits da)
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
