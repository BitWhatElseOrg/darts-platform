# Spec: Scheiben-Tablets scoren ohne Benutzer-Login

Stand: 30.09.2026.

## Problem

Im Dartraum ist pro Scheibe ein Tablet fest montiert. Heute muss sich an jedem
Tablet eine Person mit eigenem Konto anmelden, bevor sie scoren kann: Jede
Mutation verlangt eine Better-Auth-Session (`AuthGuard`, Rolle `SCORER`). Wer
gerade schreibt, hat oft kein Konto oder kennt sein Passwort nicht, und eine
dauerhaft angemeldete Person am Tablet gibt ihre vollen Rechte an jeden im
Raum weiter.

## Ziel

Ein Tablet wird einmal einer Scheibe zugeordnet ("gekoppelt") und scort danach
ohne Anmeldung jedes Match, das dieser Scheibe zugewiesen ist – in allen Modi:
freies Match, Turniermatch, Liga-Encounter-Slot.

## Entscheide aus dem Brainstorming

| Frage | Entscheid |
|---|---|
| Umfang | Das Tablet scort nur Matches, die jemand anders der Scheibe zugewiesen hat. Es startet, übernimmt und bricht keine Matches ab. |
| Modi | Alle: freies Match mit `boardId`, Turnierzuweisung, Encounter-Slot-Zuweisung. |
| Akteur im Audit | Das Gerät (die Scheibe). Welche Person geschrieben hat, wird nicht erfasst. |
| Plattform | Heute iPad, Android muss ebenso funktionieren. Beide als installierte Web-App (Home-Screen/PWA). |
| Identität | Eigener Geräteschlüssel als zweiter Principal-Typ neben Better Auth (Ansatz 1). Verworfen: verstecktes Benutzerkonto pro Scheibe (Scheinbenutzer, ablaufende Sessions, umgeht ADR 0010) und kurzlebige Tokens aus einem Geräteschlüssel (verkompliziert die Offline-Queue ohne nennenswerten Gewinn bei offen zugänglichem Gerät). |
| Kopplung | Eine Admin-Person meldet sich einmal auf dem Tablet an und richtet es ein. Keine Kopplungscodes. Ein QR-Kopplungsweg kann später ohne Bruch dazukommen. |

Grundlage im Bestand: Jede dieser Zuweisungen legt eine Zeile in `matches` mit
`board_id` an, und `matches_board_in_progress_unique` garantiert höchstens ein
laufendes Match je Scheibe. Das Tablet muss also nur fragen: «Welches Match
läuft gerade auf meiner Scheibe?»

## 1. Datenmodell

### Neue Tabelle `board_devices`

| Spalte | Typ | Bemerkung |
|---|---|---|
| `id` | uuid PK | |
| `organization_id` | uuid not null, FK `organizations` `on delete cascade` | |
| `board_id` | uuid not null, FK `boards` `on delete cascade` | |
| `secret_hash` | char(64) not null | SHA-256 des Geheimnisses, hex. Unique. |
| `label` | varchar(80) not null | z. B. «iPad Scheibe 3», Vorgabe aus dem Board-Namen |
| `created_by` | uuid not null, FK `users` `on delete restrict` | wie `tournament_display_keys.created_by` |
| `revoked_at` | timestamptz null | |
| `last_seen_at` | timestamptz null | höchstens einmal pro Minute aktualisiert |
| `created_at`, `updated_at` | timestamps | |

Constraints und Indexe:

- `board_devices_secret_hash_unique` auf `secret_hash`.
- `board_devices_board_active_unique` auf `board_id` `where revoked_at is null`:
  höchstens ein aktives Gerät je Scheibe.
