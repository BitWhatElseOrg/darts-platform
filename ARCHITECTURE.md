# ARCHITECTURE.md

# Dart Tournament Platform – Zielarchitektur

**Status:** Zielarchitektur Vollausbau  
**Architekturstil:** Modularer Monolith mit klaren Domänengrenzen  
**Primärplattform:** Responsive Web-App + PWA  
**Zielgeräte:** Desktop, Tablet, Smartphone, TV/Beamer  
**Sprache:** TypeScript  
**Hosting-Ziel:** Railway
**DNS:** Cloudflare
**Domain-Registrar:** Cyon
**Repository:** GitHub Monorepo

**Implementierter Stand (31. August 2026):** Die Phasen 0 bis 6 sind produktseitig
umgesetzt. Web und API decken Organisations- und Spieleradministration,
X01-Scoring, Turnierplanung und -leitung, Realtime-/Live-Flächen,
Offline-Sicherheit und Statistiken ab; der Worker aktualisiert
Karriereaggregate. Registrierungen sind nur für gültig eingeladene
E-Mail-Adressen möglich. Das Production-Projekt `dartbase` enthält erfolgreich
deployte Web-, API-, Worker-, PostgreSQL- und Redis-Services. Die öffentliche
Web- und API-Erreichbarkeit ist über `dartbase.ch` und `api.dartbase.ch`
verifiziert; beide Endpunkte besitzen gültige Railway-Zertifikate. Die folgenden
Kapitel beschreiben weiterhin das Zielbild und kennzeichnen spätere
Ausbaustufen als solche.

---

## 1. Zielbild

Die Plattform soll Dartturniere, Ligen und Turnierserien vollständig verwalten und durchführen können.

Ziele des Vollausbaus:

- Organisationen / Vereine
- Benutzer, Rollen und Berechtigungen
- Spieler und Teams
- Turniere und Turnierserien
- Ligen und Saisons
- Round Robin
- Gruppenphasen
- Single Elimination
- Double Elimination
- Schweizer System
- kombinierbare Turnierphasen
- 301 / 501 / weitere X01-Varianten
- Double In / Double Out / Master Out
- Best-of-Legs / Sets
- Boardverwaltung
- automatische Boardzuweisung
- manuelle Score-Erfassung
- Live-Scoring
- QR-Code pro Board
- TV-/Beamer-Modus
- öffentliche Turnierseiten
- Statistiken und Rankings
- PWA und Offline-Puffer
- Autodarts-Integration
- Scolia-Integration
- Benachrichtigungen
- öffentliche API
- Webhooks
- Multi-Tenant-SaaS
- Audit-Logging
- Sponsoren / Branding

---

## 2. Architekturprinzip

### 2.1 Modularer Monolith zuerst

Zum Projektstart werden keine Microservices eingesetzt.

Die Backend-Anwendung wird als modularer Monolith entwickelt:

```text
Backend
├── identity
├── organizations
├── players
├── competitions
├── tournaments
├── matches
├── scoring
├── boards
├── scheduling
├── rankings
├── statistics
├── realtime
├── notifications
├── integrations
└── audit
```

Vorteile:

- einfache lokale Entwicklung
- wenig Infrastruktur
- einfache Transaktionen
- einfacher Betrieb
- schnelleres Debugging
- trotzdem klare Domänengrenzen

Einzelne Komponenten können später aus dem Monolithen ausgelagert werden, falls Last oder organisatorische Gründe dies erfordern.

Geeignete spätere Kandidaten:

- Realtime Gateway
- Statistics Worker
- Notification Worker
- Integration Worker
- Import/Export Worker

---

## 3. Systemübersicht

```mermaid
flowchart TB
    USER[Benutzer]
    BOARD[Board Tablet / Smartphone]
    TV[TV / Beamer]
    AUTO[Autodarts / Scolia]

    WEB[Next.js Web / PWA]
    API[NestJS API]
    RT[Realtime Gateway]
    WORKER[Background Worker]

    PG[(PostgreSQL)]
    REDIS[(Redis)]
    S3[(Object Storage)]

    USER --> WEB
    BOARD --> WEB
    TV --> WEB

    WEB --> API
    WEB <--> RT

    AUTO --> API

    API --> PG
    API --> REDIS
    API --> S3

    RT --> REDIS
    WORKER --> PG
    WORKER --> REDIS
```

---

## 4. Tech Stack

| Bereich | Technologie |
|---|---|
| Sprache | TypeScript |
| Package Manager | pnpm |
| Monorepo | Turborepo |
| Frontend | Next.js + React |
| Styling | Tailwind CSS |
| UI | shadcn/ui |
| Forms | React Hook Form |
| Server State | TanStack Query |
| Validierung | Zod |
| Backend | NestJS |
| HTTP Adapter | Fastify |
| REST API | `/api/v1` |
| Realtime | Socket.IO / WebSocket |
| Datenbank | PostgreSQL |
| ORM | Drizzle ORM |
| Cache / PubSub | Redis |
| Queue | BullMQ |
| Auth | Better Auth |
| File Storage | S3-kompatibler Object Storage |
| Unit Tests | Vitest |
| Integration Tests | Testcontainers |
| E2E | Playwright |
| Observability | OpenTelemetry |
| Error Tracking | Sentry |
| Container | Docker |
| CI/CD | GitHub Actions |
| Hosting | Railway |
| DNS / Domain | Cloudflare als autoritatives DNS, Cyon als Registrar |

---

## 5. Monorepo-Struktur

