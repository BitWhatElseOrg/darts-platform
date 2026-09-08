# ADR 0013: Öffentliche Turnier-Adressen, Anzeige-Schlüssel und Kanal-Autorisierung

**Status:** Accepted
**Datum:** 08. September 2026

## Kontext

Das Sicherheitsaudit hielt zwei zusammenhängende Lücken fest:

- **I-1b:** Öffentliche Links und QR-Codes verwendeten den internen
  Primärschlüssel eines Turniers. Ein Turnier, das nicht öffentlich sein
  sollte, war über diesen Schlüssel dennoch erreichbar, sobald jemand ihn
  kannte oder erriet — es gab keinen serverseitigen Sichtbarkeitsschalter.
- **I-2:** Realtime-Räume (`tournament:{id}`, `encounter:{id}`) traten ohne
  jede Prüfung bei. Wer die Raum-ID kannte, erhielt die Live-Ereignisse eines
  beliebigen Turniers — unabhängig von Mitgliedschaft oder Sichtbarkeit.

Board-Tablets und TV-Geräte an einem Turnierort brauchen ausserdem Zugriff auf
die öffentlichen, schreibgeschützten Ansichten eines Turniers, auch wenn
dieses privat bleiben soll — ein Gerät ist kein Organisationsmitglied und soll
auch keins werden müssen.

Diese drei Fragen — öffentliche Adressierung, Geräte-Zugriff auf private
Turniere, Autorisierung von Realtime-Kanälen — hängen so eng zusammen, dass
sie in einem gemeinsamen Entscheid festgehalten werden, nicht in dreien.

## Entscheidung

### Zweistufige Sichtbarkeit mit zweiter Adresse

Turniere (wie schon Begegnungen) erhalten eine zweite, unerratbare `public_id`
(UUID, eigener Unique-Index) sowie eine per Check-Constraint erzwungene
`visibility`:

```text
PRIVATE   — Vorgabe für jedes neue Turnier
PUBLIC    — Turnierleitung gibt bewusst frei
```

Öffentliche Links, QR-Codes und Realtime-Räume adressieren ausschliesslich
über `public_id`; der interne Primärschlüssel verlässt den Server nicht. Eine
Anfrage gegen ein privates Turnier — REST wie Realtime — beantwortet der
Server mit 404 „nicht gefunden", identisch zur Antwort auf eine unbekannte
`public_id`, nie mit 403 „verboten". Ein unterscheidbares 403 würde einem
Aussenstehenden bereits verraten, dass unter der erratenen Adresse ein
Turnier existiert — genau die Information, die eine private Organisation
nicht preisgeben will.

### Anzeige-Schlüssel als Eintrittskarte für Geräte

Ein Anzeige-Schlüssel ist ein von der Turnierleitung ausgestelltes, zufälliges
Geheimnis, das ein Board- oder TV-Gerät berechtigt, die öffentlichen Ansichten
eines bestimmten – auch privaten – Turniers zu sehen. Gespeichert wird
ausschliesslich der Hash (`tournament_display_keys.secret_hash`); ein Leck der
Tabelle liefert keine verwendbaren Schlüssel. Ein Schlüssel lässt sich
widerrufen, ohne die Turnier-Adresse zu ändern.

Drei Eintrittskarten, alternativ zueinander, entscheiden jeden Zugriff auf ein
Turnier, das nicht öffentlich ist:

```text
öffentliche Sichtbarkeit (visibility = PUBLIC)
Organisationsmitgliedschaft
gültiger Anzeige-Schlüssel
```

### Realtime-Räume nach `public_id`, Autorisierung beim Beitritt

Realtime-Räume heissen `tournament:{publicId}` / `encounter:{publicId}` statt
nach internem Schlüssel. Eine reine Domain-Funktion `decideSubscription`
(`packages/domain/src/subscription-access.ts`) entscheidet aus genau den drei
Eintrittskarten oben (plus der Frage, ob die Adresse überhaupt existiert), ob
ein Socket einem Raum beitreten darf; sie kennt weder Datenbank noch
Socket.IO. `SubscriptionAuthorization`
(`apps/api/src/realtime/subscription-authorization.ts`) beschafft die
Eingaben — Sitzung aus dem Handshake-Cookie, Mitgliedschaft, Anzeige-Schlüssel
— und ruft die Entscheidung auf, bevor der Socket dem Raum beitritt. Eine
Ablehnung nutzt das bereits bestehende Ereignis `subscription:rejected`
(bislang nur für die Obergrenze von 20 Abonnements je Socket genutzt); es kam
kein neues Ereignis hinzu, nur weitere Ablehnungsgründe
(`SUBSCRIPTION_FORBIDDEN`, `SUBSCRIPTION_UNKNOWN_ROOM`).

