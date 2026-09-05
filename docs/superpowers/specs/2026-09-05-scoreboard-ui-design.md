# Scoreboard als Vollbild-Scoringfläche

**Datum:** 5. September 2026
**Status:** Entwurf, zur Freigabe
**Geltungsbereich:** Scoring-Oberfläche im Web, Visit-Schema, Scoring-Engine,
Visit-Schreibpfad in der API, neue Tabelle `visit_darts`, Statistik-Endpunkt für
Schnellwerte, Live-Bezug im Matchzustand
**Vorlage:** Screenshots einer bestehenden Scoring-App, vom Auftraggeber als
Zielbild übergeben (Kopfzeile, zweigeteilte Spielerfläche, Dart-Band,
Dart-Keypad, Runden-Keypad, Bestätigungsfläche, Einstellungs-Modal)

## Ziel

Die heutige Scoring-Oberfläche ist ein Kärtchen mit einem Zahlenfeld: eine
Aufnahme wird als Summe getippt, ein Dialog fragt bei einem Checkout nach
Doppelfeld und Darts. Das ist am Board langsam und liefert keine Daten unterhalb
der Aufnahme.

Nach der Umsetzung ist die Match-Seite eine Vollbildfläche, die Wurf für Wurf
bedient wird: ein Keypad mit Segmenten und den Umschaltern `DOUBLE` und
`TRIPLE`, ein Dart-Band, das die laufende Aufnahme zeigt, eine optionale
Bestätigungsfläche und ein Einstellungs-Modal, das zwischen Dart- und
Runden-Eingabe umschaltet. Die einzelnen Würfe werden dauerhaft gespeichert und
machen die Regelprüfung exakt statt heuristisch.

## Abgrenzung

Nicht Teil dieses Vorhabens:

- **Caller** (Sprachausgabe der Punkte) und **Spielerbilder** aus dem
  Einstellungs-Modal der Vorlage.
- **Gemischter Eingabemodus.** Es gibt genau zwei Modi: Dart und Runde.
- **Leg-Entscheidungen aus dem Reglement** (Legbeginn ab Leg 3, Ausbullen an der
  Rundengrenze). Die Kommandos existieren in Engine und API, haben heute keine
  Oberfläche, und bekommen hier auch keine.
- **Statistik-Auswertungen über die neuen Wurfdaten** (Trefferbild, Doppelquote).
  Die Daten entstehen hier, ausgewertet werden sie in einem eigenen Vorhaben.
- **Helles Farbschema der Vorlage.** Übernommen werden Aufbau und Interaktion,
  nicht die Palette; es gilt weiterhin `DESIGN.md`.

## Entscheidungen und ihre Begründung

| Entscheidung | Begründung |
| --- | --- |
| Einzelwürfe in eigener Tabelle `visit_darts`, nicht als `jsonb` | AGENTS.md Abschnitt 10 verlangt DB-Constraints statt reiner Applikationslogik; die spätere Statistik ist relational deutlich billiger |
| Engine prüft exakt, sobald Würfe vorliegen | Gespeicherte Daten und Regelentscheid dürfen nicht auseinanderlaufen |
| Ohne Würfe bleibt der heutige heuristische Pfad | Der Runden-Modus bleibt ohne Änderung gültig, Altdaten ebenso |
| Client rechnet nur Vorschau, Engine entscheidet | AGENTS.md Abschnitt 4: keine Geschäftslogik in der Oberfläche |
| Einstellungen gerätelokal in `localStorage` | Sie gehören zum Scoring-Gerät am Board, nicht zum Benutzerkonto |
| Eine Route, keine zweite Ansicht | Keine Parallelstruktur neben der bestehenden Match-Seite |
| Schnellwerte gestuft: Person, sonst Organisation, sonst Standard | Immer sechs sinnvolle Tasten, auch bei einer Person ohne Historie |

## Datenmodell