```text
dart-tournament-platform/
├── apps/
│   ├── web/
│   ├── api/
│   ├── realtime/
│   └── worker/
│
├── packages/
│   ├── domain/
│   ├── database/
│   ├── auth/
│   ├── scoring-engine/
│   ├── tournament-engine/
│   ├── league-engine/
│   ├── scheduling-engine/
│   ├── ranking-engine/
│   ├── statistics/
│   ├── integrations/
│   ├── ui/
│   ├── schemas/
│   └── config/
│
├── docs/
│   ├── architecture/
│   ├── adr/
│   ├── api/
│   └── domain/
│
├── infrastructure/
│   ├── docker/
│   └── railway/
│
├── .github/
│   └── workflows/
│
├── AGENTS.md
├── ARCHITECTURE.md
├── ROADMAP.md
└── DATABASE_SCHEMA.md
```

---

## 6. Multi-Tenancy

Die Plattform wird ab Phase 0 mandantenfähig gebaut.

Zentrale Entität:

```text
Organization
```

Nahezu alle geschäftlichen Tabellen enthalten:

```text
organization_id
```

Beispiele:

- players
- tournaments
- boards
- competitions
- integrations
- rankings
- audit_events

Tenant-Isolation ist serverseitig zwingend.

Nicht zulässig:

```sql
SELECT * FROM tournaments WHERE id = $1;
```

Ziel:

```sql
SELECT *
FROM tournaments
WHERE id = $1
  AND organization_id = $2;
```

---

## 7. Rollen und Berechtigungen

### Systemrolle

- `SUPER_ADMIN`

### Organisationsrollen

- `OWNER`
- `ADMIN`
- `TOURNAMENT_DIRECTOR`
- `SCORER`
- `MEMBER`
- `VIEWER`

### Turnierspezifische Rollen

- `TOURNAMENT_ADMIN`
- `BOARD_SCORER`
- `REFEREE`

Berechtigungen werden als Permissions modelliert:

```text
tournament:create
tournament:update
tournament:start
tournament:finish

player:create
player:update

match:start
match:score
match:undo
match:finish

board:assign
board:control

organization:manage_members
organization:manage_roles
```

Jede Mutation muss serverseitig autorisiert werden.

Die UI zeigt den Einstieg «Turnierleitung» nur, wenn die aktive oder eine andere
zugängliche Organisation `tournament:update` gewährt. Diese Sichtbarkeit ist
eine Bedienhilfe; API-Guard und Organisationszugriff bleiben die verbindliche
Sicherheitsgrenze.

Neue Konten dürfen nur angelegt werden, wenn für die normalisierte E-Mail-Adresse
eine offene, noch nicht abgelaufene Organisationseinladung und der passende
kryptografische Einladungscode vorliegen. Nach der Registrierung nimmt der
Benutzer die Einladung mit demselben Code atomisch einmalig an und erhält erst
dadurch die zugewiesene Organisationsrolle.

Die Annahme legt eine Mitgliedschaft an, überschreibt aber keine bestehende:
eine gesperrte bleibt gesperrt (409 `MEMBERSHIP_SUSPENDED`, die Einladung
bleibt offen und gilt nach der Reaktivierung), und die Rolle einer aktiven
bleibt unverändert. Rollenwechsel und Reaktivierung laufen ausschliesslich über
`PATCH /organizations/:id/members/:userId` — dort liegen die Eigentumsregeln,
der Schutz des letzten aktiven OWNER und der Audit-Eintrag.

### Konto und Spielerprofil

Mitgliedschaft und Spieler bleiben getrennte Entitaeten: die Mitgliedschaft
regelt den Zugang, der Spieler ist das sportliche Stammdatum. Wer beides ist,
wird ueber die optionale `players.user_id` verknuepft — hoechstens ein Profil
je Konto und Organisation, erzwungen durch einen partiellen Unique-Index.

Die Verknuepfung entsteht auf zwei Wegen: die Einladung kann optional ein
Profil mitgeben (`organization_invitations.player_id`), und die Leitung kann
ueber `PUT`/`DELETE /organizations/:organizationId/members/:userId/player`
zuordnen und loesen. Beide verlangen `organization:manage_members` und sind
auditiert (`PLAYER_LINKED`, `PLAYER_UNLINKED`).

Sie gewaehrt keine Berechtigung, sondern beantwortet eine Identitaet: erst
dadurch kann der Server „meine Matches" und „meine Statistik" aufloesen.
Autorisiert wird weiterhin ausschliesslich ueber Rolle und Permission.
Begruendung und verworfene Alternativen stehen in
[ADR 0015](./docs/adr/0015-spieler-konto-verknuepfung.md).

Die Verwaltung dazu liegt unter `/mitglieder` und liest
`GET /organizations/:id/members` (alle Mitgliedschaften, aktive wie gesperrte)
und `GET /organizations/:id/invitations` (die offenen Einladungen dieser
Organisation). `DELETE /organizations/:id/invitations/:invitationId` nimmt eine
offene Einladung zurück und entwertet dabei ihren Claim-Token; eine bereits
angenommene oder zurückgezogene Einladung meldet 404. Alle drei verlangen
`organization:manage_members`, der Rollen- und Statuswechsel darüber hinaus
`organization:manage_roles`.

### Einmaliger Production-Owner-Bootstrap

