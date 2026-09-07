# Öffentliche Turnier-IDs und Kanal-Autorisierung

**Datum:** 2026-09-07
**Audit-Befunde:** I-1 Teil b (`tournaments.public_id` und Sichtbarkeits-Flag), I-2 (Realtime-Kanäle unauthentifiziert, Räume auf internen IDs)
**Tier:** 3
**Status:** Entwurf, zur Freigabe

---

## Problem

Ein Turnier ist heute öffentlich lesbar, sobald jemand seine interne UUID kennt. Die
Route `/api/v1/public/tournaments/:id/live` nimmt die Primärschlüssel-ID entgegen,
und die Weboberfläche trägt sie in `/live/[id]` offen in der Adresszeile. Einen
Entscheid darüber, ob ein Turnier öffentlich sein soll, gibt es nicht — Sichtbarkeit
ist der Nebeneffekt davon, dass niemand die Adresse geheim hält.

Dieselbe interne ID adressiert die Realtime-Räume. `RealtimeService.register`
akzeptiert jedes `tournament:subscribe` mit einer syntaktisch gültigen UUID und prüft
weder Sitzung noch Berechtigung. Wer eine ID kennt, hört mit: nicht den Fachinhalt —
die Nutzlast ist ein Zeiger aus `eventId`, `eventType` und `occurredAt` — aber
lückenlos, wann in einem fremden Turnier was geschieht.

Der dritte Teil des Problems kostet heute schon Funktion. Begegnungen besitzen
bereits eine `public_id`, ihre Räume laufen aber ebenfalls auf der internen ID. Die
öffentliche Begegnungsansicht kennt nur die `public_id`, kommt damit in keinen Raum
und behilft sich mit einem 15-Sekunden-Polling
(`apps/web/src/components/live/live-encounter.tsx`).

## Entscheide

| Frage | Entscheid |
| --- | --- |
| Was steuert die Sichtbarkeit? | Zwei Stufen: `PRIVATE` (Vorgabe) und `PUBLIC`. `PUBLIC` gibt die Ansicht über die `public_id` frei — wer den Link hat, sieht zu. Kein Verzeichnis. |
| Wie kommen Board und TV an ein privates Turnier? | Über einen Anzeige-Schlüssel je Turnier, den die Leitung ausstellt. Kein Anmelden auf geteilten Geräten. |
| Was passiert mit dem Bestand? | Jede Zeile bekommt eine `public_id`, der Bestand wird einmalig `PUBLIC`. `/live/<interne-id>` leitet befristet um. Neue Turniere sind `PRIVATE`. |
| Wie wird ein Abonnement autorisiert? | Nachschlagen und entscheiden beim `subscribe`, Räume nach der `public_id`. Kein signiertes Ticket, kein zweites Schlüsselsystem. |

Verworfen wurde ein signiertes Ticket im Handshake (Ansatz B): es löst ein
Lastproblem, das bei acht Boards nicht existiert, und stellte einen zweiten
Auth-Mechanismus neben Better Auth. Die Socket-Abfrage geschieht einmal je
Verbindung, nicht je Ereignis. Sollte die Last je zum Thema werden, ist der Tausch
hinter derselben Schnittstelle möglich.

## Datenmodell

### `tournaments`

```
public_id   uuid          NOT NULL DEFAULT gen_random_uuid()   -- Unique-Index
visibility  varchar(20)   NOT NULL DEFAULT 'PRIVATE'           -- CHECK (PRIVATE | PUBLIC)
```

Die `public_id` folgt `encounters.public_id`: eine zweite Zufalls-UUID, unabhängig
vom Primärschlüssel. Der Check-Constraint steht in der Datenbank, nicht nur im
Zod-Schema — Datenintegrität gehört dorthin, wo sie nicht zu umgehen ist
(AGENTS.md §10).

### `tournament_display_keys`

```
id               uuid PK
organization_id  uuid NOT NULL  -> organizations(id) ON DELETE CASCADE
tournament_id    uuid NOT NULL  -> tournaments(id)   ON DELETE CASCADE
secret_hash      char(64) NOT NULL          -- SHA-256, Unique-Index
label            varchar(80) NOT NULL       -- "Board 3", "Beamer Saal"
expires_at       timestamptz NOT NULL
revoked_at       timestamptz
created_by       uuid NOT NULL -> users(id)
+ timestamps
```

Der Klartext des Schlüssels existiert genau einmal: in der Antwort, die ihn erzeugt.
Danach steht in der Datenbank nur der Hash — ein Datenbankleck gibt keine Zugänge
her. `expires_at` steht per Vorgabe 24 Stunden nach `starts_at` des Turniers, ist
beim Ausstellen überschreibbar und jederzeit widerrufbar.

Ein Schlüssel gilt für ein Turnier, nicht für ein Board: die Board-Ansicht wählt das
Board über die Adresse, und ein Schlüssel je Board hiesse, an einem Turnierabend acht
Zugänge zu verteilen und acht zurückzuziehen.