## Verworfene Alternativen

- **Signiertes Ticket im Socket-Handshake.** Ein kurzlebiges, signiertes
  Ticket (etwa ein JWT), das der Client vor dem Verbindungsaufbau von der API
  holt und im Handshake vorzeigt, würde die Autorisierung von der laufenden
  Verbindung entkoppeln und wäre unter hoher Verbindungslast günstiger als ein
  Datenbank-Lookup je Abonnement. Diese Anfangsinvestition löst ein
  Lastproblem, das bei der tatsächlichen Grössenordnung nicht besteht — eine
  Handvoll Boards je Turnier, nicht Zehntausende gleichzeitiger Zuschauer.
  Sie hätte ausserdem einen zweiten Authentifizierungsmechanismus neben
  Better Auth eingeführt (eigene Signatur, eigene Ablaufzeit, eigener
  Widerruf), der gepflegt und geprüft werden müsste, ohne einem echten
  Bedürfnis zu dienen.
- **Drei Sichtbarkeitsstufen mit öffentlichem Verzeichnis** (z. B.
  `PRIVATE` / `UNLISTED` / `LISTED`, wobei `LISTED` zusätzlich in einer
  öffentlichen Turnierliste erscheint). Das wurde verworfen, weil „gelistet"
  kein weiterer Wert auf derselben Skala ist, sondern eine eigenständige
  Produktentscheidung: Sortierung, Auffindbarkeit, und vor allem die Frage,
  was ein Fremder über einen anderen Verein überhaupt einsehen darf, ohne
  dass dieser aktiv danach gefragt hat. Diese Fragen verdienen eine eigene
  Spec, sobald ein öffentliches Verzeichnis tatsächlich gebraucht wird —
  nicht einen stillen dritten Enum-Wert in diesem Entscheid.

## Sicherheitsfolgen

Ein privates Turnier ist ohne Mitgliedschaft oder gültigen Anzeige-Schlüssel
weder über REST noch über Realtime von einem nicht existierenden
unterscheidbar. Der interne Primärschlüssel bleibt intern. Anzeige-Schlüssel
sind ausschliesslich lesend und laufen ohne explizite Angabe 48 Stunden nach
Turnierbeginn ab (nie in der Vergangenheit — `DisplayKeysService` deckelt die
Vorgabe zusätzlich gegen „jetzt plus 48 Stunden"), lassen sich aber auch vor
Ablauf jederzeit widerrufen, und ihr Klartext ist nach der Ausgabe an die
Turnierleitung nirgends mehr rekonstruierbar.

Eine Einschränkung bleibt bestehen: Widerruf und Ablauf verhindern sofort
neue Abonnements und neuen HTTP-Zugriff, trennen aber einen Socket, der dem
Realtime-Raum des Turniers bereits mit diesem Schlüssel beigetreten ist,
nicht zwangsweise. Ein solcher Socket erhält weiterhin Ereigniszeiger
(`{eventId, eventType, occurredAt}`, keine Matchinhalte), bis er sich von
selbst trennt (Geräteneustart, Reload). Ein echter Fix bräuchte
`RealtimeService`/`RealtimeBroadcaster` erreichbar aus `DisplayKeysService` —
`RealtimeModule` importiert bereits `TournamentsModule`, die umgekehrte
Abhängigkeit wäre also zirkulär und verdient ein eigenes Design, keinen
nachträglichen Fix in diesem Entscheid. Bis dahin ist das eine bekannte,
akzeptierte Lücke.

## Betriebsfolgen

Bestehende Turniere wurden bei der Migration einmalig auf `PUBLIC` gehoben,
damit sich für laufende Turniere nichts am Zugriffsverhalten ändert; nur neue
Turniere starten `PRIVATE`. Der Übergangsweg über die alte interne Adresse
(`/address` und ihre Auflösung in `live-address.ts`) bleibt befristet
bestehen und wird in einem eigenen, kleinen PR entfernt, sobald seine Frist
abgelaufen ist.