Für eine leere Production-Datenbank gibt es einen separaten, kompilierten
CLI-Pfad: `pnpm db:bootstrap:production` delegiert an
`pnpm --filter @darts-platform/api bootstrap:production` und wird einmalig im
Railway-API-Container ausgeführt. Der rohe Guard verlangt `NODE_ENV=production`
und `ALLOW_PRODUCTION_BOOTSTRAP=true`, bevor vollständige Konfiguration oder
Datenbankverbindung aufgebaut werden. Ein öffentlicher Endpoint, ein
Startup-Hook, ein Default-/temporäres Passwort und manueller SQL-Bootstrap sind
ausgeschlossen.

Die pnpm-Wrapper sind Convenience-Befehle und dürfen Lifecycle-/Bannertext
ausgeben. Für maschinenlesbares Readback wird aus dem Image-Arbeitsverzeichnis
`/app` der kompilierte Node-Entry-Point direkt aufgerufen:
`node /app/apps/api/dist/operations/bootstrap-production.js`; dieser direkte
Aufruf liefert die einzelne sanitierte JSON-Zeile.

Der Pfad legt einen persistenten, nicht anmeldbaren System-Prinzipal mit der
reservierten Adresse `production-bootstrap@system.dartbase.invalid` an. Er hat
keinen Account, kein Passwort, keine Session und keine Membership und erhält
keine Tenant-Rechte. Er bleibt als referenzieller Actor für OWNER-Einladung und
Audit bestehen. Die Einladung gilt 48 Stunden; die Statuswerte `created`,
`pending` und `already-complete` sind nur für die jeweils exakt geprüften
Bootstrap-Zustände zulässig. Eine abgelaufene, passende Einladung kann als
historisierte `EXPIRED`-Zeile erneuert werden.

Die öffentliche `createInvitationSchema`- und Controller-Schreibgrenze bleibt
unverändert und lehnt `OWNER` ab. Erst die authentifizierte Registrierung mit
der eingeladenen E-Mail-Adresse und die anschließende Annahme erzeugen die
aktive OWNER-Membership. Details und der SSH-Schlüssel-Lifecycle stehen im
[ADR 0012](./docs/adr/0012-production-owner-bootstrap.md).

---

## 8. Hauptdomänen

```text
Identity
Organization
Player
Competition
Tournament
Tournament Stage
Match
Scoring
Board
Scheduling
Ranking
Statistics
Realtime
Integration
Notification
Audit
```

---

## 9. Competition-Modell

```text
Competition
├── Tournament
├── League
├── Tournament Series
└── Season
```

Das Modell erlaubt später Liga und Turnierserie, ohne den Turnierkern neu zu bauen.

Der Ligamodus ist als Team-Begegnung umgesetzt: Ein Wettbewerb vom Typ `LEAGUE`
trägt eine Begegnungsvorlage, aus der jede Begegnung ihre Slots als
eingefrorene Kopie erhält. Fachliche Grundlage dieser Regeln – Spielvarianten,
Aufstellung, Rundenfolge und Wertung – ist das
[VFC-Liga-Reglement](./LIGA-REGLEMENT.md); `league-engine` bildet es
infrastrukturfrei ab.

---

## 10. Tournament-Modell

Ein Turnier besteht aus mehreren Stages.

```text
Tournament
├── Participants
├── Stages
│   ├── Group
│   ├── Round Robin
│   ├── Swiss
│   ├── Single Elimination
│   └── Double Elimination
├── Matches
├── Boards
└── Ranking
```

Beispiel:

```text
Stage 1: 8 Gruppen à 4 Spieler
Stage 2: Last 16
Stage 3: Quarter Finals
Stage 4: Semi Finals
Stage 5: Final
```

---

## 11. Tournament Engine

Die Tournament Engine ist reine Domain-Logik.

Sie kennt:

- keine UI
- keine HTTP-Controller
- keine Datenbank
- kein Redis
- keine Railway-Infrastruktur

Module:

```text
TournamentEngine
├── RoundRobinGenerator
├── GroupGenerator
├── SingleEliminationGenerator
├── DoubleEliminationGenerator
├── SwissGenerator
├── SeedingEngine
├── QualificationEngine
└── AdvancementEngine
```

Beispiel:

```ts
const plan = tournamentEngine.generate({
  format: "GROUPS_TO_KO",
  participants: 32,
  groupStage: {
    groups: 8,
    qualifiersPerGroup: 2
  },
  knockout: {
    seedStrategy: "GROUP_POSITION"
  }
});
```

---

## 12. Scoring Engine

Die Scoring Engine bildet die Dartregeln ab.

```text
ScoringEngine
├── X01
│   ├── 301
│   ├── 501
│   ├── 701
│   └── 1001
└── spätere Spielarten
```

Konfiguration:

```text
Straight In
Double In
Straight Out
Double Out
Master Out
Best of Legs
Best of Sets
```

Sie validiert:

- Score
- Bust
- Restscore
- Checkout
- Dartanzahl
- Leg-Ende
- Set-Ende
- Match-Ende
- Undo / Revert

---

## 13. Match-Domäne

```text
Match
├── MatchParticipants
├── Sets
│   └── Legs
│       └── Visits
│           └── optional Darts
└── Result
```

Ein Visit enthält mindestens:

```text
id
organization_id
match_id
leg_id
player_id
sequence
score
dart_count
remaining_before
remaining_after
bust
checkout
created_at
created_by
```

Optional:

```text
dart_1
dart_2
dart_3
```

---

## 14. Domain Events

Wichtige Änderungen werden als Domain Events behandelt:

```text
MATCH_STARTED
LEG_STARTED
VISIT_RECORDED
VISIT_BUST
VISIT_REVERTED
LEG_WON
SET_WON
MATCH_WON
MATCH_FINISHED
BOARD_ASSIGNED
RANKING_UPDATED
```