### Tabelle `visit_darts`

| Spalte | Typ | Regel |
| --- | --- | --- |
| `id` | uuid | Primärschlüssel |
| `organization_id` | uuid | FK auf `organizations`, cascade |
| `visit_id` | uuid | FK auf `visits`, cascade |
| `dart_index` | integer | 1 bis 3 |
| `segment` | integer | 0 bis 20 oder 25 |
| `multiplier` | integer | 1 bis 3 |
| `value` | integer | `segment * multiplier` |

Constraints:

- `unique(visit_id, dart_index)`
- `check` Segment in `0..20` oder `= 25`
- `check` Multiplikator in `1..3`
- `check` bei `segment = 0` ist `multiplier = 1`
- `check` bei `segment = 25` ist `multiplier <= 2`
- `check` `value = segment * multiplier`
- `index` auf `(organization_id, visit_id)`

Zurückgenommene Aufnahmen behalten ihre Würfe; `visits.reverted_at` bleibt die
einzige Wahrheit über den Widerruf.

Dieselbe Migration legt einen Index `(organization_id, thrower_player_id)` auf
`visits` an. Ohne ihn ist die Aggregation der Schnellwerte ein Full Scan.

### Schema-Erweiterungen

`submitVisitSchema` bekommt ein optionales `darts`:

```ts
darts?: readonly { segment: number; multiplier: 1 | 2 | 3 }[]
```

Refinements: Länge gleich `dartsThrown`; Summe der `segment * multiplier` gleich
`points`; die Segment- und Multiplikatorregeln der Tabelle. `matchVisitSchema`
gibt die Würfe zurück, damit die Aufnahmeliste und das Dart-Band sie zeigen
können.

`checkoutDouble` und `checkoutAttempts` bleiben im Schema, werden bei
vorhandenen Würfen aber serverseitig aus ihnen abgeleitet statt vom Client
übernommen.

## Scoring-Engine

`SubmitVisitCommand` bekommt `darts?: readonly Dart[]`. Liegen Würfe vor:

- **Double In** wertet die Aufnahme ab dem ersten Doppel: Würfe davor zählen
  nicht, und eine Aufnahme ganz ohne Doppel ist kein Fehler, sondern eine
  Aufnahme mit null angerechneten Punkten. `points` bleibt die rohe Summe,
  `appliedPoints` die angerechnete. Ohne Würfe gilt weiter `opensOnDouble`.
- **Double Out** prüft den letzten Wurf auf `multiplier === 2` (Bull `25×2`
  zählt), **Master Out** auf `multiplier >= 2`.
- **`checkoutDouble`** ist das Segment des letzten Wurfs, **`checkoutAttempts`**
  die Zahl der Würfe dieser Aufnahme, die auf ein gültiges Finishfeld gingen.
- Die Summe wird gegen `points` geprüft; eine Abweichung ist ein
  `ScoringValidationError`, kein stiller Ausgleich.

Fehlen die Würfe, gilt unverändert der heutige Pfad über `isAttainableScore`,
`opensOnDouble` und `finishesOnMasterSegment`.

Die Engine bleibt infrastrukturfrei und deterministisch testbar.

## API

Der Visit-Pfad in `apps/api/src/matches/matches.repository.ts`:

1. `darts` fliesst in das `SUBMIT_VISIT`-Kommando.
2. Nach dem Insert des Visits werden die Wurfzeilen **in derselben Transaktion**
   geschrieben.
3. Die gespeicherte Kommando-Payload in `score_commands` führt die Würfe mit,
   und `parseStoredCommand` liest sie zurück. Andernfalls erzeugt ein Replay
   einen anderen Zustand als die ursprüngliche Ausführung.

Unverändert bleiben Idempotenz über `commandId`, Versionsprüfung, Board-Lock,
Audit und der Outbox-Pfad.

### Schnellwerte

