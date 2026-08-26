---
version: 1
slug: "src-app-turniere-id-page-tsx"
primary_target: "src/app/turniere/[id]/page.tsx"
related_targets: ["src/app/turniere/neu/page.tsx","src/app/turniere/page.tsx"]
---

# Turnier-Dashboard und Turnier-Setup

**Scope:** `/turniere`, `/turniere/neu`, `/turniere/[id]`. Visitor mode: **Operate**.
**Ankerformat:** Laptop quer ~1440. Tablet quer erbt die Zonenordnung; Smartphone ist Notfallformat, nicht Ziel.

## Publikum und Aufgabe

Turnierleitung, sitzend am Leitungsgerät während das Turnier läuft, in einer lauten Halle unter Zeitdruck. Wiederkehrende Frage: *Was muss ich jetzt tun, damit kein Board leer steht?* Zweitrolle: `SCORER` liest dieselbe Fläche und erfährt daraus, wohin er gehört.

Vor dem Turnier ist dieselbe Person in anderer Verfassung — sitzend, sorgfältig, beim Erfassen von Teilnehmern und Struktur. Zwei Verfassungen, eine Welt, zwei bewusst verschiedene Dichten.

**Primäre Handlung:** freies Board → nächstes Match startet, in einer Bestätigung (Klick oder Zifferntaste).

## Beweis, den nur dieses Produkt liefern kann

Die Fläche zeigt nicht nur, welches Board frei *ist*, sondern welches gleich frei *wird*: ein Spieler auf einem Finish ist im laufenden Match markiert (Doppelring plus Checkout-Weg). Diese Information existiert nur, weil die Scoring-Engine jeden Visit besitzt — ein Nachbarprodukt mit abgetippten Endergebnissen kann sie nicht zeigen.

Zweiter Beweis, im Setup: die Struktur-Vorschau der Turnier-Engine (Gruppen, Matchzahl, Freilose, Warnungen) ersetzt die Excel-Tabelle an genau der Stelle, an der sie heute entsteht.

## Gewählte Richtung und Erinnerungsmoment

**Sektorenring** (Kandidat 3 von 7, Seed `616b8789`, Modus `operate`) — der Grafik-Apparat des Boards als Bediensprache. Welt und Tokens stehen in DESIGN.md; hier gilt nur die Komposition dieser Fläche:

- Drei Zonen, keine verschwindet: Boards (dominant, zwei Spalten), Warteschlange und Störungen (rechte Spalte), Gruppenstand (volle Breite darunter).
- **Erinnerungsmoment:** das freie Board — eine helle Sisal-Platte mit grünem Rand in einem Feld schwarzer Keile, mit dem nächsten Match schon daran. Es ist das Einzige auf der Seite, das anders leuchtet.
- **Signatur-Interaktion:** der Wurf. Das zugewiesene Match rastet ein (`land`, 240 ms), einmal orchestriert für Zuweisung, Ergebnis und Freigabe.
- Tastatur zuerst: die Board-Ziffer weist zu, und die Taste steht auf dem Control, das dasselbe tut.

## Zustände, die zur Fläche gehören

Vor dem Anwurf · Normalbetrieb · alles belegt mit langer Warteschlange · Störung (Doppelbelegung, gesperrtes Board, überlanges Match) · Gruppenphase durch, K.-o. nicht erzeugt · Turnier beendet · HTTP-409-Versionskonflikt · Verbindung weg mit sichtbarer Befehlswarteschlange. Setup zusätzlich: leere Liste, Entwurf mit unvollständiger Teilnehmerliste, Struktur mit Warnung, startbereit.

Bandbreiten: Teilnehmer 8/32/64, Gruppen 2/8/16, Boards 1/8/16, Gruppenmatches 6/48/96. Ein Teilnehmername im Fixture sprengt absichtlich die Zeile.

## Constraints, die diese Fläche binden

- Störungen gehören ins erste Viewport, nie in ein Modal, nie als anklickbares Abzeichen.
- 409 löst sichtbar auf und zeigt den Serverzustand; ausstehende Befehle werden namentlich gelistet, nie still wiederholt.
- Scheduler-Entscheide (`READY`, `BLOCKED_*`) werden angezeigt, nicht berechnet. Keine Turnier- oder Scheduling-Logik in Komponenten.
- Copy Deutsch (CH, kein Eszett), Dart-Fachbegriffe englisch.

## Offene Entscheide

- Die Phase-2-Endpunkte existieren nicht. Die Fläche läuft gegen `apps/web/src/lib/tournament-demo.ts`, dessen Fixtures durch die echten Zod-Schemas geparst werden. Ersetzen durch `apiRequest`, sobald die Endpunkte stehen; die Demo-Steuerung am Seitenfuss fällt dann weg.
- Realtime fehlt (Phase 3): entworfen für TanStack-Query-Aktualisierung, umschaltbar ohne Umbau.
- Ergebniskorrektur, KO-Baum und Audit-Ansicht sind als Nachbarn benannt, aber nicht entworfen.
- Kein verbindlicher WCAG-Level; die getroffenen Kontrastentscheide liegen bei 4.5:1 für Text.
