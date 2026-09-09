# Einzelrangliste (Reglement A1.6–A1.10) — Design

Stand 2026-09-09. Bounded-bis-architektural eingestuft, weil die Rechnung
selbst klein ist, aber mehrere fachliche Randfälle (Aushilfen, Auswechslung,
Nichtantritt) entscheiden müssen, was als „gespielte Begegnung" zählt — das
gehört in eine Spec, nicht in einen stillen Sonderfall (AGENTS.md §6).

Verwandt: [[team-encounter-phase-status]] (Rohdaten liegen bereits auf
`encounters`/`encounter_slots`), [[audit-offene-punkte]] (Ursprung dieses
Punkts), `docs/superpowers/specs/2026-09-02-team-encounter-league-design.md`
(Entscheid: nur Einzel, keine Doppel, Zeilen 975–985).

## Ziel

Reglement Anhang 1, A1.6–A1.10: eine Rangliste je Wettbewerb, die die
Trefferquote und den Fleiss einer Person misst — abgeleitet aus den bereits
gespeicherten Einzelergebnissen, ohne neue Eingabe und ohne Migration.

## Nicht im Umfang

- Doppel (Spec-Entscheid vom 2026-09-02, siehe oben).
- Saisonübergreifende Kumulation — die Rangliste ist je Wettbewerb, wie die
  Ligatabelle.
- Die „besondere Auszeichnung" der besten drei Personen (A1.10) — reine
  Anzeigefrage ausserhalb dieser Runde, kein Rechenbedarf.

## Bestand (geprüft 2026-09-09)

- `packages/league-engine/src/standings.ts` rechnet die Ligatabelle rein
  funktional aus `StandingsInput` (Team-IDs + abgeschlossene Begegnungen).
  Gleiches Muster für die neue Rangliste.
- `resolveSlotOccupancy` (`lineup.ts:358`) löst pro Slot auf, welche Person
  auf welcher Seite steht — bei Einzeln aus Position, Meldung und
  Auswechslungshistorie. Genau diese Funktion muss auch die Rangliste nutzen,
  damit eine ausgewechselte Person korrekt mit drei statt vier Einzeln
  erscheint.
- `encounterSlots` (Schema `packages/database/src/schema.ts:1325`) trägt
  bereits `discipline`, `homePosition`/`awayPosition`, `status`, `resultType`,
  `winnerSide`, `homeLegs`/`awayLegs`, `legsToWinSet` je Slot — alles, was die
  Rechnung braucht, ohne neue Spalte.
- `declareForfeit` (`apps/api/src/encounters/encounters.repository.ts:1004`)
  setzt bei Nichtantritt alle noch nicht gespielten Slots auf `CANCELLED`,
  nicht auf `WALKOVER` — ein Nichtantritt erzeugt also **keine** Einzelzeilen
  für die nicht angetretene Seite. Nur tatsächlich beendete Slots
  (`COMPLETED`/`WALKOVER`) zählen für die Rangliste.
- `competitions.controller.ts`/`.service.ts`/`.repository.ts` haben mit
  `GET .../standings` bereits den vollständigen Pfad, den diese Runde für
  `player-ranking` spiegelt: Berechtigung `competition:read`, kein
  Sichtbarkeits-Sonderfall bei Competitions (anders als bei Turnieren).

## Ansatz

**On-the-fly aus den Slots**, kein Read-Model. Die Query lädt abgeschlossene
Begegnungen mit ihren Einzelslots, Meldungen und Auswechslungen; die Engine
löst die Besetzung über `resolveSlotOccupancy` auf und rechnet. Kein neues
Schema, keine Migration, kein Abgleichlauf nötig (das wäre C10 — bewusst
nicht hier). Verworfen: eine vom Worker fortgeschriebene Tabelle (Migration +
Drift-Risiko, das schon als offener Punkt C10 existiert) und eine
SQL-Aggregation (dupliziert die Besetzungsauflösung aus der Engine ausserhalb
der Domäne, gegen AGENTS.md §4).