Historische Scoring-Daten werden möglichst nicht destruktiv gelöscht.

Undo:

```text
VISIT_RECORDED
↓
VISIT_REVERTED
```

---

## 15. Concurrency

Jedes aktive Leg besitzt eine Version.

Beispiel:

```text
version = 17
```

Command:

```json
{
  "score": 140,
  "expectedVersion": 17,
  "commandId": "uuid"
}
```

Nach erfolgreichem Commit:

```text
version = 18
```

Ein weiterer Command mit Version 17 wird abgewiesen.

Zusätzlich müssen Score-Commands idempotent sein.

---

## 16. Board Control

Ein Board besitzt:

```text
Board
├── activeMatch
├── controller
├── heartbeat
└── controllerExpiresAt
```

Redis-Key:

```text
board:{boardId}:controller
```

Der Controller-Lock besitzt einen Timeout.

Ein zweites Gerät kann das Board erst übernehmen, wenn der Lock freigegeben wurde oder abgelaufen ist.

---

## 17. Realtime

Realtime wird für folgende Oberflächen benötigt:

- Scoring
- Turnierleitung
- Live-Seite
- TV-Modus
- Match-Ansicht
- Boardstatus

Channels:

```text
organization:{id}
tournament:{id}
match:{id}
board:{id}
```

Datenfluss:

```text
Score Command
↓
API
↓
PostgreSQL Commit
↓
Domain Event / Outbox
↓
Redis Pub/Sub
↓
Realtime Gateway
↓
Clients
```

Grundregel:

> Persistieren vor Broadcast.

