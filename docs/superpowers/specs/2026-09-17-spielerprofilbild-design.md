# Spielerprofilbild — Design

Stand 2026-09-17. Architektural eingestuft, weil das Feature eine Fähigkeit
einführt, die es im System noch nicht gibt: Binärdaten entgegennehmen,
speichern und ausliefern. Heute kennt die Plattform keinen Upload-Weg — kein
`multipart`, kein S3-Client, keine Bildverarbeitung.

Grundlage: GitHub-Issue #2 („Jeder Spieler hat ein Avatar, wenn kein Bild
hochgeladen ist wird ein Standardbild verwendet").

Verwandt: AGENTS.md §4 (Business-Logik in Paketen), §10 (DB-Constraints),
§13 (Server entscheidet), §14 (Multi-Tenancy), §19 (Accessibility);
`docs/adr/0015-spieler-konto-verknuepfung.md` (wer „seine eigenen" Daten
pflegen darf).

## Problem

Spielerlisten und Profile unterscheiden Personen allein über den
Anzeigenamen. An einem Ligaabend mit zwölf Namen auf einer Liste ist das die
langsamste Art, jemanden zu finden, und bei gleichen oder ähnlichen Namen
versagt sie ganz.

## Ziel

Jeder Spieler trägt ein Bild. Wo keines hochgeladen ist, zeichnet die Fläche
ein unterscheidbares Standardbild aus den Initialen. Das Bild ist ein
Personendatum und bleibt innerhalb der Organisation.

## Nicht im Umfang

- Kein Avatar auf der Scoringfläche. Sie ist auf Lesbarkeit aus zwei Metern
  getrimmt; Gesichter darauf sind eine eigene Gestaltungsentscheidung.
- Kein Avatar in den öffentlichen Live-Ansichten (`/live/…`). Das wäre eine
  Veröffentlichung von Personenbildern und verlangt eine ausdrückliche
  Einwilligung, die das System heute nicht führt.
- Kein Zuschneide-Werkzeug mit Verschieben und Zoomen. Mittiger quadratischer
  Ausschnitt.
- Keine Moderation, keine Freigabe durch Dritte, keine animierten Bilder.

## Entscheidungen

### Ablage: Postgres, nicht Bucket

Die Bilder liegen als `bytea` in der Datenbank. Erwogen und verworfen wurde
ein S3-kompatibler Railway-Bucket.

Dafür spricht: keine neue Infrastruktur, keine Zugangsdaten in Produktion,
Staging und Entwicklung, eine einzige Sicherungs- und Wiederherstellungs-
domäne (die PITR-Fähigkeit besteht bereits), Mandantentrennung nach dem
bestehenden Muster, Löschen per Fremdschlüssel, und identisches Verhalten in
allen Umgebungen einschliesslich kurzlebiger Preview-Branches.

Der Hauptvorteil eines Buckets — direkte öffentliche Auslieferung über ein
CDN — entfällt, weil die Bilder hinter der Berechtigungsprüfung bleiben; die
API läge ohnehin im Weg. Dagegen stünden eine zweite Konsistenzdomäne
(verwaiste Objekte beim Löschen) und Zugangsdaten je Umgebung.

Die Datenmenge trägt: 256 px WebP liegt bei 15–25 KB, 500 Spieler also unter
15 MB. Wächst die Plattform um eine Grössenordnung oder kommen grössere
Medien dazu, ist der Wechsel auf einen Bucket eine eigene Entscheidung — die
Schnittstelle nach aussen (drei Endpunkte) bliebe dieselbe.

Der Entscheid gehört in ein ADR (0016).

### Sichtbarkeit: nur angemeldet, innerhalb der Organisation

Ausgeliefert wird über die API hinter `player:read`. Es gibt keine öffentlich
erreichbare Bildadresse.

### Berechtigung: Verwaltung und die verknüpfte Person

Setzen und Entfernen verlangt `player:update` **oder** dass `players.user_id`
das anfragende Konto ist (ADR 0015). Die meisten Spieler haben kein Konto —
ohne die Verwaltung bekämen sie nie ein Bild.