- `board_devices_secret_hash_format_check`: `secret_hash ~ '^[a-f0-9]{64}$'`.
- `board_devices_label_not_empty`: `length(trim(label)) > 0`.
- Index auf `organization_id`.
- Die Organisation des Geräts muss die der Scheibe sein. Durchgesetzt über
  einen zusammengesetzten Fremdschlüssel `(board_id, organization_id)` auf
  `boards (id, organization_id)`. Dafür bekommt `boards` einen neuen Unique-Index
  `boards_id_organization_unique` auf `(id, organization_id)`; heute gibt es
  nur `boards_organization_name_unique`.

Kein Ablaufdatum: Die Geräte sind fest montiert. Geschützt wird über Widerruf
und die Sichtbarkeit von `last_seen_at` in der Organisationsverwaltung (Abschnitt «Scheiben-Tablets»).

### Geheimnis

- 32 zufällige Bytes, base64url, Präfix `bd_` (z. B. `bd_Xk3…`). Das Präfix
  macht den Schlüssel in Logs und bei Secret-Scannern erkennbar.
- Gespeichert wird nur der SHA-256-Hash. Den Klartext gibt es einmal, in der
  Antwort, die das Gerät anlegt – wie bei `tournament_display_keys`.

### Änderungen an bestehenden Tabellen

- `board_controller_leases`: `user_id` wird nullable, neue Spalte `device_id`
  (FK `board_devices` `on delete cascade`). Check
  `board_controller_leases_actor_check`: genau eine der beiden Spalten ist
  gesetzt.
- `audit_events`: neue Spalte `actor_device_id` (FK `board_devices`
  `on delete set null`). Check `audit_events_single_actor_check`: nicht beide
  Akteur-Spalten gleichzeitig gesetzt. Beide leer bleibt zulässig (System-
  Ereignisse und Akteure, die gelöscht wurden, gibt es schon heute).

Beides sind reine Erweiterungen in einer neuen Migration, keine bestehende
Migration wird geändert.

## 2. Kopplung und Widerruf

### Einrichten (auf dem Tablet)

1. Die Admin-Person öffnet auf dem Tablet die installierte Web-App und meldet
   sich an.
2. Organisationsverwaltung (Abschnitt «Scheiben-Tablets») → Scheibe → «Dieses Gerät einrichten». Der Button ist nur
   aktiv, wenn die App installiert läuft (`display-mode: standalone`). Im
   normalen Browser steht dort ein Hinweis, die App zuerst zu installieren,
   weil iOS die Daten von Browser und installierter App trennt.
3. `POST /api/v1/organizations/:organizationId/boards/:boardId/devices` mit
   `{ label }`. Erfordert `board:manage`. In einer Transaktion:
   - Ein bestehendes aktives Gerät der Scheibe wird widerrufen (`revoked_at`).
   - Das neue Gerät wird angelegt.
   - Audit `BOARD_DEVICE_REVOKED` (falls ein Gerät ersetzt wurde) und
     `BOARD_DEVICE_PAIRED`, Akteur ist die Admin-Person.
   - Antwort: `{ device: { id, boardId, label, createdAt }, secret }`.
4. Das Tablet speichert das Geheimnis, meldet die Admin-Session ab
   (`signOut`) und wechselt nach `/scheibe`.

### Widerruf

- `DELETE /api/v1/organizations/:organizationId/boards/:boardId/devices/:deviceId`,
  erfordert `board:manage`, setzt `revoked_at`, Audit `BOARD_DEVICE_REVOKED`.
  Antwort `204`. Ein bereits widerrufenes Gerät erneut zu widerrufen ist
  ebenfalls `204` (idempotent) ohne zweiten Audit-Eintrag.
- Organisationsverwaltung (Abschnitt «Scheiben-Tablets») zeigt pro Scheibe «Gekoppelt · zuletzt gesehen vor …» oder
  «Kein Gerät» und den Button «Entkoppeln» mit Bestätigung. Die Liste kommt aus
  `GET /api/v1/organizations/:organizationId/board-devices` (erfordert
  `board:manage`; aktive Geräte mit `id`, `boardId`, `label`, `createdAt`,
  `lastSeenAt`). Das bestehende `boardSchema` bleibt unverändert.