Neu: `GET /api/v1/organizations/{organizationId}/players/{playerId}/statistics/frequent-scores`
— unter dem bestehenden Statistik-Pfad, damit es nur eine Konvention gibt.

Antwort:

```json
{ "scores": [26, 41, 45, 60, 81, 85], "source": "PLAYER" | "ORGANIZATION" | "DEFAULT" }
```

Aggregation über `visits.points`, ohne zurückgenommene Aufnahmen und ohne
Ausgang `BUST`, gruppiert und nach Häufigkeit absteigend auf sechs geschnitten,
ausgegeben aufsteigend sortiert. Unter dreissig gewerteten Aufnahmen der Person
greift dieselbe Aggregation über die Organisation, darunter der feste Satz
`26/41/45/60/81/85`. Tenant-gebunden und über dieselbe Leseberechtigung
autorisiert wie die übrigen Statistikabfragen.

## Oberfläche

### Aufbau

Die Vollbildfläche lebt unter der bestehenden Route `/matches/[matchId]`. Sie
füllt `100dvh` und scrollt nicht; Kopfzeile, Spielerbereich und Keypad teilen
sich die Höhe über ein Grid, das Keypad bekommt den Rest. Die heutige
Seitenhülle mit `PageNav`, Organisationsname und Match-Titel entfällt dort.

**Kopfzeile.** Links Zurück-Pfeil (`matchBackLink`), Leg und Runde
(`LEG 3 / RUNDE 4`; die Rundennummer wird aus den Aufnahmen des laufenden Legs
abgeleitet). Mitte: Startscore gross, darunter die Spielart aus `variantLabel`.
Rechts der LIVE-Knopf und das Zahnrad.

Der LIVE-Knopf braucht ein Ziel, das der Matchzustand heute nicht kennt:
`matchStateSchema` trägt weder Turnier- noch Begegnungsbezug. Er kommt dazu als

```ts
liveTarget:
  | { kind: "TOURNAMENT"; tournamentId: string }
  | { kind: "ENCOUNTER"; publicId: string }
  | null
```

abgeleitet im Lesepfad über `tournament_matches.match_id` beziehungsweise
`encounter_slots.match_id` — beide Beziehungen existieren, `encounters` trägt
bereits eine `public_id`. Daraus wird das Ziel: bei `TOURNAMENT` mit
zugewiesenem Board `/live/{tournamentId}/board/{boardId}`, ohne Board
`/live/{tournamentId}`; bei `ENCOUNTER` `/live/begegnungen/{publicId}`. Ist
`liveTarget` null — ein freies Match ohne Wettbewerbsbezug — erscheint der Knopf
nicht.

**Statusleiste.** Direkt darunter, nur bei Vorkommnis: fremde Board-Steuerung
mit Übernahme, Offline-Zustand, Anzahl wartender Aufnahmen, Versionskonflikt,
Fehlermeldung. Ohne Vorkommnis kostet sie keine Höhe.

**Spielerbereich.** Zwei Spalten, die aktive Seite in Emerald geflutet, die
inaktive in Slate-900. Pro Seite Average, Restscore in `text-display`, letzte
Aufnahme als kleine Zahl daneben, Name, Legs und Sets. Im Doppel stehen beide
Namen, die werfende Person als gefülltes Plättchen hervorgehoben.

**Dart-Band.** Im Dart-Modus ein schmales Band pro Seite mit drei Plätzen, die
die laufende Aufnahme als `T 5`, `20`, `T 5` zeigen; leere Plätze bleiben als
gedämpfte Silhouetten stehen. Im Runden-Modus entfällt das Band.

### Dart-Modus

Keypad: 1–20, `0` für Fehlwurf, `25`, `50`, Rücktaste, dazu die Umschalter
`DOUBLE` und `TRIPLE`, die für den nächsten Wurf gelten und danach abfallen. Bei
aktivem `TRIPLE` sind `25` und `50` gesperrt.