### Standardbild: Initialen

Aus dem Anzeigenamen erzeugt, Farbton deterministisch aus der Spieler-ID.
Dieselbe Person trägt überall dieselbe Farbe. Ein einheitliches Silhouetten-
bild wurde verworfen: es macht alle Spieler ohne Foto ununterscheidbar und
verfehlt damit den Zweck.

## Datenmodell

```text
player_avatars
  id              uuid    pk
  organization_id uuid    not null -> organizations (cascade)
  player_id       uuid    not null -> players (cascade), unique
  content_type    varchar not null, check in ('image/webp')
  bytes           bytea   not null
  byte_size       integer not null, check > 0 and <= 262144
  checksum        varchar not null   -- SHA-256, hex
  created_at, updated_at
```

Eine eigene Tabelle statt Spalten auf `players`: `players` wird überall
vollständig gelesen, ein Bild in jeder Spielerliste mitzuschleppen wäre
teuer. Ein Datensatz je Spieler (`unique`), weil ein Spieler genau ein Bild
trägt.

`bytea` kommt über einen Drizzle-`customType`; der Typ fehlt in `pg-core`.

Die Spieler-Nutzlast trägt neu `avatarChecksum: string | null`. Die Fläche
weiss damit ohne Zusatzabfrage, ob ein Bild existiert.

## API

```text
GET    /api/v1/organizations/:organizationId/players/:playerId/avatar
PUT    /api/v1/organizations/:organizationId/players/:playerId/avatar
DELETE /api/v1/organizations/:organizationId/players/:playerId/avatar
```

Jede Abfrage ist nach `organization_id` eingeschränkt. Ein Spieler einer
fremden Organisation ist nicht unterscheidbar von einem, den es nicht gibt:
404, nicht 403.

`GET` antwortet mit `image/webp` und
`Cache-Control: private, max-age=31536000, immutable`. Die Fläche hängt die
Prüfsumme als `?v=` an die Adresse; eine Änderung bricht den Cache von
selbst, weil sich die Adresse ändert. Ohne Bild: 404 — die Fläche fragt in
dem Fall gar nicht erst, sie kennt `avatarChecksum`.

`PUT` nimmt den rohen Binärkörper mit `Content-Type: image/*` entgegen. Kein
Multipart, kein base64-JSON: ein Fastify-Content-Type-Parser reicht den
Körper als Buffer durch, clientseitig ist es
`fetch(url, { method: "PUT", body: blob })`.

Fehlerformat wie überall (AGENTS.md §15):

| Code | HTTP | Fall |
|---|---|---|
| `AVATAR_INVALID_IMAGE` | 422 | lässt sich nicht als Bild dekodieren |
| `AVATAR_TOO_LARGE` | 413 | Körper über der Grenze |
| `FORBIDDEN` | 403 | weder `player:update` noch verknüpftes Konto |

## Bildverarbeitung

Die Fläche verkleinert **vor** dem Upload im Browser (Canvas, quadratischer
Ausschnitt, 512 px, WebP) — bewusst grösser als die gespeicherten 256 px,
damit der Server aus genügend Bildinformation herunterrechnet und nicht aus
einem bereits knapp skalierten Bild. Ein Handyfoto von 4 MB geht damit als etwa 40 KB
über die Leitung und bleibt unter dem bestehenden Fastify-Körperlimit von
1 MB, das dafür nicht angehoben werden muss.

Dieser Schritt ist **Bequemlichkeit, keine Vertrauensgrenze.** Der Server
dekodiert die Datei selbst mit `sharp`, schneidet quadratisch zu, skaliert
auf 256 px und kodiert nach WebP. Gespeichert wird immer ein vom Server
erzeugtes Bild.

Daraus folgen drei Eigenschaften, die nicht Nebeneffekt, sondern Zweck sind:

