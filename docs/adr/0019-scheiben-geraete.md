# ADR 0019: Scheiben-Geräte als eigener Principal

**Status:** Accepted
**Datum:** 30. September 2026

## Kontext

Pro Scheibe steht im Dartraum ein fest montiertes Tablet. Bis hierher musste
sich dort jedes Mal eine Person mit eigenem Benutzerkonto anmelden
(Better-Auth-Session, Rolle `SCORER`), bevor sie scoren konnte — wer gerade
schreibt, hat oft kein Konto zur Hand, und eine dauerhaft angemeldete Person
gibt ihre vollen Rechte an jeden im Raum weiter. Die Spec
`docs/superpowers/specs/2026-09-30-scheiben-tablet-design.md` führt dafür
einen zweiten Principal-Typ neben dem Benutzer ein: das Gerät selbst.

Grundlage im Bestand: Jede Zuweisung — freies Match, Turniermatch,
Liga-Encounter-Slot — legt eine Zeile in `matches` mit `board_id` an, und
`matches_board_in_progress_unique` garantiert höchstens ein laufendes Match
je Scheibe. Ein Tablet muss deshalb nur fragen: «Welches Match läuft gerade
auf meiner Scheibe?» (`GET /board-devices/me`).

## Entscheidung

- **Zweiter Principal statt Scheinbenutzer.** `AuthContext` (Benutzer) und
  ein neuer `DeviceAuthContext` (`{ device: AuthenticatedDevice }`) bilden
  zusammen die Union `Principal`, unterschieden über `isDevicePrincipal`.
  Verworfen: ein verstecktes Benutzerkonto pro Scheibe — es bräuchte
  ablaufende Sessions wie ein echtes Konto und umginge ADR 0010
  (Invite-Only-Registrierung) durch die Hintertür, ohne dass dafür je eine
  Einladung existierte. Ebenfalls verworfen: kurzlebige Tokens aus einem
  Geräteschlüssel — das verkompliziert die Offline-Queue, ohne an einem
  offen zugänglichen Tablet einen nennenswerten Sicherheitsgewinn zu bringen.
- **`@AllowDevice()` als geschlossene Standardeinstellung.** Trägt ein
  Header `Authorization: Bearer bd_…` einen gültigen, nicht widerrufenen
  Schlüssel, löst der `AuthGuard` ihn zu einem `AuthenticatedDevice` auf
  (`BoardDeviceAuthenticator.authenticate`, frisch gegen die Datenbank) und
  verlangt danach auf jedem Handler die Markierung `@AllowDevice()` — fehlt
  sie, antwortet der Guard mit `403 DEVICE_NOT_ALLOWED`, bevor der Handler
  je läuft. Ein neuer Endpunkt ist damit für Geräte gesperrt, bis ihn
  jemand ausdrücklich freigibt; kein Endpunkt fällt versehentlich offen.
  Kein Rückfall auf ein Cookie: ein ungültiger Geräteschlüssel neben einem
  gültigen Session-Cookie ergibt `401 DEVICE_REVOKED`, nicht einen stillen
  Rückfall auf den Benutzer.
- **Katalog `devicePermissions`.** `packages/domain/src/device-access.ts`
  listet die vier Rechte, die ein Gerät je besitzen kann: `["match:read",
  "match:score", "match:undo", "statistics:read"]` — bewusst ein fester
  Katalog statt einer Rolle, damit ein neues Recht nicht still mitwandert,
  nur weil es einer Rolle wie `SCORER` hinzugefügt wird. Kein
  `match:abort`: wie bei `SCORER` bleibt der Abbruch der Leitung
  vorbehalten.
- **Bindung an `matches.board_id` in der Transaktion.** Die reine Funktion
  `decideDeviceMatchAccess({ action, deviceBoardId, matchBoardId,
  matchStatus })` entscheidet `ALLOWED` / `BOARD_MISMATCH` /
  `MATCH_NOT_ACTIVE`. Sie läuft bei schreibenden Aktionen innerhalb
  derselben Transaktion, in der das Match gesperrt und geschrieben wird,
  damit eine Freigabe der Scheibe zwischen Prüfung und Schreibzugriff nicht
  durchrutschen kann.
- **Kein Undo nach Match-Ende durch das Gerät.** `write` (Wurf, Undo,
  Leg-Entscheid, Controller-Lease) ist nur im Status `IN_PROGRESS` erlaubt;
  `read` erlaubt jeden Status, damit die Endstand-Ansicht nach einem
  Neuladen funktioniert. Ein Undo nach Match-Ende würde bei einem
  Liga-Encounter-Slot das Match wieder öffnen, den Slot aber auf
  `COMPLETED` stehen lassen (`completeEncounterSlotForMatch` greift beim
  nächsten Checkout nicht mehr) — und wäre an einem offen zugänglichen
  Tablet ohne jede Zeitgrenze möglich. Korrekturen nach Match-Ende bleiben
  deshalb bei der Leitung.