## Rechnung (A1.7–A1.9)

Je Person und gewertetem Einzelslot, aus deren Sicht:

```
gewonnene Legs  = homeLegs bzw. awayLegs der eigenen Seite
möglichePunkte  = 2 × legsToWinSet          (Best of 3 → 4, deckt A1.7 ab)
erzielte Punkte = Sieger: möglichePunkte − Legs der Gegenseite
                  Verlierer: eigene Legs
```

Für Best of 3 (`legsToWinSet = 2`) ergibt das exakt die Tabelle aus A1.7:
2:0 → 4, 2:1 → 3, 1:2 → 1, 0:2 → 0. Die Ableitung aus `legsToWinSet` statt
einer festen Konstante hält die Rechnung für andere Distanzen korrekt, ohne
dass A1.7 das für andere Distanzen als Best-of-3 tatsächlich vorsieht — der
Wettbewerb der VFC-Liga spielt ausschliesslich Best of 3 (A1.2), es gibt
keinen abweichenden Fall zu testen.

Aggregiert über alle gewerteten Einzel einer Person:

```
möglichePunkte  = Σ möglichePunkte je Einzel   (= gespielte Einzel × 4 bei Best of 3)
erzielte Punkte = Σ erzielte Punkte je Einzel
Trefferquote    = erzielte Punkte / möglichePunkte      (immer 0…1)
Ranglistenpunkte = Trefferquote × erzielte Punkte
```

Rangkriterien (A1.9), abnehmende Gewichtung:

1. Ranglistenpunkte
2. Quotient der Spiele Q-Sp. = gewonnene Einzel / gespielte Einzel
3. Quotient der Sätze Q-Satz = gewonnene Legs / gespielte Legs

Vergleich per ganzzahliger Kreuzmultiplikation, nicht per Gleitkommazahl:
für zwei Brüche `a/b` und `c/d` mit `b, d > 0` entscheidet `a·d` vs. `c·b`.
Das macht die Rangfolge deterministisch und unabhängig von
Fliesskommarundung; gerundet wird nur für die Anzeige (2 Nachkommastellen).
Gleiche Bilanz teilt sich einen Rang, der nächste Rang überspringt die
Gleichstände (identisch zu `standings.ts`); als letzter, rein technischer
Tiebreak für eine stabile Sortierung dient die `playerId`.

**Was zählt:**

- Begegnung: `status = 'COMPLETED'` (Entwurf/laufende Begegnungen zählen
  nicht — sie könnten sich noch ändern).
- Slot: `discipline = 'SINGLES'` und `status in ('COMPLETED', 'WALKOVER')`.
  Ein Einzel-Walkover zählt für beide Seiten als gespieltes Spiel mit dem
  erfassten Legstand (A4.4: „mit 0:1 Spielen und 0:2 Sätzen verloren" — genau
  das, was `homeLegs`/`awayLegs` bei einem Walkover-Slot schon tragen).
  `CANCELLED`-Slots (Nichtantritt der ganzen Begegnung) zählen nicht.
- Wer in keinem gewerteten Slot vorkommt, erscheint nicht in der Liste (kein
  Nulleintrag).

**Mannschaftszuordnung je Zeile:** eine Person kann als Aushilfe (`origin =
'GUEST'`) für mehr als eine Mannschaft angetreten sein. Die Zeile führt die
Mannschaft mit den meisten gewerteten Einzeln dieser Person; bei Gleichstand
die Mannschaft mit dem höheren `matchday` der zuletzt gewerteten Begegnung,
danach `teamId` als letzter, rein technischer Tiebreak. Zusätzlich trägt die
Zeile `otherTeamsCount` (Anzahl weiterer Mannschaften, für die die Person
mindestens ein gewertetes Einzel hat) — sichtbar in der Anzeige, ohne die
Mannschaftszuordnung selbst zu verkomplizieren.

