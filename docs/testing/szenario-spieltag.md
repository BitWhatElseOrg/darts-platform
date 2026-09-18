# Vorlage: Szenario-Test unter Realbedingungen (Block E)

Stand: 17.09.2026. Gehört zu Spec
[Block E](../superpowers/specs/2026-09-17-go-live-testprogramm-design.md#block-e--szenario-test-unter-realbedingungen).
Wird vom Betreiber mit mehreren Personen und echten Geräten durchgeführt,
gegen `staging` mit den Custom Domains `staging.dartbase.ch` /
`api-staging.dartbase.ch`. Alle Namen, Adressen und Vereine in dieser Vorlage
sind fiktiv; beim tatsächlichen Test durch fiktive Testnamen ersetzen
(`test-*@example.test`), niemals echte Personendaten verwenden.

Diese Vorlage startet erst, wenn das Abnahmeprotokoll
(`docs/testing/abnahmeprotokoll-go-live.md`) die Freigabe für Block E zeigt
(alle Fälle aus Block A–D grün oder bewusst akzeptiert).

## Ziel

Prüfen, ob die Plattform einen echten Spieltag mit mehreren gleichzeitigen
Nutzern, echten Mobilgeräten und echten Störungen (WLAN, Sperrbildschirm,
Tab-Wechsel) unbeschadet übersteht: keine verlorenen Visits, kein
inkonsistenter Spielstand, keine sichtbare Verwirrung bei den Rollen, keine
manuelle Korrektur durch die Turnierleitung nötig, die nicht über die
Anwendung selbst möglich wäre.

## Rollen

| Rolle | Anzahl | Verantwortung in einem Satz |
| --- | --- | --- |
| Turnierleitung | 1 | Legt Turnier/Encounter an, weist Boards zu, entscheidet bei Störungen und Reklamationen, führt das Protokoll |
| Scorer | 3 | Trägt Visits auf dem zugewiesenen Board-Gerät ein, meldet Auffälligkeiten sofort der Turnierleitung |
| Anzeige | 1 | Betreut den Anzeige-Bildschirm (Board- bzw. Turnierübersicht), meldet, wenn die Anzeige hängt oder veraltet ist |
| Zuschauer | 5 | Verfolgt das öffentliche Turnier/Match auf dem eigenen Gerät, meldet auffälliges Verhalten (Verzögerung, falsche Reihenfolge, Absturz) |

## Geräteliste

Fiktive Gerätekennungen für das Protokoll, keine echten Seriennummern
verwenden.

| Kennung | Gerät | Rolle | Netz |
| --- | --- | --- | --- |
| GERAET-01 | Laptop | Turnierleitung | WLAN Halle |
| GERAET-02 | Tablet, Board 1 | Scorer 1 | WLAN Halle |
| GERAET-03 | Tablet, Board 2 | Scorer 2 | WLAN Halle |
| GERAET-04 | Tablet, Board 3 | Scorer 3 | WLAN Halle |
| GERAET-05 | Smart-TV/Beamer | Anzeige | WLAN Halle |
| GERAET-06 bis GERAET-10 | Smartphones, gemischt Android/iOS | Zuschauer 1–5 | Mobilfunk (bewusst nicht das Hallen-WLAN, damit ein Netzausfall der Halle die Zuschauersicht nicht mit betrifft) |

Ergänzen: Betriebssystem- und Browserversion je Gerät vor Testbeginn im
Protokollkopf festhalten (relevant für spätere Fehlersuche).

## Ablauf Turniertag (16 Spieler, Gruppen → KO, 4 Boards)

Zeiten sind Richtwerte ab Start `T+0`, in der Protokolltabelle durch die
tatsächliche Uhrzeit ersetzen.

| Zeit | Schritt | Verantwortlich |
| --- | --- | --- |
| T+0 | Turnier mit 16 fiktiven Teilnehmenden anlegen, 4 Gruppen à 4, Qualifikation 2 pro Gruppe → KO mit 8 | Turnierleitung |
| T+5 | 4 Boards anlegen und dem Turnier zuweisen; auf jedem Board-Gerät den Anzeige-/Scoring-Zugang öffnen | Turnierleitung, Scorer 1–3 |
| T+10 | Anzeige-Bildschirm auf die Turnierübersicht stellen; 5 Zuschauergeräte auf die öffentliche Turnieransicht (`publicId`) verbinden | Anzeige, Zuschauer 1–5 |
| T+15 | Gruppenphase starten: pro Board laufen abwechselnd Gruppenmatches, Scorer tragen Visits in Echtzeit ein | Scorer 1–3 |
| T+15 bis T+45 | Während laufender Gruppenphase: Störung 1 (WLAN-Ausfall, siehe unten) an einem Board auslösen | Turnierleitung |
| T+50 | Gruppenphase abschliessen, Qualifikation prüfen (2 pro Gruppe), Turnierleitung bestätigt die KO-Setzung | Turnierleitung |
| T+55 | KO-Runde (Achtelfinale ab 8) starten, auf 4 Boards verteilt | Scorer 1–3 |
| T+60 bis T+80 | Während KO läuft: Störung 2 (Sperrbildschirm mitten im Visit) und Störung 3 (Tab schliessen/öffnen) an je einem anderen Board auslösen, zeitlich versetzt | Turnierleitung |
| T+90 | Halbfinals und Final auf einem Board, Anzeige und alle Zuschauergeräte verfolgen live | Anzeige, Zuschauer 1–5 |
| T+100 | Turnier abschliessen, Endstand mit lokal von Hand mitgeschriebenem Zwischenstand vergleichen | Turnierleitung |
| T+105 | Abschlussfragen im Plenum, Protokoll konsolidieren | Turnierleitung |

## Ablauf Liga-Spieltag (ein Encounter nach LIGA-REGLEMENT.md)

Referenz: [LIGA-REGLEMENT.md](../../LIGA-REGLEMENT.md). Ziffern in Klammern
beziehen sich auf dieses Dokument.

| Zeit | Schritt | Verantwortlich | Reglement |
| --- | --- | --- | --- |
| T+0 | Zwei fiktive Teams mit je 4 Stammspielern und 1 Ersatzspieler anlegen, Encounter zwischen ihnen erstellen | Turnierleitung | 2.1.1 |
| T+5 | Aufstellung (Spielrapport) erfassen: Heimteam zuerst, verdeckt für den Gastcaptain, danach Gastaufstellung | Turnierleitung, 2 Scorer als Captains | 2.1.1 |
| T+10 | Doppelpaarungen unmittelbar vor der Begegnung festlegen (2 Doppel, jeder Spieler höchstens einmal, ausser sudden death) | 2 Scorer als Captains | 2.2.1, 2.2.3 |
| T+15 | Runde 1 (4 Einzel) spielen und eintragen | Scorer 1–3 | 2.2.8 |
| T+30 | Runde 2 (4 Einzel + 2 Doppel) spielen und eintragen | Scorer 1–3 | 2.2.8 |
| T+45 | Eine Sanktion bewusst auslösen: fiktiver Spieler erscheint nach zweitem Aufruf nicht innert 2 Minuten an der Abwurflinie → Spiel 0:1 Spiele/0:2 Sätze werten | Turnierleitung | 2.2.6 |
| T+50 | Runde 3 (4 Einzel) spielen und eintragen | Scorer 1–3 | 2.2.8 |
| T+65 | Runde 4 (4 Einzel) spielen und eintragen, Spielstand prüfen (klarer Sieg ab 10:8 oder 9:9-Unentschieden) | Scorer 1–3 | 2.2.2, 2.2.8 |
| T+80 | Bei 9:9: sudden-death-Doppel austragen, sonst überspringen | 2 Scorer als Captains | 2.2.2 |
| T+85 | Encounter abschliessen, Spielrapport-Endstand mit der Anwendung vergleichen | Turnierleitung | 2.4.1 |

## Störungen

Jede Störung wird bewusst und angekündigt an die Turnierleitung ausgelöst,
nicht an die betroffene Rolle — sie soll die Störung wie im Ernstfall
erleben.

### Störung 1: WLAN 2 Minuten aus während des Scorings

- **Auslösung:** WLAN-Zugangspunkt der Halle für exakt 2 Minuten ausschalten,
  während ein Scorer mitten in einem Leg Visits einträgt.
- **Erwartung:** Das Scoring-Gerät zeigt einen sichtbaren Verbindungsstatus
  (offline/getrennt). Bereits eingetragene Visits gehen nicht verloren.
  Visits, die während der Trennung eingegeben werden, warten sichtbar in
  einer Offline-Queue oder werden verweigert statt still verworfen. Nach
  Rückkehr des WLAN synchronisiert das Gerät automatisch und ohne
  Doppel-Visit.
- **Beobachten:** Was zeigt das Gerät während der Trennung genau an? Wie
  lange dauert die Synchronisation nach Rückkehr? Stimmt der Spielstand
  danach mit der Realität (den tatsächlich geworfenen Darts) überein? Musste
  jemand manuell eingreifen?

### Störung 2: Handy-Sperre mitten im Visit

- **Auslösung:** Scoring-Gerät (Smartphone/Tablet) während der Eingabe eines
  Visits (nach dem ersten oder zweiten Dart, vor dem Bestätigen) sperren
  (Bildschirm aus/Sperrbildschirm) und nach ca. 30 Sekunden wieder entsperren.
- **Erwartung:** Der angefangene Visit ist nach dem Entsperren entweder
  unverändert vorhanden (Eingabe wurde clientseitig gehalten) oder eindeutig
  verworfen mit klarer Aufforderung, neu einzugeben — in keinem Fall ein
  halb übernommener oder doppelt gezählter Visit.
- **Beobachten:** In welchem Zustand ist die Eingabemaske nach dem Entsperren?
  Muss der Scorer sich neu anmelden? Ist der Spielstand vor/nach der Sperre
  identisch mit dem, was auf dem Board tatsächlich geworfen wurde?

### Störung 3: Browser-Tab schliessen und neu öffnen

- **Auslösung:** Auf einem Zuschauergerät (oder alternativ dem Anzeige-Gerät)
  den Tab mit der öffentlichen Turnier-/Matchansicht während eines laufenden
  Legs schliessen und nach ca. 1 Minute über denselben Link neu öffnen.
- **Erwartung:** Die Ansicht lädt nach dem Wiederöffnen sofort den aktuellen
  Spielstand (kein veralteter Stand, kein Blindflug), ohne dass ein manueller
  Refresh mehrfach nötig ist, und ohne dass zwischenzeitliche Ereignisse
  fehlen.
- **Beobachten:** Wie lange dauert es bis zum korrekten Stand nach dem
  Neuladen? Wird ein Ladezustand sichtbar angezeigt? Stimmt der geladene
  Stand mit dem tatsächlichen Spielstand zum Zeitpunkt des Ladens überein?

## Beobachtungspunkte je Rolle

- **Turnierleitung:** Bleibt die Turnier-/Encounter-Übersicht während des
  gesamten Tages konsistent (keine falschen Zwischenstände, keine
  hängenden Matches)? Musste ein Zustand von Hand korrigiert werden, der
  eigentlich über die Anwendung hätte laufen sollen?
- **Scorer:** Wie viele Interaktionen braucht ein Visit tatsächlich (Ziel:
  möglichst wenige)? Ist der eigene Spielstand jederzeit eindeutig lesbar?
  Gab es einen Moment mit Unsicherheit, ob ein Visit angekommen ist?
- **Anzeige:** Bleibt die Anzeige ohne manuelles Eingreifen aktuell? Wie
  schnell erscheinen neue Ergebnisse nach einem Legabschluss?
- **Zuschauer:** Ist die Live-Ansicht ohne manuellen Refresh aktuell? Ist die
  Reihenfolge der Ereignisse nachvollziehbar? Gab es sichtbare Fehler,
  Ladezustände ohne Ende, oder einen Absturz der Seite?

## Protokolltabelle

Eine Zeile je Beobachtung, unabhängig davon, ob es sich um ein geplantes
Störungsexperiment oder eine unerwartete Auffälligkeit handelt. Schwere:
`niedrig` / `mittel` / `hoch` / `kritisch` (analog zu den Befunden in den
übrigen Testprotokollen unter `docs/testing/protokolle/`).

| Zeit | Rolle | Beobachtung | Schwere | Screenshot |
| --- | --- | --- | --- | --- |
| | | | | |
| | | | | |
| | | | | |

## Abschlussfragen

Im Plenum direkt im Anschluss an den Testtag zu beantworten, bevor Details
verblassen:

1. Gab es einen Moment, in dem eine Rolle nicht wusste, was als Nächstes zu
   tun ist oder ob eine Aktion erfolgreich war?
2. Ging irgendwo ein Visit, ein Legergebnis oder ein Encounter-Ergebnis
   verloren oder musste rekonstruiert werden?
3. Welche der drei Störungen war am unangenehmsten zu erleben, unabhängig
   davon, ob die Anwendung korrekt reagiert hat?
4. Gab es eine Stelle, an der die Turnierleitung manuell in die Datenbank
   oder Konfiguration hätte eingreifen müssen, um weiterzumachen?
5. Würde eine reale Turnierleitung, ein realer Scorer, ein reales Publikum
   diesen Ablauf ohne Vorbereitung durch diese Vorlage verstehen?
6. Welche Befunde aus der Protokolltabelle gehören vor einem echten Go-Live
   noch behoben, und welche sind akzeptabel?