### Lokales Zurücksetzen

Auf dem Tablet: langes Drücken auf den Scheibennamen → «Gerät zurücksetzen».
Löscht nur den lokalen Schlüssel und führt zur Startseite. Der Schlüssel bleibt
serverseitig gültig, bis er in der Organisationsverwaltung (Abschnitt «Scheiben-Tablets») entkoppelt oder durch ein
neues Einrichten ersetzt wird. Der Dialog sagt das so.

## 3. Autorisierung

### Principal

`AuthContext` bleibt der Benutzer-Kontext wie heute (Better-Auth-Session).
Dazu kommt ein Geräte-Kontext, beide zusammen bilden die Union `Principal`:

```ts
interface DeviceAuthContext {
  readonly device: AuthenticatedDevice;
}

interface AuthenticatedDevice {
  readonly id: string;
  readonly organizationId: string;
  readonly boardId: string;
}

type Principal = AuthContext | DeviceAuthContext;
```

Unterschieden wird über `isDevicePrincipal(principal)` (`"device" in
principal`). So bleiben die bestehenden Services, Tests und Aufrufer, die
`AuthContext` erzeugen, unverändert gültig. Nur die freigegebenen Pfade nehmen
`Principal` entgegen.

### Guard

1. Öffentliche Endpunkte: unverändert.
2. Header `Authorization: Bearer bd_…` vorhanden → Hash bilden, aktives Gerät
   suchen. Gefunden: Geräte-Principal. Nicht gefunden oder widerrufen: `401`
   mit Code `DEVICE_REVOKED`. Kein Rückfall auf ein Cookie.
3. Sonst: Better-Auth-Session wie heute.
4. Geräte-Principal auf einem Handler ohne `@AllowDevice()`: `403` mit Code
   `DEVICE_NOT_ALLOWED`.

Damit ist jeder neue Endpunkt für Geräte gesperrt, bis er ausdrücklich
freigegeben wird.

- `@CurrentAuth()` liefert in Handlern ohne `@AllowDevice()` weiterhin den
  Benutzer-Kontext (`AuthContext`), damit bestehender Code die Union
  nicht auswerten muss.
- In freigegebenen Handlern liefert `@CurrentPrincipal()` die Union.
- `last_seen_at` wird im Guard aktualisiert, wenn der gespeicherte Wert älter
  als 60 s ist.
### Rate-Limiting

Das bestehende Rate-Limiting (`apps/api/src/common/rate-limit.ts`) zählt je
Stufe und Client-IP, die allgemeine Stufe erlaubt 300 Anfragen pro Minute.
Alle Tablets eines Dartraums teilen sich eine öffentliche IP. Ein Tablet
erzeugte nach rechnerischer Schätzung während eines Matches rund 55
Anfragen pro Minute (Heartbeat 3 s = 20, Selbstauskunft `/me` 5 s = 12,
Match-Poll 4 s = 15, Würfe/Nachladen ~6–10), im Leerlauf rund 12. Live
gemessen (E2E-Fall `board-device-kiosk.spec.ts`, Nacharbeit-Brief Paket B,
B1): rund 46 Anfragen pro Minute im Match ohne Eingaben, rund 12 im
Leerlauf. Bei acht
Scheiben und den Handys der Leitung im selben WLAN wäre die Grenze erreicht.

Entscheid:

- Anfragen mit einem **gültigen** Geräteschlüssel auf Pfaden der allgemeinen
  Stufe zählen in einer eigenen Stufe `device`. Auf Pfaden der Stufen
  `sensitive` (Anmeldung, Passwort-Reset, Einladungen) und `public` bleibt der
  IP-Schlüssel, sonst hebelte ein Geräteschlüssel deren enge Grenzen aus. Der Zähler-Schlüssel ist die Geräte-ID, nicht die IP. Die Grenze ist
  `RATE_LIMIT_DEVICE_MAX_PER_MINUTE`, Vorgabe 120 pro Gerät.