- **Rate-Limit-Stufe `device` mit Einordnungs-Cache.** Alle Tablets eines
  Dartraums teilen sich meist eine öffentliche NAT-Adresse; ein IP-Eimer
  würde ein Tablet gegen die übrigen Scheiben desselben Raums aussperren.
  Anfragen mit einem gültigen `bd_…`-Schlüssel auf Pfaden der allgemeinen
  Stufe zählen deshalb pro Geräte-ID (`device:<id>`) gegen
  `RATE_LIMIT_DEVICE_MAX_PER_MINUTE` statt gegen die IP. Anmeldung,
  Passwort-Reset und Einladungen (Stufe `sensitive`) bleiben bewusst bei
  der IP-Adresse, auch mit gültigem Geräteschlüssel — sonst bekäme jede
  Person am Tablet die weite Gerätegrenze statt der engen Anmeldegrenze.
  Weil das Rate-Limiting als `onRequest`-Hook vor dem `AuthGuard` läuft,
  ordnet ein eigener, 30 Sekunden im Prozessspeicher zwischengespeicherter
  Nachschlag (`BoardDeviceAuthenticator.classify`) den Schlüssel nur fürs
  Zählen ein; der `AuthGuard` dahinter prüft jede Anfrage weiterhin frisch
  gegen die Datenbank, ein Widerruf wirkt dort sofort. Die Vorgabe `120`
  pro Gerät und Minute beruhte ursprünglich auf einer rechnerischen
  Schätzung (rund 55 Anfragen pro Minute im Match); der E2E-Fall
  `board-device-kiosk.spec.ts` misst inzwischen live rund 46 Anfragen pro
  Minute im laufenden Match OHNE Eingaben und rund 12 im Leerlauf. Mit
  tatsächlich geworfenen Darts (zusätzliche Score-/Undo-Anfragen) bleibt die
  rechnerische Schätzung von rund 52–56 pro Minute im Match die beste
  verfügbare Zahl — nicht separat gemessen. Die Vorgabe bleibt bei 120, mit
  Abstand nach oben in beiden Fällen.
- **`localStorage` statt Cookie.** Der Geräteschlüssel liegt in
  `localStorage` der installierten Web-App (`dartbase.board-device`), nicht
  in einem Cookie — ein Tablet ist dauerhaft installiert, kein Request mit
  Drittanbieter-Kontext. Offen ist die Vorabprüfung aus Spec Abschnitt 7: ob
  `localStorage` einer installierten iPadOS-App über Neustarts,
  iOS-Updates und mehr als sieben Tage Inaktivität hinweg zuverlässig
  erhalten bleibt, war bei Verfassen dieser ADR noch nicht auf einem echten
  Gerät geprüft. Fällt die Prüfung negativ aus, ist die Alternative ein
  `HttpOnly`-Cookie der API, mit eigenen Fragen zur Gültigkeitsdauer
  zwischen unterschiedlichen Web- und API-Domains.

## Verworfen

- **Scheinbenutzer pro Scheibe** (siehe oben): umgeht ADR 0010, braucht
  eine eigene Session-Verwaltung ohne echten Gewinn.
- **Kurzlebige Tokens aus dem Geräteschlüssel**: verkompliziert die
  Offline-Queue, ohne das eigentliche Risiko (offen zugängliches Gerät) zu
  verringern.
- **QR-Kopplung oder Kurzcode**: Eine Admin-Person meldet sich stattdessen
  einmal auf dem Tablet an und richtet es direkt dort ein. Ein
  QR-Kopplungsweg kann später ohne Bruch nachgerüstet werden.
- **Realtime-Kanal pro Scheibe** statt Polling: 5 Sekunden Verzögerung beim
  Übernehmen eines Matches reichen; auch das lässt sich später ohne Bruch
  nachrüsten.
- **Erfassen der scorenden Person**: Akteur im Audit ist bewusst das Gerät
  (die Scheibe), nicht die Person davor — wer am Tablet stand, wird nicht
  erhoben.

## Folgen

- **Reichweite eines gestohlenen Tablets.** Wer ein Tablet an sich bringt,
  kann bis zum Widerruf jedes Match scoren, das dieser Scheibe zugewiesen
  ist — und sonst nichts: kein Match starten oder abbrechen, keine fremde
  Scheibe, keine Turnier-, Encounter-, Spieler-, Board- oder
  Mitgliederverwaltung, kein Statistik-Gesamtabruf. Schutz ist allein der
  Widerruf in der Organisationsverwaltung («Scheiben-Tablets») und die
  Sichtbarkeit von `last_seen_at`.
- **Neue Tabelle `board_devices`**, mit Erweiterungen an
  `board_controller_leases` (`device_id`, `user_id` neu nullable) und
  `audit_events` (`actor_device_id`) — siehe ADR 0018 für den Löschweg.
- **CORS:** `allowedHeaders` lässt neu `Authorization` zu, mit
  `maxAge: 600`, damit der dadurch erzwungene Preflight zehn Minuten
  zwischengespeichert bleibt.
- **Nicht Teil dieser ADR:** die Snapshot-Lücke der Drizzle-Migrationen
  0030–0034 (`packages/database/drizzle/meta`, fehlende
  `*_snapshot.json` zwischen 0029 und 0035) ist ein vorbestehender Zustand
  des Repositories und wird hier nicht behandelt.
- **Bekannte Grenzen:**
  - Undo nach Match-Ende ist für das Gerät gesperrt; Korrekturen bleiben
    bei der Leitung (siehe oben).
  - Die Vorabprüfung auf einem echten iPad (Spec Abschnitt 7) steht noch
    aus.
  - Der 30-Sekunden-Einordnungs-Cache im Rate-Limit kann einen Widerruf bis
    zu 30 Sekunden zu spät mitzählen; der `AuthGuard` selbst bleibt davon
    unberührt und prüft jede Anfrage frisch gegen die Datenbank.
  - Ein Gerät, dessen Undo, Leg-Entscheid oder Lease auf ein bereits
    beendetes Match trifft, erhält `409 DEVICE_MATCH_NOT_ACTIVE`.
- **Nicht umgesetzt:** Kopplung per QR-Code oder Kurzcode, ein
  Realtime-Kanal pro Scheibe, und das Erfassen, welche Person am Tablet
  gescort hat.