- Eine als Bild deklarierte Datei, die keine ist, scheitert beim Dekodieren.
- EXIF-Daten überleben die Neukodierung nicht. Handyfotos tragen
  GPS-Koordinaten und Gerätekennungen; sie unverändert zu speichern wäre eine
  stille Datensammlung.
- Die gespeicherte Grösse ist gedeckelt und vorhersagbar.

Gegen Dekompressionsbomben steht `limitInputPixels` bei 50 Megapixeln,
zusätzlich zur Bytegrenze. Animierte Bilder werden auf das erste Bild
reduziert.

`sharp` liefert für `node:24-bookworm-slim` vorgebaute Binärdateien; der
Docker-Build bleibt unverändert.

## Fläche

`PlayerAvatar` zeigt das Bild, wenn `avatarChecksum` gesetzt ist, sonst die
Initialen. Die beiden Regeln dahinter — Initialen aus dem Anzeigenamen,
Farbton aus der ID — sind reine Funktionen in
`apps/web/src/lib/player-avatar.ts`.

Sichtbar in der Spielerliste und auf dem Spielerprofil. Das Bedienelement zum
Setzen und Entfernen steht auf dem Profil und erscheint nur bei
ausreichender Berechtigung — die Prüfung bleibt serverseitig, das Ausblenden
ist reine Bequemlichkeit (AGENTS.md §13).

Barrierefreiheit: neben dem Namen ist das Bild dekorativ und trägt ein leeres
`alt`; allein stehend trägt es den Namen. Das Bedienelement hält die
Mindestgrösse aus DESIGN.md und zeigt Fehlerzustände sichtbar an.

## Audit

Jede Änderung schreibt `PLAYER_AVATAR_UPDATED` beziehungsweise
`PLAYER_AVATAR_REMOVED` — mit der Prüfsumme, nicht mit den Bytes. Ein
Audit-Log, das Bilddaten mitschreibt, wäre eine zweite, unkontrollierte Kopie
der Personendaten.

## Datenschutz

Ein Spielerfoto ist ein Personendatum. Die Entscheidungen oben halten den
Fussabdruck klein: keine öffentliche Adresse, keine EXIF-Daten, keine Kopie
im Audit-Log, Löschen zusammen mit dem Spieler.

Nicht abgedeckt und bewusst offen: eine dokumentierte Einwilligung der
abgebildeten Person. Solange die Bilder die Organisation nicht verlassen,
liegt das im Rahmen der übrigen Stammdatenpflege; vor jeder Veröffentlichung
— etwa in den Live-Ansichten — gehört die Frage an die zuständige Stelle.

## Tests

- **Reine Regeln** (`apps/web`): Initialen aus verschiedenen Namensformen,
  Farbton stabil je ID.
- **Bildverarbeitung** (`apps/api`): echte Testbilder rein, 256 px WebP
  raus; ein Bild mit EXIF-Daten rein, keine EXIF-Daten raus; eine Datei, die
  kein Bild ist, wird abgelehnt.
- **API-Integration**: Upload durch die Verwaltung; Upload durch das
  verknüpfte Konto; Ablehnung für `VIEWER`; Spieler einer fremden
  Organisation ergibt 404; Cache-Kopfzeilen auf `GET`; `DELETE` entfernt;
  das Löschen des Spielers räumt das Bild mit ab.
- **Render** (`apps/web`): ohne Prüfsumme erscheinen die Initialen, mit
  Prüfsumme ein `img` mit `?v=`.
- **E2E**: ein Bild auf dem Profil hochladen und in der Spielerliste
  wiederfinden.

## Migration

Eine Migration für `player_avatars` samt Constraints und Fremdschlüsseln.
Kein Bestandsdatenproblem: die Tabelle ist neu und leer.

## Offene Punkte

- Eine Aufbewahrungsfrist für Bilder ausgeschiedener Spieler ist nicht
  festgelegt; heute verschwindet das Bild mit dem Spieler.
- Ob ein späterer Wechsel auf einen Bucket nötig wird, entscheidet die
  Datenmenge. Die drei Endpunkte blieben dabei unverändert.