### Zugriffspfade

`getTournamentByPublicId({ publicId })` ist bewusst die eine Repository-Funktion
ohne `organizationId`. Die `public_id` *ist* der Schlüssel; der Mandant fällt aus dem
Treffer heraus. Das ist eine benannte Ausnahme von AGENTS.md §14 und gehört im Code
als solche kommentiert. Alle übrigen Abfragen bleiben mandantengebunden.

## Migration

Eine Migration, drei Schritte:

1. Spalten anlegen (`public_id` mit `DEFAULT gen_random_uuid()`, `visibility` mit
   `DEFAULT 'PRIVATE'`), Unique-Index auf `public_id`, Check-Constraint auf
   `visibility`.
2. `UPDATE tournaments SET visibility = 'PUBLIC'` — der Bestand behält sein
   heutiges Verhalten. Der Default bleibt `PRIVATE` und greift ab der nächsten
   Einfügung.
3. `tournament_display_keys` anlegen.

Der Default füllt `public_id` für bestehende Zeilen mit je eigenen Werten; ein
Migrationstest prüft genau das (jede Zeile eine eigene ID, keine Kollision) statt es
anzunehmen.

## API

### Öffentlich

```
GET /api/v1/public/tournaments/:publicId/live
```

Auflösung über `public_id`. `PRIVATE` ohne Nachweis antwortet **404, nicht 403** —
ein 403 bestätigt die Existenz der ID. Nachweis ist entweder eine Sitzung mit
Mitgliedschaft in der Organisation oder ein gültiger Anzeige-Schlüssel im
Query-Parameter.

`publicTournamentDashboardSchema` verliert `tournament.id` und bekommt dafür
`tournament.publicId`. Bliebe die interne ID in der öffentlichen Nutzlast, wäre das
ganze Programm wirkungslos; ohne die `publicId` in der Antwort käme die
Weboberfläche nicht an den Raumnamen und die Übergangs-Umleitung nicht an ihr Ziel.

**Übergangsfrist:** Die Route nimmt weiterhin auch eine interne ID entgegen und
liefert die Antwort samt `publicId`, damit die Weboberfläche umleiten kann. Sie
verschwindet in einem eigenen, kleinen PR — mit einem Datum, nicht mit einem
Vorsatz.

### Authentifiziert

```
PATCH  /api/v1/organizations/:organizationId/tournaments/:tournamentId          { visibility }
GET    /api/v1/organizations/:organizationId/tournaments/:tournamentId/display-keys
POST   /api/v1/organizations/:organizationId/tournaments/:tournamentId/display-keys   { label, expiresAt? }
DELETE /api/v1/organizations/:organizationId/tournaments/:tournamentId/display-keys/:keyId
```

Sichtbarkeit ändern läuft unter dem bestehenden `tournament:update`. Für
Anzeige-Schlüssel kommt `tournament:share` dazu: Zugänge zu verteilen ist eine
andere Handlung als einen Spielplan zu pflegen, und wer das eine darf, muss nicht
zwingend das andere dürfen. Beide Wege werden auditiert (AGENTS.md §4) — eine
Freigabe nach aussen ist eine kritische Benutzeraktion.

## Realtime

### Abonnement

`tournament:subscribe` nimmt `{ publicId }` statt `{ tournamentId }`. Der Server
schlägt nach und entscheidet:

| Sichtbarkeit | Nachweis | Ergebnis |
| --- | --- | --- |
| `PUBLIC` | keiner nötig | Beitritt |
| `PRIVATE` | Sitzung mit Mitgliedschaft in der Organisation | Beitritt |
| `PRIVATE` | gültiger Anzeige-Schlüssel (nicht abgelaufen, nicht widerrufen) | Beitritt |
| `PRIVATE` | keiner | `tournament:denied`, kein Beitritt |
| unbekannte `public_id` | — | `tournament:denied` |

Die Ablehnung wird gemeldet. Heute kehrt `subscribe` bei ungültiger Eingabe still
zurück; ein Client wartet dann ewig auf Ereignisse, die nie kommen — die schlechtere
Variante desselben Fehlers.

Die Entscheidung selbst wird eine reine Funktion in `packages/domain`:

```ts
type SubscriptionDecision = "allow" | "deny";

function decideSubscription(input: {
  readonly visibility: "PRIVATE" | "PUBLIC";
  readonly membership: "member" | "none";
  readonly displayKey: "valid" | "expired" | "revoked" | "unknown" | "absent";
}): SubscriptionDecision;
```

Ohne Datenbank, ohne Socket.IO, erschöpfend testbar — dasselbe Muster wie
`scoring-engine` und `event-routing.ts`.

### Räume und Relay

Räume heissen `tournament:<public_id>` und `encounter:<public_id>`. Das trifft das
Outbox-Relay: `resolveScope` liefert heute für ein Turnier-Ereignis die interne ID
ohne Abfrage zurück und braucht künftig die Abbildung. Ein prozesslokaler
`Map`-Cache trägt sie — die Zuordnung interne ID → `public_id` ändert sich nie.