- Der Rate-Limiter läuft vor dem Guard. Er ordnet einen `bd_…`-Schlüssel
  deshalb über einen eigenen Nachschlag ein, der das Ergebnis (Gerät oder
  «unbekannt») 30 s im Prozess zwischenspeichert. Dieser Speicher dient nur der
  Einordnung. Der Guard prüft jede Anfrage frisch gegen die Datenbank, damit
  ein Widerruf sofort wirkt.
- Ein unbekannter oder widerrufener Schlüssel zählt wie eine Anfrage ohne
  Schlüssel in der bestehenden Stufe pro IP. Zufällige Schlüssel umgehen die
  IP-Grenze damit nicht.
- Die Vorgabe 120 wurde gegen die gemessene Anfragenzahl eines Kiosk-Tablets
  geprüft (siehe oben, B1): mit rund 46/min im Match und rund 12/min im
  Leerlauf bleibt komfortabel Abstand, eine Anpassung ist nicht nötig.

### Freigegebene Routen

| Route | Recht | Bindung |
|---|---|---|
| `GET /board-devices/me` (neu) | – | liefert Gerät, Scheibe, Organisation und das laufende Match der Scheibe oder `null` |
| `GET /organizations/:org/matches/:matchId` | `match:read` | `match.board_id = device.board_id` |
| `POST …/matches/:matchId/visits` | `match:score` | wie oben und Match `IN_PROGRESS` |
| `POST …/matches/:matchId/leg-start` | `match:score` | wie oben |
| `POST …/matches/:matchId/leg-by-bull` | `match:score` | wie oben |
| `POST …/matches/:matchId/undo` | `match:undo` | wie oben und Match `IN_PROGRESS` |
| `POST …/matches/:matchId/controller-lease` | `match:score` | wie oben |
| `GET …/players/:playerId/statistics/frequent-scores` | `statistics:read` | Spieler nimmt am laufenden Match der Scheibe teil |

Nicht freigegeben, unter anderem: `POST …/matches` (anlegen), `…/abort`,
jede Turnier-, Encounter-, Spieler-, Board- und Mitgliederroute, der
Statistik-Gesamtabruf.

Undo ist für das Gerät nur im laufenden Match erlaubt. Ein Undo nach
Match-Ende würde bei einem Liga-Slot das Match wieder öffnen, den Slot aber
auf `COMPLETED` stehen lassen (`completeEncounterSlotForMatch` greift beim
nächsten Checkout nicht mehr), und wäre am offen zugänglichen Tablet ohne
Zeitgrenze möglich. Korrekturen nach Match-Ende bleiben bei der Leitung.

Der Match-Abruf ist bewusst auch für beendete Matches der eigenen Scheibe
erlaubt, damit die Endstand-Ansicht nach einem Neuladen funktioniert. Beendete
Matches anderer Scheiben bleiben gesperrt.

### Prüfung im Service

- Im Domain-Paket: `devicePermissions = ["match:read", "match:score",
  "match:undo", "statistics:read"] as const` und eine reine Funktion
  `decideDeviceMatchAccess({ action, deviceBoardId, matchBoardId,
  matchStatus })` mit `action` aus `"read" | "write"` und exhaustive
  Ergebnis-Union (`ALLOWED`, `BOARD_MISMATCH`, `MATCH_NOT_ACTIVE`).
  Statusregel: `read` jeder Status; `write` (Wurf, Undo, Leg-Entscheid, Lease)
  nur `IN_PROGRESS`.
- `requirePermission` in den Services erhält einen zweiten Zweig: Beim Benutzer
  wie heute über die Mitgliedschaft, beim Gerät über `devicePermissions`
  und `decideDeviceMatchAccess`.
- Die Bindung an die Scheibe wird bei schreibenden Aktionen innerhalb
  derselben Transaktion geprüft, in der das Match gesperrt und geschrieben
  wird. So kann eine Freigabe der Scheibe zwischen Prüfung und Schreibzugriff
  nicht durchrutschen.