## Aufbau

| Schicht | Ort | Inhalt |
|---|---|---|
| Domain | `packages/league-engine/src/player-ranking.ts` | `calculatePlayerRanking(input): readonly PlayerRankingRow[]`, reine Rechnung, keine Namen, kein IO |
| Schema | `packages/schemas/src/league.ts` | `playerRankingRowSchema`, `competitionPlayerRankingSchema` (Muster: `standingsRowSchema`/`competitionStandingsSchema`) |
| Query | `apps/api/src/competitions/competitions.repository.ts` | `playerRankingSource({organizationId, competitionId})` — lädt abgeschlossene Begegnungen, deren Einzelslots, `encounter_nominations`, `encounter_substitutions`; jede Bedingung nach `organization_id` |
| Service | `apps/api/src/competitions/competitions.service.ts` | `playerRanking(...)`, Berechtigung `competition:read` (identisch zu `standings`), hängt `players.displayName` an |
| Endpunkt | `apps/api/src/competitions/competitions.controller.ts` | `GET /api/v1/organizations/:organizationId/competitions/:competitionId/player-ranking` |
| Web | `apps/web/src/components/league/player-ranking-table.tsx` | Neuer Abschnitt unter `StandingsTable` in `competition-detail.tsx`; TanStack Query, gleiches Muster (`SheetLabel`, `Rule`); breite Tabelle in horizontal scrollendem Container (mobile-first, AGENTS.md §18) |

Kein neues Paket: `player-ranking.ts` liegt neben `standings.ts` in
`league-engine`, weil beide dieselbe Leg-/Satz-Gleichsetzung und dieselbe
Reglementsgrundlage (Anhang 1) teilen. `packages/ranking-engine` bleibt
ungenutzt — es ist für eine andere Art von Rangliste vorgesehen (z. B.
Elo/Seeding), nicht für diese Auswertung bereits gespielter Ergebnisse.

## Fehlerfälle

- Kein gewerteter Slot im Wettbewerb → leere Liste, kein Fehler (analog zur
  Ligatabelle bei null Begegnungen).
- Fremde `organizationId`/`competitionId`-Kombination → 404, wie bei
  `standings`.
- Fehlende Berechtigung → 403 über denselben `require`-Pfad.

## Tests

**Engine (TDD, `player-ranking.spec.ts`):** Punktetabelle für alle vier
Satzausgänge; Auswechslung ergibt drei statt vier gewertete Einzel für die
ausgewechselte Person; Walkover-Slot zählt; `CANCELLED`-Slot zählt nicht;
Doppelslot fliesst nicht ein; nicht abgeschlossene Begegnung zählt nicht;
Aushilfe mit Einsätzen für zwei Mannschaften → Zuordnung zur Mannschaft mit
mehr gewerteten Einzeln, `otherTeamsCount = 1`; Rangfolge über alle drei
Kriterien inklusive eines Falls, der erst am dritten Kriterium (Q-Satz)
entschieden wird; geteilte Ränge mit Rang-Sprung; leere Eingabe.

**API-Integration (`competitions.integration.spec.ts`):** Zeilen für einen
gesäten Wettbewerb mit mindestens einer Auswechslung und einem Walkover;
fremde Organisation → 404; fehlende Berechtigung → 403.

**E2E:** ein zusätzlicher Fall in der bestehenden Liga-E2E-Suite, der prüft,
dass der Abschnitt „Einzelrangliste" mit den erwarteten Zeilen erscheint.

## Definition of Done

Deckt sich mit AGENTS.md §24: Typen korrekt, serverseitig validiert
(Zod-Schema an der API-Grenze), autorisiert (`competition:read`),
tenant-sicher (`organizationId` in jeder Repository-Bedingung), Tests auf
allen drei Ebenen, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`
grün, Dokumentation (dieser Spec-Verweis in `audit-offene-punkte.md`)
aktualisiert.
