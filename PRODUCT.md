# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Zwei gleichrangige Primärnutzer. Kein Modus ist Beiwerk des anderen.

**Turnierleitung** – Veranstalter oder Vereinsvorstand, sitzend an Laptop oder Tablet, während das Turnier läuft. Aufgabe: Turnier aufsetzen, Teilnehmer setzen, Boards zuweisen, Ergebnisse korrigieren, Überblick über alle parallel laufenden Matches behalten. Referenzszenario aus [ROADMAP.md](ROADMAP.md): 32 Spieler, 8 Gruppen à 4, Top 2 qualifizieren, 16er-KO, 8 Boards.

**Scorer am Board** – Spieler oder Schreiber, stehend am Board, Smartphone oder Tablet in einer Hand, zwischen zwei Aufnahmen. Aufgabe: Score erfassen, Bust und Checkout erkennen, Fehleingabe zurücknehmen. Wenige Interaktionen pro Aufnahme, verlässlich auch bei kurzen Netzaussetzern.

Weitere Beteiligte sind bekannt, aber nicht primär: Zuschauer und TV/Beamer-Ansicht (geplant, Phase 3), Organisations-Administration (OWNER, ADMIN implementiert). Rollen im System heute: `OWNER`, `ADMIN`, `TOURNAMENT_DIRECTOR`, `SCORER`.

## Product Purpose

Ein Dartturnier vollständig durchführen – von der Teilnehmerliste über Gruppenphase, K.-o.-Runde und Live-Scoring bis zum publizierten Ergebnis – ohne Excel-Tabellen, Papierlisten oder parallel geführte Hilfsdateien.

Erfolg heisst: eine Turnierleitung führt das Referenzturnier (32 Spieler, 8 Boards) von Anfang bis Ende im System durch, ohne daneben eine zweite Wahrheit zu pflegen, und ohne dass ein Score verloren geht.

Langfristig erweitert sich derselbe Datenbestand auf Liga- und Saisonbetrieb, Turnierserien und Karrierestatistik.

## Positioning

Drei bestätigte Unterscheidungsmerkmale:

1. **Vollständiger Turnierbetrieb statt Einzelmatch-Zähler.** Gruppen, Setzung, K.-o.-Baum, Board-Zuweisung, Ergebniskorrektur und Audit gehören zum Kern – nicht das Scoreboard allein.
2. **Scoring-Quelle austauschbar.** Manuelle Eingabe, Autodarts und Scolia laufen über Adapter in dieselbe Domain. Ein Turnier darf Boards mit und ohne Autoscoring mischen; die Turnierlogik merkt keinen Unterschied.
3. **Eine durchgehende Datenbasis über das Einzelturnier hinaus.** Liga, Saison, Turnierserie, Rankings und Karrierestatistik greifen auf dieselben Match- und Visit-Daten zurück, nicht auf nachträglich abgetippte Ergebnisse.

Nicht als Positionierung bestätigt, aber als technische Eigenschaft vorhanden: Multi-Tenancy mit Rollen und Tenant-Isolation ab Tag 1 (siehe Capabilities).

## Operating Context

- Turnierbetrieb vor Ort, mehrere Boards gleichzeitig in Betrieb, Matches laufen parallel.
- Zwei Gerätearten gleichzeitig im Einsatz: Leitungsgerät (Laptop/Tablet) und Boardgeräte (Smartphone/Tablet), teils Privatgeräte der Spieler.
- Ausgabe zusätzlich auf TV oder Beamer sowie öffentliche Turnierseite mit QR-Code je Board (geplant, Phase 3).
- Netzverbindung ist nicht garantiert: kurze WLAN-Ausfälle sind erwarteter Normalfall und dürfen keinen Score-Verlust verursachen (Phase 5, Exit Criteria).
- Mehrere Organisationen (Vereine, Veranstalter) betreiben getrennte Turniere auf derselben Installation.
- Der Ablauf ist zeitkritisch: ein blockiertes Board hält das Turnier auf, deshalb müssen Board-Zuweisung und Score-Eingabe ohne Nachdenken funktionieren.

