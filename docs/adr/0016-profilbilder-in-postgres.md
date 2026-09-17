# ADR 0016: Profilbilder liegen als Bytes in Postgres, nicht in einem Bucket

**Status:** Accepted
**Datum:** 17. September 2026

## Kontext

Issue #2 verlangt ein Profilbild je Spieler, mit einem aus den Initialen
gezeichneten Standardbild, wenn keines hochgeladen ist. Das ist die erste
Stelle im System, an der Binärdaten entgegengenommen, gespeichert und
ausgeliefert werden — es gibt heute keinen Upload-Weg, keinen `multipart`,
keinen S3-Client, keine Bildverarbeitung.

Zu entscheiden war, wo das eigentliche Bild abgelegt wird: in der
PostgreSQL-Datenbank oder in einem separaten Objektspeicher (S3-kompatibler
Railway-Bucket).

Randbedingungen aus der Spec: gespeichert wird ausschliesslich das vom Server
erzeugte 256-px-WebP, nie die hochgeladene Originaldatei. Ausgeliefert wird
über die API hinter `player:read` — es gibt keine öffentlich erreichbare
Bildadresse, auch nicht auf den öffentlichen Live-Ansichten (`/live/…`).

## Entscheidung

Profilbilder liegen als `bytea` in einer eigenen Tabelle `player_avatars`,
nicht in einem Bucket.

## Begründung

**Der Hauptvorteil eines Buckets entfällt.** Der eigentliche Grund, Bilder in
einen Objektspeicher statt in die Datenbank zu legen, ist die direkte
öffentliche Auslieferung über ein CDN — Anfragen sollen den Anwendungsserver
gar nicht erst erreichen. Hier bleiben die Bilder hinter der
Berechtigungsprüfung (`player:read`, mandantengebunden); die API läge in
jedem Fall auf dem Weg zwischen Anfrage und Bild. Ein CDN davor spart also
nichts, was nicht ohnehin durch die API muss.

**Ein Bucket eröffnet eine zweite Konsistenzdomäne.** Lebenszyklus und
Löschung von Profilbildern hingen dann an zwei Systemen statt an einem:
löscht die Applikation einen Spieler, muss dieselbe Transaktion, die den
Datenbankeintrag entfernt, auch einen Aufruf gegen den Bucket auslösen — und
dieser Aufruf ist nicht transaktional mit dem `COMMIT` der Datenbank
verknüpfbar. Ein abgebrochener oder fehlgeschlagener Löschvorgang hinterlässt
ein verwaistes Objekt, das kein Fremdschlüssel je aufräumt. In Postgres
erledigt `on delete cascade` genau das ohne zusätzlichen Code.

**Ein Bucket verlangt Zugangsdaten je Umgebung.** Produktion, Staging,
Entwicklung und jede kurzlebige Neon-Preview-Branch bräuchten eigene
Bucket-Zugangsdaten und eigene Buckets oder Präfixe, um sich nicht
gegenseitig zu überschreiben. Die Datenbank existiert in jeder dieser
Umgebungen ohnehin, mit derselben Sicherungs- und Wiederherstellungsdomäne
(PITR) und demselben Mandantentrennungsmuster wie jede andere Tabelle.

**Die Datenmenge trägt die Entscheidung.** Ein 256-px-WebP liegt bei rund
15–25 KB. Bei 500 Spielern sind das unter 15 MB — vernachlässigbar gegenüber
der übrigen Datenbank. Der Check-Constraint begrenzt jeden Datensatz
zusätzlich hart auf 256 KiB (`byte_size <= 262144`), weit über dem
erwarteten Wert, als Schutz gegen eine fehlerhafte Bildverarbeitung, nicht
als angestrebte Grösse.

**Eigene Tabelle statt Spalten auf `players`.** `players` wird an vielen
Stellen vollständig gelesen (Spielerlisten, Turnierteilnehmerlisten,
Aufstellungen); ein Bild dort als Spalte mitzuschleppen würde jede dieser
Abfragen unnötig verteuern, auch wenn kein Bild angezeigt wird. Die
1:1-Beziehung über `player_avatars.player_id` mit Unique-Constraint hält das
Bild getrennt und macht es zu einer bewusst zu ladenden Ressource.

### Verworfene Alternative

**S3-kompatibler Railway-Bucket.** Verworfen aus den oben genannten Gründen:
der Hauptvorteil (öffentliche CDN-Auslieferung) entfällt bei Bildern hinter
einer Berechtigungsprüfung, während eine zweite Konsistenzdomäne und
Zugangsdaten je Umgebung hinzukämen, ohne dass die Datenmenge das
rechtfertigt.

## Konsequenzen

- Kein neuer Infrastrukturbaustein, keine neuen Zugangsdaten, identisches
  Verhalten in allen Umgebungen einschliesslich kurzlebiger Preview-Branches.
- Löschen eines Spielers oder einer Organisation entfernt das zugehörige
  Profilbild automatisch über `on delete cascade` — kein separater
  Aufräumschritt, kein verwaistes Objekt.
- Jede Auslieferung eines Bildes belastet den Anwendungsserver (kein CDN
  davor). Bei den erwarteten Grössen (Kilobyte-Bereich, Hunderte statt
  Millionen Spieler) ist das unkritisch.
- Wächst die Plattform um eine Grössenordnung oder kommen grössere Medien
  hinzu (Video, hochauflösende Bilder), ist der Wechsel auf einen Bucket eine
  eigene, spätere Entscheidung. Die nach aussen sichtbare Schnittstelle —
  die drei Endpunkte für Hochladen, Auslesen und Löschen des Profilbilds —
  bliebe dabei unverändert; nur die Ablage dahinter würde ausgetauscht.

## Referenzen

- `docs/superpowers/specs/2026-09-17-spielerprofilbild-design.md`
- GitHub-Issue #2
- AGENTS.md §4 (Business-Logik in Paketen), §10 (DB-Constraints), §13 (Server
  entscheidet), §14 (Multi-Tenancy)