Der Handshake hängt am HTTP-Server und läuft damit nicht durch das
Fastify-Rate-Limit; er hat seine eigene Bremse je Client-Adresse und Minute
(`RATE_LIMIT_SOCKET_MAX_PER_MINUTE`, Adresse über dieselbe Hop-Zählung wie
`request.ip`). Ein Socket abonniert höchstens 20 Räume; darüber antwortet der
Server mit `subscription:rejected`. Räume sind über `public_id` adressiert,
und wer welchen Raum betreten darf, entscheidet eine eigene Autorisierung
(siehe Abschnitt „Öffentliche Adressierung und Kanal-Autorisierung").

---

## 18. REST API

Mutationen laufen grundsätzlich über HTTP.

Beispiele:

```text
POST /api/v1/tournaments
POST /api/v1/tournaments/:id/start
POST /api/v1/matches/:id/start
POST /api/v1/matches/:id/visits
POST /api/v1/matches/:id/undo
POST /api/v1/boards/:id/assign
```

Realtime verteilt Zustandsänderungen an Clients.

---

## 19. Score Provider

Manuelle und automatische Score-Erfassung verwenden dieselbe Abstraktion.

```text
Match Engine
    │
Score Provider
 ┌──┴─────────────┐
 │                │
Manual         External
              ├── Autodarts
              └── Scolia
```

Beispielinterface:

```ts
export interface ScoreProvider {
  startMatch(matchId: string): Promise<void>;
  stopMatch(matchId: string): Promise<void>;
  subscribe(handler: (visit: ExternalVisit) => void): () => void;
}
```

Externe Anbieter dürfen nie direkt Turnier- oder Matchtabellen verändern.

---

## 20. Scheduling Engine

Ziel:

> Nicht einfach „nächstes Match auf nächstes freies Board“.

Bewertung berücksichtigt:

- freie Boards
- Matchstatus
- Spieler verfügbar?
- Spieler spielt gerade?
- Ruhezeit seit letztem Match
- Turnierphase
- Matchpriorität
- manuell gesperrte Boards
- abhängige Matches

Spielerstatus:

```text
AVAILABLE
CALLED
PLAYING
RESTING
ABSENT
ELIMINATED
```

---

## 21. Board-QR-Code

Jedes physische Board erhält einen permanenten QR-Code:

```text
https://app.example.com/b/{publicBoardCode}
```

Der QR-Code enthält keine Match-ID.

Das aktive Match wird serverseitig zum Board aufgelöst.

---

## 22. PWA und Offline

Die Score-Oberfläche wird als PWA gebaut.

Ziele:

- installierbar
- Fullscreen
- touch-optimiert
- lokale Assets
- schneller Start
- kurze Netzwerkunterbrüche tolerieren

Offline-Queue:

```text
PendingCommands
├── command 101
├── command 102
└── command 103
```

Beim Reconnect:

```text
Client
↓
Sync
↓
Version Check
↓
Server Commit
```

Vollständig serverloses Turniermanagement ist nicht Ziel des ersten Offline-Modus.

---

## 23. Ranking Engine

Ranking-Regeln sind konfigurierbar.

Beispiel Gruppenranking:

```text
1. Match Points
2. Leg Difference
3. Legs Won
4. Head-to-Head
5. Average
```

Ranking-Logik darf nicht im Frontend liegen.

Der `rankingHistory`-Verlauf aus `packages/statistics` ist eine
**Karriereauswertung, keine ligaweite Rangliste**: er rechnet Elo mit K = 24 ab
1500 paarweise über die Matches der betrachteten Person und führt dabei die
Bewertung des tatsächlichen Gegners mit. Weil die Eingabe nur die Matches dieser
Person enthält, bewegt sich die Gegnerbewertung nur in den gemeinsamen
Begegnungen. Eine ligaweite, konfigurierbare Rangliste gehört in
`packages/ranking-engine` (ROADMAP Phase 10) und existiert noch nicht.

---

## 24. Statistics

Mögliche Statistiken:

- Matches
- Wins / Losses
- Average
- First 9 Average
- Checkout %
- Checkout Attempts
- Highest Checkout
- Highest Score
- 100+
- 120+
- 140+
- 160+
- 180
- Best Leg
- Darts per Leg
- Head-to-Head
- Formkurve
- Career Stats

Später werden Aggregationen asynchron über Worker erzeugt.

---

## 25. Transactional Outbox

Kritische Events werden über Outbox zuverlässig weitergegeben.

```text
BEGIN

INSERT visit
UPDATE leg
INSERT outbox_event

COMMIT
```

Worker verteilt anschließend:

```text
Realtime
Statistics
Notifications
Webhooks
```

Beide Konsumenten führen je Zeile einen Versuchszähler und einen
Dead-Letter-Stempel. Ein Ereignis, das fünfmal scheitert, wird übersprungen
und als `outbox.dead_letter` protokolliert, statt die Schlange anzuhalten.

Beide beanspruchen ihren Stapel mit `FOR UPDATE SKIP LOCKED`: eine zweite
Replik überspringt gesperrte Zeilen, statt dieselben Ereignisse noch einmal zu
senden oder zu aggregieren. Innerhalb des Stapels läuft jedes Ereignis in einem
eigenen Savepoint — ein Postgres-Fehler beendet sonst die ganze Transaktion und
ein einzelnes kaputtes Ereignis kostete den ganzen Durchlauf. Der Fehlversuch
wird noch innerhalb derselben Transaktion gebucht, also unter der Zeilensperre:
Zähler und Backoff stehen in dem Moment, in dem die Sperre fällt, und eine
zweite Replik greift die Zeile nicht ohne Wartezeit erneut.

---

## 26. Background Jobs

BullMQ + Redis.

Jobs:

```text
GenerateStatistics
RebuildRanking
SendNotification
ProcessWebhook
ProcessImport
GenerateExport
GenerateReport
```

---

## 27. Public Portal

Aktuell implementierte öffentliche Routen:

```text
/live/:tournamentId
/live/:tournamentId/board/:boardId
/live/:tournamentId/tv
```

Gruppenranglisten, K.-o.-Tableau, Boardzustände und QR-Codes verwenden eine
schreibgeschützte öffentliche API-Projektion. Spielerprofile unter
`/spieler/:id` sind organisationsgebunden und benötigen eine Sitzung.

---

## 28. TV-Modus

Route:

```text
/live/:tournamentId/tv
```

Eigenschaften:

- Fullscreen
- große Typografie
- keine Navigation
- Live Boards
- nächste Matches
- Resultate
- Sponsoren
- automatische Rotation

---

## 29. Öffentliche Adressierung und Kanal-Autorisierung

Drei zusammengehörende Bausteine — öffentliche Adressen, Anzeige-Schlüssel
und Realtime-Räume — regeln, wer ein Turnier ohne Organisationsmitgliedschaft
sehen und live verfolgen darf. Sie werden hier gebündelt beschrieben, nicht
verteilt über die Abschnitte, zu denen sie thematisch auch gehören (Public
Portal, TV-Modus, Realtime, Security).

### 29.1 `public_id` und Sichtbarkeit

Turniere (wie schon Begegnungen) tragen neben ihrem internen Primärschlüssel
eine zweite, unerratbare `public_id` (UUID). Öffentliche Links, QR-Codes und
Realtime-Räume verwenden ausschließlich diese Adresse; der interne
Primärschlüssel verlässt den Server nicht.

Zwei Sichtbarkeitsstufen, per Check-Constraint erzwungen:

```text
PRIVATE   — Vorgabe für jedes neue Turnier
PUBLIC    — Turnierleitung gibt bewusst frei
```

Ein privates Turnier beantwortet jede öffentliche Anfrage — REST wie
Realtime-Abonnement — mit demselben Ergebnis wie eine unbekannte `public_id`:
404 „nicht gefunden", nie 403 „verboten". Ein Unterschied zwischen den beiden
Fällen würde einem Aussenstehenden verraten, dass unter einer erratenen oder
erratbaren Adresse überhaupt ein Turnier existiert — bereits das ist eine
Information, die eine private Organisation nicht preisgeben will.

### 29.2 Anzeige-Schlüssel

Board-Tablets und TV-Geräte an einem privaten Turnier haben keine eigene
Organisationsmitgliedschaft und sollen auch keine bekommen — sie sind Geräte,
keine Benutzerkonten. Ein Anzeige-Schlüssel ist ein von der Turnierleitung
ausgestelltes, zufälliges Geheimnis, das genau ein solches Gerät berechtigt,
die schreibgeschützten öffentlichen Ansichten eines bestimmten Turniers zu
sehen — unabhängig von dessen Sichtbarkeit.

Die Datenbank speichert nur den Hash des Schlüssels
(`tournament_display_keys.secret_hash`), nie den Klartext; ein Leck der
Tabelle liefert damit keine verwendbaren Schlüssel. Ein Schlüssel kann
widerrufen werden, ohne dass sich das Turnier oder seine Adresse ändert.

Drei Eintrittskarten, alternativ zueinander, entscheiden Zugriff auf ein
privates Turnier:

```text
öffentliche Sichtbarkeit (visibility = PUBLIC)
Organisationsmitgliedschaft
gültiger Anzeige-Schlüssel
```

Ohne explizite Angabe läuft ein Anzeige-Schlüssel 48 Stunden nach
Turnierbeginn ab, gedeckelt gegen „jetzt plus 48 Stunden" (nie in der
Vergangenheit); er lässt sich auch vor Ablauf jederzeit widerrufen.