Nicht bestätigt: konkreter Veranstaltungsort, Lichtverhältnisse, Turniergrössen jenseits des Referenzszenarios.

## Capabilities and Constraints

**Heute nutzbar (Phase 0–3, Stand 26.08.2026)**

- Registrierung, Login, Logout, persistente HttpOnly-Sessions (Better Auth)
- Organisation erstellen, Mitgliedschaften, zeitlich begrenzte E-Mail-gebundene Einladungen
- serverseitige Rollen und Permissions je Tenant
- Spielerverwaltung inklusive revisionssicherer Archivierung
- Board- und Matchverwaltung, tenant-sicher
- vollständiges 501-Double-Out-Match: Legs, Bust, Checkout, Dart Count, Best of Legs, Undo
- touchfreundliches Scoreboard für Smartphone und Tablet
- Audit- und Outbox-Einträge in derselben Transaktion wie die Mutation
- vollständiger Tournament MVP: Round Robin, Gruppen, Setzung, K.-o., Byes,
  Ranking, Board-Zuweisung, Dashboard und auditierte Result Correction
- öffentliche Live-, TV- und Board-Ansichten mit Socket.IO-Echtzeit,
  Gruppenranglisten, K.-o.-Tableau und QR-Code je Board

**Geplant, Reihenfolge festgelegt** (siehe [ROADMAP.md](ROADMAP.md)): erweiterte Formate, Sets, Teams (4) → PWA mit sichtbarer Offline-Queue (5) → Statistik und Spielerprofile (6) → Multi-Tenant-SaaS-Ausbau (7) → Autoscoring-Adapter (8) → Liga (9) → Turnierserie (10) → Benachrichtigungen (11) → Public API (12).

**Harte Constraints, die jede Fläche einhält** (verbindlich in [AGENTS.md](AGENTS.md))

- Jede tenant-bezogene Abfrage ist serverseitig über `organization_id` eingeschränkt; jede Mutation ist serverseitig autorisiert. Rollenprüfung im UI ist nie die einzige Sicherheit.
- Score- und Match-Commands sind idempotent (`commandId`); Wiederholung erzeugt keinen zweiten Visit.
- Aktive Matches und Legs sind versioniert; Konflikt liefert HTTP 409 samt aktuellem Serverzustand – das UI muss diesen Zustand sichtbar auflösen, nicht verschweigen.
- Realtime-Events erst nach erfolgreichem Commit; WebSockets sind kein Write-Kanal für Business Commands.
- Scoring-, Turnier- und Scheduling-Logik bleiben infrastrukturfrei; keine Turnier- oder Scoring-Logik in React-Komponenten.
- Verbindungsstatus, Fehlerzustände und Offline-Queue sind sichtbar. Kein versteckter Datenverlust.
- Fehlerformat einheitlich (`error.code`, `error.message`, `correlationId`), keine Stacktraces an Clients.

**Fachbegriffe, die im Produkt so heissen** (nicht eindeutschen): Leg, Set, Visit, Aufnahme, Bust, Checkout, Double Out, Best of Legs, Dart Count, Board, Stage, Seeding, Bye, Average, First 9, Checkout-Quote, 180, High Finish, Head-to-Head.

**Ausdrücklich offen**

- Produktname (siehe Brand Commitments)
- Plan- und Preismodell: `FREE / CLUB / PRO / ENTERPRISE` steht in der Roadmap als Möglichkeit, nicht als Entscheidung. Keine Preise, keine Limits festgelegt.
- Custom Domains, Organisations-Branding und Sponsor-Assets sind Phase-7-Scope ohne Detailentscheidung.
- Ob Teams und Doppel gleichrangig zum Einzel werden (Phase 4), ist nicht entschieden.

## Brand Commitments