- `organizationId` im Pfad ungleich `device.organizationId` → `404`, wie bei
  fremden Tenants heute.
- Match gehört nicht zur Scheibe → `403 DEVICE_BOARD_MISMATCH`. Status passt
  nicht zur Aktion → `409 DEVICE_MATCH_NOT_ACTIVE`.

### Audit und Lease

- Neuer Helfer `auditActor(principal)` liefert `{ actorUserId, actorDeviceId }`.
  Er ersetzt die direkten `actorUserId: input.auth.user.id` im
  Match-Repository. Das gilt auch für die Folgeschritte in Turnier und
  Encounter, die bei Match-Ende in derselben Transaktion auditiert werden.
- Scoring schreibt schon heute pro Wurf Audit-Einträge (`SCORE_VISIT_RECORDED`,
  `SCORE_VISIT_REVERTED`, Leg-Entscheide, Lease-Übernahmen). Beim Gerät tragen
  sie `actor_device_id`.
- Die Controller-Lease speichert beim Gerät `device_id` statt `user_id`. Die
  Karenz-Logik (`LEASE_GRACE_MS`) bleibt unverändert.
- `score_commands` und `visits` referenzieren keinen Benutzer und bleiben
  unverändert. Idempotenz (`commandId`) und Versionsprüfung
  (`expectedVersion`) gelten beim Gerät genauso.

### CORS

`allowedHeaders` in `apps/api/src/common/configure-application.ts` lässt heute
nur `Content-Type`, `X-Correlation-Id` und `X-Dartbase-Invitation-Claim` zu.
`Authorization` kommt dazu, ausserdem `maxAge: 600`, damit der Browser den
Preflight, den `Authorization` erzwingt, zehn Minuten zwischenspeichert. Cookies bleiben wie heute `credentials: include`.

## 4. Kiosk-Oberfläche

### Route `/scheibe`

Eigene Seite ohne App-Navigation, Organisationswechsel und Login-Hinweise.
Ist ein Geräteschlüssel gespeichert und läuft die Seite als installierte App,
leitet die Startseite dorthin weiter. Im normalen Browser nicht: Android teilt
den Speicher zwischen Tab und App, und ein Admin am Tablet soll die normale
Oberfläche erreichen. Die Scoreboard-Kopfzeile zeigt im Kiosk keine Links
(«LIVE», «Bedienungsanleitung»), die aus dem Kiosk hinausführen.

| Zustand | Anzeige |
|---|---|
| Laden | Scheibenname aus dem lokalen Speicher, Ladeindikator |
| Leerlauf | «Scheibe 3 – wartet auf nächstes Match». `GET /board-devices/me` alle 5 s, solange die Seite sichtbar ist – auch während eines Matches, damit ein Abbruch oder eine Freigabe durch die Leitung auffällt. |
| Match läuft | Bestehende `MatchScoreboard`-Komponente. Organisation und Rechte kommen aus `/board-devices/me`. Das Abbrechen-Menü ist ausgeblendet. |
| Match beendet | Endstand bleibt 30 s stehen oder bis jemand «Weiter» tippt, dann zurück in den Leerlauf. |
| Nicht mehr gekoppelt | «Dieses Tablet ist nicht mehr gekoppelt – bitte in der Organisationsverwaltung unter «Scheiben-Tablets» neu einrichten.» Offene Einträge der Offline-Queue bleiben sichtbar. |

Kopfzeile in allen Zuständen: Name der Scheibe, Name der Organisation und der
bestehende Verbindungsindikator.

Ein Realtime-Kanal pro Scheibe würde das Polling ersetzen. Er ist bewusst nicht
Teil dieser Spec: 5 s Verzögerung beim Übernehmen eines Matches reicht, und
nachrüsten lässt er sich später ohne Bruch.

### Client

