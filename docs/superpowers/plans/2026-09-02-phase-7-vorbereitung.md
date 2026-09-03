# Phase 7: E2E und Abnahme — Vorbereitung

**Kein Arbeitsplan.** Sessionregel 2 der Roadmap verlangt, dass der Phasenplan
zu Beginn seiner eigenen Session geschrieben wird. Diese Datei trägt nur die
Aufklärung, die sonst jede Session neu bezahlen müsste: was existiert, wie die
E2E-Maschinerie läuft, welche Namen die neuen Flächen tragen und welche vier
Entscheidungen der Plan treffen muss.

**Spec:** `docs/superpowers/specs/2026-09-02-team-encounter-league-design.md`,
Abschnitte „Browser-Tests" und „Tests und Abnahmekriterien"
**Roadmap:** `docs/superpowers/plans/2026-09-02-team-encounter-roadmap.md`
**Vorphase:** `docs/superpowers/plans/2026-09-02-phase-6-web-ui.md`, Abschnitt
„Ergebnis"

Budget nach Roadmap: ~400 LOC, 1,0–2,0 Mio. Token.

---

## Was die Spec verlangt

Wörtlich, aus dem Abschnitt „Browser-Tests":

> Begegnung ansetzen, beide Meldungen erfassen, zwei Slots parallel auf zwei
> Boards spielen, Doppelpaarungen vor Slot 9 melden, ein Doppel vollständig
> ausspielen, Ergebnis der Begegnung prüfen.

Dazu der Abschnitt „Vollständige Verifikation": alle fünf Befehle grün,
inklusive `pnpm test:e2e`.

## Vorgefundener Zustand

### Die E2E-Maschinerie