Bekannte Einschränkung: Widerruf und Ablauf verhindern sofort neue
Abonnements und neuen HTTP-Zugriff, trennen aber einen Socket, der dem
Realtime-Raum bereits mit diesem Schlüssel beigetreten ist, nicht zwangsweise
— er empfängt weiterhin Ereigniszeiger (`{eventId, eventType, occurredAt}`,
keine Matchinhalte), bis er sich von selbst trennt. Ein echter Fix bräuchte
`RealtimeService`/`RealtimeBroadcaster` erreichbar aus `DisplayKeysService`;
da `RealtimeModule` bereits `TournamentsModule` importiert, wäre die
umgekehrte Abhängigkeit zirkulär und verlangt ein eigenes Design (siehe ADR
0013).

### 29.3 Realtime: Räume und Autorisierung

Realtime-Räume sind über `public_id` benannt (`tournament:{publicId}`,
`encounter:{publicId}`), nicht über den internen Primärschlüssel — dieselbe
Adresse, die auch in öffentlichen Links steht.

`decideSubscription` (`packages/domain/src/subscription-access.ts`) trifft
die eigentliche Entscheidung, wer einem Raum beitreten darf, aus genau den
drei Eintrittskarten aus 29.2 plus der Frage, ob die Adresse überhaupt zu
einem Turnier gehört. Die Funktion ist reine Domain-Logik ohne Datenbank- oder
Socket.IO-Abhängigkeit; `SubscriptionAuthorization`
(`apps/api/src/realtime/subscription-authorization.ts`) beschafft die
Eingaben (Sitzung aus dem Handshake-Cookie, Mitgliedschaft, Anzeige-Schlüssel)
und ruft sie auf. Eine abgelehnte Anfrage — wie auch die separate Obergrenze
von 20 Abonnements je Socket (`subscription-limit.ts`) — führt zum bereits
bestehenden Ereignis `subscription:rejected`; es ist kein neues Ereignis
hinzugekommen, nur ein weiterer Ablehnungsgrund
(`SUBSCRIPTION_FORBIDDEN`/`SUBSCRIPTION_UNKNOWN_ROOM` neben
`SUBSCRIPTION_LIMIT_REACHED`).

---

## 30. Security

Mindestanforderungen:

- HTTPS only
- Secure Cookies
- CSRF-Schutz
- Content Security Policy
- Security Headers
- serverseitige Validierung
- Rate Limiting
- RBAC / Permissions
- Tenant Isolation
- einladungsgebundene Registrierung
- Audit Logging
- Secret Management
- Dependency Scanning
- regelmäßige Backups
- Restore-Tests
- keine Secrets im Repository

Security Headers: `apps/api/src/common/security-headers.ts` (Helmet, harte
Content Security Policy) und `apps/web/next.config.ts` (CSP vorerst
Report-Only, siehe Umstellungskriterium dort). Rate Limiting:
`apps/api/src/common/rate-limit.ts` setzt einen prozesslokalen Zähler mit
Stufen (`general`/`public`/`sensitive`) je Route; Better Auths eigener
`customStorage` über Redis zählt verteilt, aber nur für Sign-in und Sign-up.
`TRUST_PROXY_HOPS` bestimmt, welcher `X-Forwarded-For`-Eintrag als
Client-Adresse für beide Zähler gilt und ist in Production Pflicht.

---

## 31. Audit Logging

Kritische Aktionen:

```text
MATCH_RESULT_CHANGED
VISIT_REVERTED
PLAYER_REMOVED
TOURNAMENT_RESET
MATCH_MANUALLY_FINISHED
BOARD_CONTROL_TAKEN_OVER
USER_ROLE_CHANGED
MEMBER_INVITED
MEMBER_DEACTIVATED
MEMBER_REACTIVATED
INTEGRATION_CHANGED
```

Audit-Daten:

```text
organization
actor
action
entityType
entityId
timestamp
oldValue
newValue
ip
userAgent
correlationId
```

---

## 32. Observability

Von Beginn an:

- strukturierte Logs
- Correlation IDs
- Health Endpoints inklusive Outbox-Rückstand je Konsument
- Metrics
- Error Tracking
- später Distributed Tracing

Tech:

```text
OpenTelemetry
Sentry
Grafana optional
```

### Alarmierung

Die API prüft ihren eigenen Health-Zustand jede Minute selbst
(`health-alarm.service.ts`) und meldet ihn ins Log, statt darauf zu warten,
dass jemand `/api/v1/health` abfragt. Das geschieht über genau ein
Ereignis:

```text
health.alarm       status=degraded  → Warnstufe
health.alarm       status=unhealthy → Fehlerstufe
health.recovered   downForSeconds=… → Normalstufe
```

Gemeldet wird bei jedem Statuswechsel und danach alle 15 Minuten erneut,
solange die Störung anhält. Ein Dienst, der bereits beeinträchtigt hochkommt,
meldet sofort; ein gesunder Start meldet nichts.

Scheitert die Messung selbst, gilt das als `unhealthy` und läuft durch
dieselbe Meldung samt Entprellung (`checkFailed: true` im Feld) — ein eigenes
Ereignis stünde ohne Entprellung jede Minute neu im Log.