Jeder Tastendruck legt einen Wurf in die laufende Aufnahme und rechnet den
Restscore als Vorschau herunter. Die Rücktaste nimmt den letzten Wurf zurück;
bei leerer Aufnahme wird sie zum Server-Undo der letzten gesendeten Aufnahme.

Die Aufnahme endet nach dem dritten Wurf, bei einem Checkout oder bei einem
Bust; Checkout und Bust erkennt der Client aus der Vorschau und schliesst die
Aufnahme mit der tatsächlich geworfenen Zahl Darts ab. Weicht die Antwort der
Engine ab, gilt die Antwort. Der Checkout-Dialog entfällt im Dart-Modus
vollständig.

### Runden-Modus

Ziffern 1–9 und 0, sechs Schnellwerte aus dem Endpunkt, Rücktaste, Absenden. Die
getippte Zahl steht gross über dem Feld. Werte über 180 oder rechnerisch
unmögliche Summen sperren die Absendetaste, geprüft mit derselben
Attainability-Regel wie in der Engine. Leere Eingabe plus Rücktaste ist Undo.

Entspricht die Eingabe genau dem Restscore und ist `Checkout-Darts bestätigen`
an, folgt der bestehende Checkout-Dialog in neuer Gestalt: benötigte Darts als
drei grosse Tasten, Doppelfeld darunter und vorbelegt, wenn rechnerisch nur eine
Möglichkeit bleibt. Ist die Einstellung aus, geht die Aufnahme mit drei Darts
und ohne Doppelangabe raus.

### Bestätigung

Ist `Punktzahl bestätigen` an, legt sich nach dem Ende der Aufnahme eine Fläche
über das Keypad: grosse Summe, `GEWORFEN`, darunter `‹` und `WEITER`. Zurück
verwirft die Bestätigung und lässt die Würfe zum Korrigieren stehen, `WEITER`
sendet. Ist zusätzlich `automatisch bestätigen` an, sendet die Fläche nach
kurzer Anzeige von selbst; ein Tippen sendet sofort. Ist `Punktzahl bestätigen`
aus, geht die Aufnahme ohne Zwischenschritt raus. Bei einem Bust zeigt dieselbe
Fläche `BUST`.

### Einstellungs-Modal

Ein `dialog` mit `showModal` und echtem Fokusfang. Oben die Segmentwahl
`Dart | Runde`. Darunter die Schalter des gewählten Modus: im Dart-Modus
`Punktzahl bestätigen` und `automatisch bestätigen` (der zweite ausgegraut,
solange der erste aus ist), im Runden-Modus `Checkout-Darts bestätigen`. Die
Schalter sind Knöpfe mit `aria-checked` und tragen sichtbar `NEIN`/`JA`.

Darunter das aus der Fläche verdrängte Beiwerk: die letzten Aufnahmen als Liste,
die Übernahme der Board-Steuerung, der Rückweg zu Turnier oder Begegnung.
Abschluss: `SPIEL FORTSETZEN` schliesst; `SPIEL BEENDEN` führt in den
bestehenden Abbruch-Dialog mit Begründungspflicht und erscheint nur bei
entsprechender Rolle.

### Persistenz der Einstellungen

Versionierter `localStorage`-Schlüssel, beim Lesen per Zod geprüft; scheitert
das, gelten die Standardwerte. Gelesen über `useSyncExternalStore`, damit
Server- und erster Client-Render nicht auseinanderlaufen. Standard: Dart-Modus,
Bestätigung an, automatisches Absenden aus.

### Barrierefreiheit

Ausgeschriebene Tastenbezeichnungen (`Triple 5`, nicht `T 5`), Ansage von
Restscore und Ausgang über eine höfliche Live-Region, Mindestgrösse für
Daumenbedienung auf allen Tasten, Bestätigungsfläche per Tastatur erreichbar,
keine Aussage allein über Farbe.

## Zerlegung der Komponente