- **Ein** Spec-File: `apps/web/tests/foundation.spec.ts`, 421 Zeilen,
  sechs Fälle. Der letzte („a club can complete a match and start a generated
  tournament match", ab Zeile 195) ist das Vorbild: er baut die ganze Welt
  über die Oberfläche auf — Registrierung, Organisation, Spieler, Board,
  Match, Turnier — und dauert allein ~18 Sekunden.
- `apps/web/playwright.config.ts` startet **beide** Server selbst
  (`webServer`-Array): API auf Port 3101, Web auf 3100 mit
  `NEXT_DIST_DIR=.next-e2e`. Kein `reuseExistingServer`. Ein Chromium-Projekt,
  `fullyParallel: true`.
- `pnpm test:e2e` im Root baut zuerst sieben Pakete und ruft dann
  `apps/web/scripts/run-e2e.mjs`. Das Skript stellt `next-env.d.ts` nach dem
  Lauf wieder her, weil `next dev` die Datei auf das aktive `distDir`
  umschreibt — wer Playwright direkt aufruft, lässt eine veränderte
  versionierte Datei zurück.
- **Kein Seed.** Die einzige Direktschreibung in die Datenbank ist
  `apps/web/tests/registration-invitation.ts`:
  `createRegistrationInvitation(email, role = "TOURNAMENT_DIRECTOR")` legt
  Einladender, Organisation und Einladung an und liefert `{ claimToken,
  cleanup() }`. Aufräumen läuft über `test.afterEach` und ein
  `registrationSeeds`-Array. Alles Weitere entsteht durch Klicks.
- Nützliche Hilfe im Bestand: `visibleLabeledControl(container, label)` prüft,
  dass ein sichtbares `<label>` wirklich auf das Steuerelement zeigt, und gibt
  den Locator zurück.

### Die Flächen aus Phase 6

| Route | Komponente | Zeilen |
| --- | --- | --- |
| `/teams` | `components/league/team-roster.tsx` | 470 |
| `/liga` | `components/league/competition-list.tsx` | 194 |
| `/liga/neu` | `components/league/competition-setup.tsx` | 462 |
| `/liga/[id]` | `components/league/competition-detail.tsx` | 399 |
| `/liga/begegnungen/[id]` | `components/league/encounter-command-centre.tsx` | 376 |
| — | `slot-list.tsx` 265, `lineup-panel.tsx` 363, `doubles-panel.tsx` 189, `substitution-panel.tsx` 188, `encounter-scoreline.tsx` 102 | |
| `/live/begegnungen/[publicId]` | `components/live/live-encounter.tsx` | 161 |

Erreichbar über die Organisationsübersicht auf `/`: die Kacheln heissen
**Liga** („Wettbewerbe, Begegnungen und Spielrapporte") und **Teams**
(„Mannschaften und Kader für den Ligabetrieb"),
`components/tenant-dashboard.tsx`.

### Namen, an denen ein Test greifen kann

Sichtbare Beschriftungen; alle Formularfelder tragen zusätzlich eine stabile
`id`, sodass `getByLabel` zieht.

**`/teams`** — Felder „Name", „Kurzname", „Person aufnehmen", „Rolle",
„Organisation". Schaltflächen „Team anlegen", „Aufnehmen", „Archivieren",
„Aus dem Kader nehmen". Jede Teamkarte ist ein `article` mit dem Teamnamen
als zugänglichem Namen (`aria-labelledby`), also über
`getByRole("article", { name })` adressierbar.

**`/liga/neu`** — „Name", „Kurzname" (wird aus dem Namen vorgeschlagen, bis
das Feld angefasst wird), „Aufstellungspositionen" (2–6),
„Reguläre Doppel" (0–4), „Entscheidungsdoppel"
(`bei Gleichstand austragen` / `kein Entscheidungsdoppel`),
„Distanz je Spiel" (`Best of 1|3|5|7|9`), „Startscore Einzel",
„Startscore Doppel", „In-Regel", „Out-Regel", „Rundenbegrenzung",
„Punkte Sieg/Unentschieden/Niederlage", „Zusatzpunkt", „Mindestmeldung",
„Ausnahmemeldung", „Auswechslungen je Begegnung",
„Reguläre Doppel je Person". Schaltfläche „Wettbewerb anlegen"; danach
`router.push` auf `/liga/<id>?organisation=…`.

**`/liga/[id]`** — Ansetzformular „Spieltag", „Heim", „Gast", „Spielabend"
(`type="datetime-local"`), „Ort", Schaltfläche „Ansetzen"; danach `push` auf
`/liga/begegnungen/<id>?organisation=…`.

**`/liga/begegnungen/[id]`** — Schaltflächen „Begegnung starten",
„Auf Board starten", „Board freigeben", „Kampflos werten",
„Paarung melden", „Auswechseln", „Nichtantritt werten",
„Begegnung absagen", „Serverzustand übernehmen", „Weitere Person",
„Meldung erfassen" / „Meldung ersetzen" (der Text wechselt, sobald die Seite
gemeldet hat).

Die Seitenpanels sind benannte Regionen und trennen Heim von Gast:

```text
getByRole("region", { name: /^Meldung Heim/ })
getByRole("region", { name: /^Doppel Gast/ })
getByRole("region", { name: /^Auswechslung Heim/ })
```

Ohne diese Einschränkung sind „Position 1", „Person 1" und „Begründung"
mehrdeutig — sie kommen je Seite und je Slot vor. Die `id`-Muster als
Ausweichweg:

```text
nomination-<HOME|AWAY>-<position>          Meldung, Aufstellungsposition
nomination-<HOME|AWAY>-spare-<index>       Meldung, Ersatz
doubles-<HOME|AWAY>-<slotId>-<0|1>         Doppelpaarung
substitution-<HOME|AWAY>-position|in|sequence|reason
slot-<slotId>-board|winner|reason          Board, Walkover
```

`slotId` ist eine UUID vom Server; ein Test kommt an ihn über das
`for`-Attribut oder über die Slotzeile (`li`), nicht über eine Konstante.

„Kampflos werten" und die beiden Abschlusshandlungen liegen in `<details>`
und müssen erst aufgeklappt werden (`summary` klicken): „Kampflos werten",
„Nichtantritt werten", „Begegnung absagen". Auf `/liga/[id]` ebenso
„Begegnungsvorlage · N Spiele".

### Zustandswörter, die ein Test erwarten darf

Aus `apps/web/src/lib/league-format.ts` — die einzige Quelle dieser Wörter:

```text
Begegnung: Entwurf · Meldung offen · startbereit · läuft · beendet · abgesagt
Spiel:     wartet · bereit · läuft · gespielt · kampflos · entfällt
Ausgang:   Heim gewinnt · Gast gewinnt kampflos · offen ·
           Heim gewinnt nach Entscheidungsdoppel · … nach Nichtantritt
```

Der Grund, warum ein Spiel nicht startet, steht im Klartext und ist
zusicherbar (`apps/web/src/lib/encounter-view.ts`), zum Beispiel
„Gast hat die Doppelpaarung noch nicht gemeldet." oder
„Die Begegnung ist noch nicht gestartet."

## Vier Entscheidungen, die der Plan treffen muss

### 1. Wie gross wird die Begegnungsvorlage im Test?

Der reale Modus hat neunzehn Spiele. Achtzehn davon im Browser auszuspielen
ist kein Test, sondern eine Nachtschicht. `/liga/neu` lässt
**Aufstellungspositionen 2** und **Reguläre Doppel 1** zu; das ergibt
`2² = 4` Einzel, ein Doppel und den Entscheidungsslot, also sechs Spiele.
`buildEncounterTemplate` erzeugt das (Test dafür existiert:
`league-template.spec.ts`, Fall „kommt auch ohne Entscheidungsdoppel und mit
anderer Groesse aus"), und dieselbe Grösse benutzt bereits
`apps/api/src/competitions/competitions.integration.spec.ts`.

Empfehlung: zwei Positionen, ein reguläres Doppel, `Best of 1`. Damit
entscheidet ein Leg ein Spiel, und die Spec-Forderung „ein Doppel vollständig
ausspielen" bleibt echt erfüllt.

### 2. Wie kommt die Begegnung zu einem Ergebnis?

Ein Ergebnis entsteht erst, wenn alle regulären Slots entschieden sind. Die
Spec verlangt ausgespielt: zwei Einzel parallel auf zwei Boards und ein
Doppel. Die restlichen Slots über **„Kampflos werten"** zu entscheiden ist
kein Kunstgriff, sondern ein Weg, den das Reglement kennt (2.2.6) und den die
Fläche anbietet — er prüft nebenbei den Pflichtgrund und die Auditspur.

Alternative: Positionen auf 2 und reguläre Doppel auf 1 setzen und **alle**
sechs Spiele austragen. Teurer, aber ohne Hilfskonstrukt. Der Plan wählt.

### 3. Ein Fall oder mehrere?

`foundation.spec.ts` fährt alles in einem langen Fall, weil jeder Fall die
Welt neu aufbauen müsste (kein Seed, `fullyParallel`). Für die Begegnung
braucht es acht Spieler, zwei Teams, zwei Boards, einen Wettbewerb — das
zweimal aufzubauen kostet mehr als es trennt.

Empfehlung: ein grosser Fall „ein Verein trägt eine Begegnung aus" plus
höchstens ein kleiner, der ohne Anmeldung `/live/begegnungen/<publicId>`
prüft (die `publicId` kommt aus dem Link „Öffentliche Live-Ansicht" in der
Begegnungsleitung).

Ob der neue Fall nach `apps/web/tests/foundation.spec.ts` gehört oder in ein
eigenes `apps/web/tests/team-encounter.spec.ts`: eine eigene Datei, weil
`foundation.spec.ts` mit 421 Zeilen bereits an der Grenze ist und die beiden
Welten nichts teilen ausser der Registrierung.

### 4. Was wird aus der Registrierung wiederverwendet?

`createRegistrationInvitation` liefert eine `TOURNAMENT_DIRECTOR`-Einladung;
diese Rolle hat `team:manage`, `competition:manage`, `encounter:manage` und
`encounter:lineup` (`packages/domain/src/permissions.ts`). Sie reicht für den
ganzen Ablauf. Der Registrierungs- und Organisationsblock aus
`foundation.spec.ts` Zeile 199–232 ist Kopiervorlage; ob er in eine geteilte
Hilfe (`apps/web/tests/sign-up.ts`) wandert, entscheidet der Plan — zwei
Kopien wären die dritte Stelle mit demselben Ablauf.

## Fallen, die schon bekannt sind

1. **`NODE_ENV=production` beim Bauen.** Ohne die Variable bricht der
   Prerender von `/` mit `Cannot read properties of null (reading 'useState')`
   ab. `pnpm test:e2e` und `pnpm build` setzen sie; ein direktes
   `pnpm --filter @darts-platform/web build` nicht.
2. **`next-env.d.ts`.** Playwright nur über `pnpm test:e2e` starten, sonst
   bleibt die Datei verändert im Baum liegen.
3. **Die gegnerische Meldung ist verdeckt.** Solange nur eine Seite gemeldet
   hat, liefert der Server für die andere eine leere Liste, und die Fläche
   schreibt „Gemeldet. Die Aufstellung wird sichtbar, sobald beide Seiten
   gemeldet haben (Reglement 2.1.1)." Ein Test, der nach der ersten Meldung
   Namen erwartet, schlägt zu Recht fehl.
4. **Ein Slot ist erst zuweisbar, wenn die Begegnung `RUNNING` ist.** Vorher
   steht statt der Boardauswahl der Grund im Klartext. Reihenfolge also:
   beide Meldungen, „Begegnung starten", dann Boards.
5. **Doppelslots brauchen beide Paarungen**, bevor sie zuweisbar sind. Der
   Entscheidungsslot taucht in „Doppel <Seite>" erst auf, wenn der Server
   `decider.required` meldet — also erst bei Gleichstand nach allen regulären
   Spielen.
6. **Ein Board trägt zur selben Zeit ein Spiel.** „Zwei Slots parallel"
   braucht zwei Boards; Boards werden auf `/matches` angelegt (Feld „Neues
   Board", Schaltfläche „Hinzufügen").
7. **Das Scoreboard erreicht man aus der Slotzeile** über den Link
   „Scoreboard" (nur mit `match:score`), oder über `/matches`.
8. **`fullyParallel: true`** — jeder neue Fall braucht eigene E-Mail,
   Organisation und Teamnamen (`randomUUID()`-Suffix wie im Bestand).

## Zusätzlich offen aus Phase 6

- **Impeccable-Audit der Begegnungsleitung.** Die Fläche folgt DESIGN.md
  (Zehn-Stufen-Rampe, Zustandswort neben jeder Farbe, `min-h-11`), hat aber
  keine `.impeccable/surfaces/…`-Datei wie `/turniere/[id]`. Ob das in Phase 7
  gehört oder eine eigene Runde ist, entscheidet die Turnierleitung; der
  Aufwand liegt nicht im 400-LOC-Budget dieser Phase.
- **Abnahme.** Die Roadmap nennt Phase 7 „E2E + Abnahme". Was „Abnahme"
  konkret heisst — ein Durchgang mit der Turnierleitung an echten Daten, ein
  Deployment auf Staging, oder beides —, steht nirgends fest und ist die erste
  Frage der Session.

## Erste Schritte der Phase-7-Session

1. Diese Datei, die Roadmap und den Spec-Abschnitt „Browser-Tests" lesen.
   Nicht das Repo erkunden.
2. Die vier Entscheidungen oben treffen und im Plan festhalten.
3. Plan schreiben nach `docs/superpowers/plans/2026-09-02-phase-7-e2e.md`.
4. Feature-Branch `feature/phase-7-e2e` von `develop`.
5. Umsetzen, dann die volle Verifikation inklusive `pnpm test:e2e`.
6. Ergebnis an den Plan hängen und nach `develop` mergen — nicht nach
   `origin`.