Diese Logspur trägt die Ursachenanalyse, nicht die Alarmierung: **Railway kann
nicht auf Logmuster alarmieren.** Monitore hängen zwar an jedem
Dashboard-Element, auch an einem Log-Element, ihre Konfiguration kennt aber
ausschliesslich metrische Schwellwerte (`MetricMeasurement` – CPU, RAM, Disk,
Egress) auf den Ressourcen `SERVICE` und `VOLUME`. Die Benachrichtigungsregeln
decken Plattformereignisse ab (Deploy, Volume, Monitor), und native Log-Drains
gibt es nicht. Per GraphQL-Introspektion geprüft am 2026-09-07; Monitore
setzen zudem den Pro-Tarif voraus, der Workspace läuft auf Hobby.

Alarmiert wird deshalb von aussen, über einen Keyword-Monitor bei Better Stack
auf `https://api.dartbase.ch/api/v1/health`:

```text
Bedingung     Antwort enthält "status":"ok" nicht
Takt          alle 3 Minuten
Bestätigung   3 Minuten – zwei Fehlprüfungen, damit ein Deploy nicht meldet
Erholung      3 Minuten
Kanal         E-Mail an den primären Verantwortlichen
```

Der Monitor deckt beide Stufen ab, weil `degraded` zwar HTTP 200 liefert, im
Rumpf aber `"status":"degraded"` steht; `unhealthy` antwortet ohnehin mit 503.
Wird der Statuscode oder das Feld `status` je umbenannt, ist der Monitor
mitzuziehen — er ist die einzige Stelle, die eine Störung nach aussen meldet.
Was das Log dem Monitor voraus hat, sind die Details: `services`, `outbox`,
`checkFailed` und `downForSeconds`, sieben Tage lang im Railway-Log.

Der Wachdienst liegt bewusst in der API und nicht im Worker: der Zustand
entsteht dort, und der CI-Rauchtest greift die Worker-Logs auf Fehlerstufen ab
(`.github/workflows/ci.yml`) — ein Alarm von dort liesse ihn scheitern.

### CSP-Verstösse

`POST /api/v1/csp-reports` nimmt die Verstoss-Meldungen der
Content-Security-Policy entgegen — öffentlich, ohne Anmeldung (der Browser
sendet keine), in der öffentlichen Rate-Limit-Stufe und immer mit 204, auch
auf Unsinn. Die Policy spricht ihn über beide Wege an: `report-uri` für
Browser mit der alten Form und `report-to` samt `Reporting-Endpoints`-Header
für die Reporting-API. Übernommen wird je Meldung eine schmale Auswahl an
Feldern, gekürzt auf 300 Zeichen; die vollständige Policy und der
Script-Ausschnitt bleiben aussen vor, weil letzterer Seiteninhalt tragen kann.
Von den drei Adressfeldern bleiben nur Ursprung und Pfad — Zugangsdaten,
Abfragezeichenkette und Fragment fallen weg, damit ein Einladungscode oder ein
Zurücksetzen-Token aus der Adresszeile nicht in den Betriebslogs landet.
Protokolliert wird als `csp.violation` auf Warnstufe.

Seit 2026-09-07 wird die Policy **erzwungen**. Den Beleg lieferte nicht der
Betrieb — dort besucht niemand planmässig alle Seiten — sondern die
E2E-Suite: die Wache in `apps/web/tests/fixtures.ts` horcht auf
`securitypolicyviolation` und meldete über alle Fälle hinweg ausschliesslich
`script-src → eval` aus dem Übersetzer von `next dev`, keine einzige Meldung
zu `img-src`, `connect-src`, `style-src`, `font-src` oder `default-src`. Der
Produktionsbuild enthält kein `eval`; `'unsafe-eval'` trägt deshalb nur der
Entwicklungsserver (`apps/web/src/lib/content-security-policy.ts`, dort
geprüft). Die Wache bleibt stehen und hält den Beleg aufrecht: wer eine
externe Ressource einbindet, sieht es im E2E-Lauf statt erst im Betrieb.

Gemeldet wird weiterhin über beide Wege — was jetzt als `csp.violation`
auftaucht, hat ein Browser tatsächlich blockiert.

---

## 33. Testing

### Unit

Hohe Testabdeckung für:

- Scoring Engine
- Tournament Engine
- Ranking Engine
- Scheduling Engine

### Integration

- API
- PostgreSQL
- Redis
- Auth

Namenskonvention: `*.integration.spec.ts` bezeichnet Tests, die eine laufende
Datenbank brauchen (`DATABASE_URL`), zum Beispiel
`apps/api/src/boards/boards.integration.spec.ts`; `*.spec.ts` läuft ohne
Infrastruktur. Die HTTP-Grenze -- `AuthGuard`, `@Public()` und der Fehlerfilter
aus §15 -- ist über `apps/api/src/common/http-boundary.integration.spec.ts`
mit einem echten Fastify-Zyklus abgedeckt (`createApiTestApplication`,
Session per Spy auf `AuthService.getSession`); die übrigen Integrationstests
rufen ihre Services direkt auf.

Deployment-Images: CI baut API, Web und Worker nicht nur, sondern startet
jedes Image einmal und prüft es (Health-Endpunkt, Startseite, Startzeile im
Worker-Log).

### Frontend

Hook-Tests heissen `*.hook.spec.ts` und laufen unter `happy-dom`, per
`// @vitest-environment happy-dom`-Pragma je Datei (Tier-1-Konvention,
`@testing-library/react`); die übrige Web-Suite bleibt in der schnelleren
Node-Umgebung. Beispiele: `apps/web/src/lib/use-offline-queue.hook.spec.ts`,
`apps/web/src/lib/use-online-flush.hook.spec.ts`.