`match-scoreboard.tsx` trägt heute 369 Zeilen und würde mit dem Keypad weit über
700 wachsen. Der Schnitt:

```text
use-match-scoring        Mutationen, Offline-Queue, Board-Lock, Vorschau-Zustand
scoreboard-header        Leg, Runde, Spielart, LIVE, Zahnrad, Zurück
scoreboard-status        Statusleiste
scoreboard-sides         Spielerpanels und Dart-Band
dart-keypad              Segmenttasten und Umschalter
round-keypad             Ziffern, Schnellwerte, Absenden
visit-confirmation       Bestätigungsfläche
scoreboard-settings      Modal
```

Die Keypad-Logik liegt als reine Reducer-Funktion neben den Komponenten und ist
ohne Rendering testbar. Keine Geschäftslogik in den Darstellungsteilen.

## Randfälle

- **Versionskonflikt während einer Aufnahme:** Statusleiste meldet, Zustand wird
  nachgeladen, eingegebene Würfe bleiben zum erneuten Absenden stehen.
- **Wechsel von werfender Person oder Leg durch die Serverantwort:** die
  angefangene Aufnahme wird verworfen, sie gehörte zu einem vergangenen Zustand.
- **Beendetes Match:** Keypad weicht der Ergebnisfläche.
- **Doppel:** Würfe gehören der werfenden Person, nicht der Seite.
- **Offline:** eingereihte Aufnahmen tragen ihre Würfe im Body mit und werden
  unverändert nachgespielt.
- **Ausfall der Schnellwerte-Abfrage:** Standardsatz; die Eingabe hängt nie an
  dieser Abfrage.

## Tests

**Scoring-Engine.** Double In am ersten Wurf; Double und Master Out am
tatsächlichen letzten Segment; Bust mit einem und zwei Würfen; abgeleitetes
`checkoutDouble` und `checkoutAttempts`; Ablehnung bei Summenabweichung und bei
falscher Wurfanzahl; Bull als `25×1` und `25×2`, `25×3` unmöglich;
Replay-Determinismus aus der gespeicherten Payload.

**Schemas.** Die Refinements auf `submitVisitSchema`.

**Datenbank.** Migration und Constraints als Integrationstest.

**API.** Wurfzeilen in derselben Transaktion; wiederholte `commandId` erzeugt
keine zweiten Wurfzeilen; Undo lässt die Würfe stehen; Schnellwerte
tenant-isoliert und über alle drei Stufen.

**Web.** Keypad-Reducer als reine Funktion: Wurfeingabe, Rücktaste, Umschalter,
Bust- und Checkout-Vorschau, die drei Bestätigungsvarianten, Gültigkeitsprüfung
im Runden-Modus, Lesen kaputter Einstellungen.

**E2E.** Ein Leg Wurf für Wurf bis zum Checkout, dazu ein Moduswechsel im Modal.

## Reihenfolge der Umsetzung

1. Schema und Migration (`visit_darts`, Index auf `visits`)
2. Scoring-Engine mit exakter Prüfung bei vorhandenen Würfen
3. API-Visit-Pfad samt Kommando-Payload und Replay
4. Schnellwerte-Endpunkt und `liveTarget` im Matchzustand
5. Zerlegung der heutigen Komponente in Hook und Darstellungsteile, ohne
   Verhaltensänderung
6. Vollbildlayout, Dart-Keypad, Runden-Keypad, Bestätigungsfläche, Modal

Die Schritte 1 bis 4 ändern nichts an der Oberfläche und sind einzeln testbar
und einzeln ausrollbar.

## Definition of Done

Funktion implementiert, Typen strikt, serverseitig validiert, autorisiert,
tenant-sicher, DB-Constraints vorhanden, Tests je Ebene vorhanden, Fehlerfälle
behandelt, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` und
`pnpm test:e2e` grün, Dokumentation aktualisiert.