- `apps/web/src/lib/device-key-storage.ts` nach dem Muster von
  `display-key-storage.ts`: `localStorage`, Schlüssel
  `dartbase.board-device`, gespeichert als `{ secret, boardName,
  organizationName }`, jeder Zugriff in `try/catch`.
- `apiRequest` erhält einen optionalen Parameter `deviceSecret`. Nur die
  Kiosk-Route übergibt ihn, und dann setzt `apiRequest` den Bearer-Header.
  Kein globaler Mechanismus: Eine Admin-Sitzung auf demselben Tablet tritt so
  nie versehentlich als Gerät auf.
- `MatchScoreboard`, `useMatchScoring`, `useBoardControllerLock` und die
  Offline-Queue erhalten den Zugangskontext als Parameter statt ihn implizit
  aus der Session zu holen. Die bestehende Route übergibt «Session», die
  Kiosk-Route «Gerät».
- Die Offline-Queue (IndexedDB) ist nicht an eine `userId` gebunden und bleibt
  in der Struktur unverändert. Die Wiedergabe schickt den Geräteschlüssel mit,
  wenn der Eintrag aus dem Kiosk stammt.

### Plattform

- iPad: Safari → Teilen → «Zum Home-Bildschirm». Android: Chrome →
  «App installieren». Das bestehende `manifest.ts` wird geprüft
  (`display: standalone`, Icons, `start_url`).
- Die Sperre auf Systemebene ist Betriebsdoku, kein Code: iPad «Geführter
  Zugriff», Android «App anheften» oder ein Kiosk-Browser.

## 5. Fehlerfälle

| Situation | Verhalten |
|---|---|
| Gerät widerrufen oder Schlüssel unbekannt | `401 DEVICE_REVOKED`. Das Tablet löscht den lokalen Schlüssel und zeigt den Zustand «Nicht mehr gekoppelt». Queue-Einträge bleiben sichtbar. |
| Match während des Scorens beendet oder abgebrochen (Walkover, Slot-Freigabe, Abbruch durch die Leitung) | Match lesen liefert `404` (abgebrochene Matches sind nicht lesbar), Schreiben `409 DEVICE_MATCH_NOT_ACTIVE`. `matches.board_id` wird nie genullt, `403 DEVICE_BOARD_MISMATCH` entsteht nur bei einem Match einer anderen Scheibe. Das Tablet lädt `/board-devices/me` neu und wechselt in den Leerlauf oder zum neuen Match. Offene Queue-Einträge für das alte Match werden als abgelehnt angezeigt, nicht still verworfen. |
| Versionskonflikt | Wie heute: `409` mit Serverzustand, Client synchronisiert. |
| Anderes Gerät oder Handy hält die Controller-Lease | Wie heute: «Ein anderes Gerät steuert dieses Board», Übernahme möglich. |
| Scheibe gelöscht | Gerät fällt per `cascade` weg, nächste Anfrage `401`. |
| Organisation gelöscht | Gerät fällt per `cascade` weg. Tabelle kommt ins Löschkonzept (ADR 0018). |
| Gerät ruft nicht freigegebene Route auf | `403 DEVICE_NOT_ALLOWED`. |
| `localStorage` nicht verfügbar oder geleert | Tablet zeigt die normale Startseite. Neu einrichten stellt den Betrieb wieder her und ersetzt das alte Gerät serverseitig. |

## 6. Tests

- **Domain (Vitest):** Inhalt von `devicePermissions`; `decideDeviceMatchAccess`
  für alle Ergebnisse, inklusive Negativfälle.