- **Produktsprache: Deutsch, Schweizer Rechtschreibung, kein Eszett.** Bestätigt. Die aktuelle englische UI-Copy in [apps/web](apps/web) ist Altlast aus der Aufbauphase und wird bei künftiger Arbeit an der jeweiligen Fläche ersetzt. Dart-Fachbegriffe bleiben englisch (siehe Terminologie).
- **Produktname: Dart Ost - Plattform.** Dieser Name wird in UI-Titeln und sichtbaren Produktflächen verwendet.
- Keine Logo-, Wortmarken- oder Farbfestlegung existiert. Kein Asset-Verzeichnis (`apps/web/public` ist nicht vorhanden).
- Keine Tonalität dokumentiert. Die heutige UI-Copy ist knapp und technisch, war aber nie als Stimme festgelegt.

## Evidence on Hand

**Vorhanden und belastbar**

- Lauffähiges 501-Double-Out-Match, deterministisch getestete Scoring-Engine ([packages/scoring-engine](packages/scoring-engine)), E2E-Test über den vollen Matchablauf ([apps/web/tests/foundation.spec.ts](apps/web/tests/foundation.spec.ts))
- Architekturentscheide: [docs/adr/0001-foundation-architecture.md](docs/adr/0001-foundation-architecture.md) bis [0004-phase-1-x01-match.md](docs/adr/0004-phase-1-x01-match.md)
- [ARCHITECTURE.md](ARCHITECTURE.md), [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md), [ROADMAP.md](ROADMAP.md) mit Phasen und Exit Criteria
- CI/CD und reproduzierbare Production-Images, Railway IaC ([infrastructure/](infrastructure/))
- bestehende UI-Fläche: eine Dashboard-Seite mit Auth-, Tenant-, Health- und Match-Bereich; gemeinsame UI bislang nur `Button` ([packages/ui/src/components/button.tsx](packages/ui/src/components/button.tsx))

**Nicht vorhanden – nicht erfinden**

- keine Kunden, Vereine, Pilotturniere, Testimonials, Nutzerzahlen, Pressestimmen
- keine Screenshots, Fotos, Sponsorlogos, Illustrationen, Icon-Set
- keine Preise, keine Verfügbarkeitszusagen, keine Zertifizierungen
- keine echten Spieler- oder Turnierdaten; in Beispielen und Tests ausschliesslich fiktive Namen und Werte
- kein Autodarts-/Scolia-Adapter im Code (Phase 8) – Integrationen nicht als bestehend darstellen

## Product Principles

1. **Zwei Modi, ein Zustand.** Leitungsansicht und Boardansicht sind eigenständig gestaltet, zeigen aber nie widersprüchliche Wahrheiten. Konflikte werden aufgelöst, nicht kaschiert.
2. **Kein stiller Datenverlust.** Jede nicht übertragene Eingabe, jeder Verbindungsabbruch, jeder Versionskonflikt ist sichtbar und bedienbar. Lieber ein sichtbarer Wartezustand als ein stiller Verlust.
3. **Nachvollziehbarkeit vor Bequemlichkeit.** Korrekturen, Board-Zuweisungen und Scheduler-Entscheide bleiben erklärbar und auditierbar. Eine Abkürzung, die die Turnierintegrität aufweicht, ist keine Verbesserung.
4. **Die Scoring-Quelle ist austauschbar, die Domain nicht.** Flächen zeigen den Domain-Zustand, egal ob eine Person, Autodarts oder Scolia ihn erzeugt hat.
5. **Turnierzeit ist knapp.** Wiederkehrende Handgriffe – Aufnahme erfassen, Board freigeben, nächstes Match starten – kosten so wenige Interaktionen wie möglich, auch einhändig im Stehen.

## Accessibility & Inclusion

Verbindliches Minimum aus [AGENTS.md](AGENTS.md) §19: semantisches HTML, Keyboard-Navigation für Admin-Flächen, ausreichender Kontrast, sichtbarer Fokus, ARIA nur wo nötig, keine Information ausschliesslich über Farbe. Touch Targets in sinnvoller Mobilgrösse (heute mindestens 44 px Höhe in Formularen).

Produktspezifisch relevant: das Boardgerät wird stehend und einhändig bedient, teils mit einem Dart in der anderen Hand.

Kein konkreter WCAG-Level ist verbindlich festgelegt – offen.