Rollenlisten sind in der Oberfläche verboten: eine ESLint-Regel in
`eslint.config.mjs` (`no-restricted-syntax`, Geltungsbereich
`apps/web/src/**/*.{ts,tsx}`) verbietet `[...].includes(role)`-Literale mit
Rollennamen und verweist auf `hasOrganizationPermission` aus
`@darts-platform/domain`. Das ist ein Rückfallschutz gegen eine
Parallelstruktur zum Berechtigungsmodell, keine eigene
Autorisierungsentscheidung -- die trifft weiterhin ausschliesslich der Server.

### End-to-End

Playwright-Szenario:

```text
Turnier erstellen
↓
Spieler hinzufügen
↓
Gruppen generieren
↓
Match starten
↓
Scores erfassen
↓
Match abschließen
↓
Ranking prüfen
↓
KO-Runde generieren
```

---

## 34. Deployment auf Railway

Railway PostgreSQL bleibt die verbindliche Datenbank für Production und
Staging. Neon wird ausschließlich für isolierte Development- und kurzlebige
Preview-Branches eingesetzt. Production-Zugangsdaten und unmaskierte
Production-Daten werden nicht nach Neon übertragen. Die verbindlichen Regeln
stehen in [ADR 0011](./docs/adr/0011-preview-database-strategy.md).

Aktuell angelegte Produktionsstruktur zum 31. August 2026:

```text
BitWhatElse Projects
└── Railway-Projekt: dartbase
    └── Environment: production
        ├── @darts-platform/web
        ├── @darts-platform/api
        ├── @darts-platform/worker
        ├── Postgres
        └── Redis
```

Alle fünf Services sind erfolgreich deployt. Die Railway-IaC bildet den
Live-Stand einschließlich Worker, Domains, Volumes und Service-Konfigurationen
ab; der kontrollierte Production-Plan meldet keine Änderungen. Das separate
Release-Hardening-Plan setzt für die drei GitHub-gebundenen Services später
`checkSuites: true`; bis dieser Plan geprüft, freigegeben und angewendet ist,
darf aus der aktuellen IaC-Konfiguration kein aktives Railway-CI-Gate abgeleitet
werden.

Domain- und DNS-Fluss:

```text
Cyon (Registrar)
  └── NS-Delegation -> Cloudflare (autoritativer DNS, DNS only)
                         ├── dartbase.ch   -> Railway Web
                         ├── *.dartbase.ch -> Railway Web
                         ├── api.dartbase.ch -> Railway API
                         └── _acme-challenge -> Railway DNS Authorization
```

`dartbase.ch` und `*.dartbase.ch` belegen die zwei Custom-Domain-Slots des
Railway-Hobby-Tarifs am Web-Service. Beide Zertifikate sind gültig. Cloudflare
bleibt zunächst für alle Railway-Einträge auf `DNS only`; insbesondere darf der
ACME-CNAME nicht proxied werden. `api.dartbase.ch` ist über einen expliziten
CNAME am API-Service angelegt, verifiziert und mit einem gültigen Zertifikat
erreichbar.

Öffentlich vorgesehen:

```text
dartbase.ch       -> web
*.dartbase.ch     -> web; Hostname-Auflösung und Tenant-Zuordnung erfolgen in der App
api.dartbase.ch   -> api
```

Nur intern:

```text
PostgreSQL
Redis
Worker
interne API-Verbindungen
```

Railway Private Networking wird für Service-to-Service-Kommunikation verwendet.
Die erforderliche öffentliche API-Domain wird als exakter Eintrag am API-Service
konfiguriert; dessen eigene Domain-Slots werden durch Root und Wildcard am
Web-Service nicht verbraucht.

---

## 35. Zielarchitektur Vollausbau

```text
                         Internet
                            │
                        CDN / WAF
                            │
                ┌───────────┴───────────┐
                │                       │
              Web                    Public API
                │                       │
                └───────────┬───────────┘
                            │
                            API
                            │
             ┌──────────────┼──────────────┐
             │              │              │
         Tournament       Scoring       Scheduler
             │              │              │
             └──────────────┼──────────────┘
                            │
                       PostgreSQL
                            │
                          Outbox
                            │
                          Queue
                            │
         ┌──────────────────┼──────────────────┐
         │                  │                  │
     Statistics        Notifications      Integrations
                                             │
                                   ┌─────────┴─────────┐
                                   │                   │
                               Autodarts             Scolia

Realtime Gateway
       │
      Redis
       │
Web / PWA / TV / Public Live
```

---

## 36. Architekturregeln

1. Business-Logik niemals im React UI.
2. Tournament Engine kennt keine Datenbank.
3. Scoring Engine kennt keine Benutzeroberfläche.
4. PostgreSQL ist Source of Truth.
5. Redis ist niemals einzige Quelle kritischer Daten.
6. Alle geschäftlichen Daten sind tenant-isoliert.
7. Jede Mutation wird serverseitig autorisiert.
8. Score-Commands sind idempotent.
9. Aktive Matches verwenden Optimistic Concurrency.
10. Integrationen verwenden Adapter.
11. Drittanbieter ändern keine Domain-Daten direkt.
12. Realtime erst nach erfolgreicher Persistierung.
13. Historische Scores möglichst nicht destruktiv ändern.
14. Kritische Aktionen werden auditiert.
15. Kern-Engines benötigen hohe Unit-Test-Abdeckung.
16. Kein Microservice ohne nachgewiesenen Bedarf.
17. Keine Secrets im Repository.
18. Keine direkte Datenbankverbindung aus dem Frontend.
19. API-Verträge werden versioniert.
20. Neue Architekturentscheidungen werden als ADR dokumentiert.