Begegnungen werden gleich behandelt. Sie haben die `public_id` bereits; ihre Räume
laufen nur noch nicht darauf. Die öffentliche Begegnungsansicht verliert damit ihr
15-Sekunden-Polling und wird tatsächlich live — der sichtbarste Gewinn des
Programms, und er fällt hier nebenbei ab.

### Sitzung im Handshake

Das ist das einzige echte Neuland. Heute hängt am Handshake nur die
Rate-Limit-Bremse (`createHandshakeGate`). Für den privaten Fall muss der Socket die
Better-Auth-Sitzung aus `socket.handshake.headers.cookie` auflösen und die
Mitgliedschaft prüfen. Der Socket verbindet bereits mit `withCredentials: true`, das
Cookie liegt also an; gebraucht wird die Auflösung über den vorhandenen
`AuthService` und den `OrganizationAccessService`.

## Weboberfläche

- `/live/[id]` wird `/live/[publicId]`. Das alte Segment löst auf und leitet um,
  bis es entfernt wird.
- Board und TV: `/live/[publicId]/board/[boardId]?k=…`. Die Seite legt den Schlüssel
  je Turnier lokal ab und räumt ihn aus der Adresszeile, damit ein Neuladen ihn
  nicht braucht und die Adresszeile ihn nicht dauerhaft zeigt.
- Neu im Turnier-Dashboard ein Freigabe-Bereich: Sichtbarkeit umschalten,
  öffentlichen Link kopieren, Schlüssel ausstellen (Klartext genau einmal sichtbar,
  mit Kopieren-Knopf und dem Hinweis, dass er nicht wieder angezeigt wird),
  bestehende Schlüssel mit Bezeichnung, Ablauf und Widerruf auflisten.
- Der Verbindungszustand zeigt eine abgelehnte Anmeldung als solche an, nicht als
  „getrennt".

## Tests

| Ebene | Inhalt |
| --- | --- |
| Domain | `decideSubscription` erschöpfend über alle Kombinationen aus Sichtbarkeit, Mitgliedschaft und Schlüsselzustand. |
| Datenbank | Migrationstest: Bestand wird `PUBLIC`, jede Zeile bekommt eine eigene `public_id`, Unique-Index greift. |
| API | Öffentliche Route über `public_id`; `PRIVATE` ohne Nachweis → 404; mit Mitgliedschaft → 200; mit gültigem Schlüssel → 200; abgelaufen und widerrufen → 404. Öffentliche Nutzlast enthält keine interne ID. |
| API | Anzeige-Schlüssel: Ausstellen, Auflisten, Widerrufen; `tournament:share` wird geprüft; der Klartext erscheint genau einmal. |
| Realtime | Die vier Abonnementwege; Raumname trägt die `public_id`; Relay bildet interne ID korrekt ab; `tournament:denied` kommt an. |
| E2E | Öffentlicher Link anonym erreichbar; privater nicht; Board-Ansicht mit Schlüssel; Begegnungsansicht aktualisiert ohne Polling. |

## Ausdrücklich nicht in diesem Programm

- Kein öffentliches Turnierverzeichnis auf dartbase.ch. Der Sprung von „per Link"
  auf „gelistet" ist eine Produktentscheidung mit eigener Seite, Sortierung und der
  Frage, was ein Fremder über einen fremden Verein sehen darf.
- Keine Schlüsselrotation über Ausstellen und Widerrufen hinaus.
- Keine Sichtbarkeit für Ligen und Begegnungen — dort ändert sich nur der Raumname.
  Die Liga ist per Reglement öffentlich.
- I-7 (zusammengesetzte Fremdschlüssel, Mandanten-Kohärenz in der Datenbank) bleibt
  sein eigenes Programm.
- Die CSP-Nonce, die im Sicherheitsplan neben der Erzwingung stand, gehört nicht
  hierher (die Erzwingung ist seit 2026-09-07 erledigt).

## Risiken

**Die Sitzungsauflösung im Socket-Handshake ist neu.** Alles andere folgt Mustern,
die im Repo bereits stehen. Wenn dieser Teil sich als aufwendiger erweist als
gedacht, ist die Reihenfolge im Plan so zu wählen, dass der öffentliche Fall
(`PUBLIC` ohne Nachweis) zuerst vollständig läuft — er trägt den Grossteil des
Nutzens, inklusive der Begegnungsansicht ohne Polling.

**Die Übergangsroute ist eine Frist, kein Zustand.** Solange sie steht, bleibt die
interne ID ein gültiger Adressweg. Sie gehört mit Datum in die Liste der offenen
Punkte, sonst steht sie in einem Jahr noch.

**Die Vorgabe `PRIVATE` ändert das Verhalten für neue Turniere.** Wer bisher ein
Turnier anlegte und den Link weitergab, muss künftig einmal freigeben. Das ist
gewollt, gehört aber in die Freigabe-Oberfläche so erklärt, dass es nicht wie ein
Fehler aussieht.