- **API-Integration (Testcontainers):**
  - Einrichten erfordert `board:manage`, gibt das Geheimnis einmal zurück und
    widerruft ein bestehendes Gerät der Scheibe in derselben Transaktion.
  - Widerruf ist idempotent und auditiert einmal.
  - Bearer-Auflösung; widerrufenes Gerät `401`; ungültiger Schlüssel neben
    gültigem Cookie `401` (kein Rückfall).
  - `/board-devices/me` liefert das laufende Match der Scheibe bzw. `null`.
  - Scoren, Undo, Leg-Entscheid auf der eigenen Scheibe gelingen: im freien
    Match, im Turniermatch und im Encounter-Slot.
  - Scoren auf einer fremden Scheibe, in einer fremden Organisation und in
    einem beendeten Match schlägt fehl.
  - `abort` und `POST …/matches` sind verboten.
  - `frequent-scores` nur für Teilnehmende des laufenden Matches.
  - Rate-Limit: Anfragen mit gültigem `bd_…` zählen pro Gerät in der Stufe
    `device`, nicht gegen die allgemeine Grenze der IP; ein unbekannter
    Schlüssel zählt pro IP.
  - Undo und Scoren in einem beendeten Match schlagen mit
    `DEVICE_MATCH_NOT_ACTIVE` fehl.
  - Gleiche `commandId` vom Gerät erzeugt keinen zweiten Visit.
  - Lease mit `device_id`; Audit-Einträge tragen `actor_device_id`.
  - Constraints: ein aktives Gerät je Scheibe, genau ein Akteur bei der Lease,
    höchstens ein Akteur im Audit, Gerät und Scheibe in derselben
    Organisation.
- **Tenant-Isolationsmatrix:** Geräte-Principal als zusätzliche Zeile, geprüft
  gegen alle bestehenden Endpunkte. Nur die Routen aus Abschnitt 3 dürfen
  offen sein.
- **Web (Vitest):** `device-key-storage`; Bearer-Header nur bei übergebenem
  `deviceSecret`; Zustandswechsel Leerlauf → Match → Endstand → Leerlauf;
  Verhalten bei `401` und `403 DEVICE_BOARD_MISMATCH`.
- **E2E (Playwright):** Admin richtet ein Gerät ein → Turnierleitung weist ein
  Match der Scheibe zu → Kiosk übernimmt es → ein Leg wird gescort → Gerät
  wird entkoppelt → Kiosk zeigt «Nicht mehr gekoppelt». Dasselbe mit einem
  Liga-Slot.

## 7. Vorabprüfung auf einem echten iPad

Vor dem Implementierungsplan, auf Staging:

1. Die Web-App als Home-Screen-App installieren, einen Testwert in
   `localStorage` schreiben.
2. Prüfen, ob er nach Schliessen der App, nach Neustart des iPads und nach
   einem iOS-Update erhalten bleibt.
3. Prüfen, ob `localStorage` der installierten App vom Safari-Tab getrennt ist.
4. Den Test über mehr als 7 Tage ohne Nutzung laufen lassen. Das lässt sich
   nicht beschleunigen und läuft parallel zur Umsetzung. Fällt der Wert weg,
   wird die Speicherung überarbeitet, bevor das Feature produktiv geht.
5. Dasselbe auf einem Android-Tablet mit Chrome, sobald eines verfügbar ist.

Zeigt die Prüfung, dass `localStorage` nicht hält, ist die Alternative ein
HttpOnly-Cookie der API. Dann muss geklärt werden, ob Safari es wegen
unterschiedlicher IPs von Web- und API-Domain auf 7 Tage begrenzt.

## 8. Dokumentation

- ADR 0019 «Scheiben-Geräte als eigener Principal».
- Betriebsdoku: Tablet einrichten (iPad und Android), Kiosk-Sperre,
  Entkoppeln, was bei «Nicht mehr gekoppelt» zu tun ist.
- Löschkonzept (ADR 0018): `board_devices` ergänzen.
- `AGENTS.md` Abschnitt 13: Hinweis auf den Geräte-Principal und
  `@AllowDevice()`.

## Nicht Teil dieser Spec

- Matches am Tablet starten oder Turnier- bzw. Liga-Spiele am Tablet
  übernehmen.
- Kopplung per QR-Code oder Kurzcode.
- Realtime-Kanal pro Scheibe.
- Erfassen, welche Person gescort hat.
- Anbindung automatischer Scoring-Systeme (Autodarts, Scolia).
