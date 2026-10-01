# Vereinsduell – Fix-Runde: offene Punkte und Follow-ups aus Plan 1 und Plan 2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alle nach den Abschlussreviews von Plan 1 (Backend, PR #96) und Plan 2 (Web, PR #97) zurückgestellten Befunde und Follow-ups abarbeiten, als ein PR gegen `develop`, vor dem Release nach `main`.

**Architecture:** Keine neuen Konzepte. Vertrag wird um die Scheibe je Rundenspiel erweitert (`clubRoundMatchSchema.boardName`), die Gastspieler-Erfassung lehnt eine bekannte `commandId` mit anderen Nutzdaten mit 409 ab, Pausenlisten früherer Runden berücksichtigen spätere Rückzüge, und eine Reihe kleiner Code- und Testlücken wird geschlossen. Die Tasks sind nach Paket gebündelt (Engine, API, Web), damit jeder Dispatch eine Testschicht hat.

**Tech Stack:** wie Plan 1/2.

**Spec:** `docs/superpowers/specs/2026-10-01-vereinsduell-design.md`; Befundquellen: Abschlussreviews und Task-Reviews von Plan 1 und Plan 2 (zusammengefasst unten).

## Global Constraints

- Branch `fix/vereinsduell-nacharbeit` ab `develop` (nach Merge von #97). PR gegen `develop`.
- AGENTS.md gilt; Conventional Commits auf Deutsch, **kein** `Co-Authored-By`-Trailer.
- Bestehende Verträge nur additiv erweitern (neue Felder mit Default oder nullable).
- Keine bestehende Migration ändern. Keine neue Migration nötig.
- Tests laufen wie in Plan 1/2 (dotenv für API/DB; Pakete bauen vor API-Tests).
- Nicht in dieser Runde (bewusst): Spielmodus je Phase (Entscheid des Nutzers in der Spec), Kürzel-Kürzung auf dem Scoreboard bei langen Namen (Name hat Vorrang), Enter-Submit im Anlageformular (dokumentierter Kompromiss), `third_place_match`-Default für klassische Turniere (Migration 0037 ist deployt, Wert ist wirkungslos), Datenschutzprüfung (zuständige Stelle), Duplikat-Vorprüfung auf Staging (operativer Schritt vor dem Release).

---

## Befundliste (Quelle → Task)

| # | Befund | Task |
|---|---|---|
| 1 | Server antwortet bei bekannter `commandId` mit **anderen Nutzdaten** still mit dem alten Ergebnis (Gastspieler-Dubletten möglich) | 2 |
| 2 | Spec «Runden-Tab mit Scheiben»: `clubRoundMatchSchema` trägt kein Board | 1, 2, 4 |
| 3 | `rounds[].pausedPlayerIds` früherer Runden nutzt den aktuellen Status (später Zurückgezogene fehlen) | 2 |
| 4 | `advanceClubDuelOnce` sperrt die Turnierzeile für alle Formate, bevor es das Format prüft | 2 |
| 5 | Kein Outbox-/Audit-Ereignis, wenn Finalrunde oder Final besetzt werden | 2 |
| 6 | Veralteter Doc-Kommentar in `advance-club-duel.ts` («in updateTournamentProgress») | 2 |
| 7 | `resultOf/collect` in `club-duel-projection.ts` dupliziert das Mapping aus `completed-match-results.ts` | 2 |
| 8 | `parseBody` für Query-Parameter `kind` (Fehlertext spricht vom Body); Kommentar zur Replay-Semantik fehlt | 2 |
| 9 | Fehlende API-Tests: Realtime/Outbox genau ein Ereignis je Paarung nach Commit; HTTP-Test CLUB_DUEL-Anlage über Controller; `?kind=BOGUS/ALL/GUEST`; gleiche `commandId` in zwei Organisationen; Fremd-Board bei CLUB_DUEL; Outbox/Audit bei Anlage; `getStates` mit `clubLabel`; Korrektursperre: letzte Quali-Runde / Finalrunde (bereits in Plan 1 Fix-Welle B ergänzt – prüfen, sonst nachziehen) | 3 |
| 10 | Engine: kein Brute-Force-Optimalitätstest der Zuordnung; keine Tests für `DUPLICATE_SEED`, `CLUB_DUEL_SIDE_EMPTY`, `boardCount < 1`; kein WALKOVER-Test in `calculateCrossRoundStandings`; `calculateCrossRoundStandings` ohne Duplikatprüfung; Parallel-Arrays mit `?? "COMPLETED"` im Lifecycle; `ClubMatchResult`-Alias | 1 |
| 11 | `projectClubDuel` ohne Unit-Test (null für andere Formate, fehlende Legs, Sätze mit gleichen Legs) | 3 |
| 12 | Web: doppelter Tab-Stopp (Tabpanel `tabIndex=0` plus fokussierbare Scroll-Region) | 4 |
| 13 | Web: toter Walkover-Zweig in `ClubMatchList` (Beamer) | 4 |
| 14 | Web: Spec «Spalten A/B mobil untereinander **mit Umschalter**» nicht umgesetzt | 4 |
| 15 | Web: neue Gäste bis zum Refetch unsichtbar ausgewählt (Zähler zeigt mehr als Häkchen) | 4 |
| 16 | Web: `finalRoundSize`-Meldung passt nur zu «zu wenig Spieler» | 4 |
| 17 | Web: `signedOneDecimal` rundet mit `Math.round` asymmetrisch bei .5 | 4 |
| 18 | Web: `textarea`-Klassen aus `inputBase` kopiert → `TextArea`-Primitive in `packages/ui` | 4 |
| 19 | Web-Tests: `mode="board"` mit clubDuel; Doppel mit Kürzeln auf dem Scoreboard; Finalspiel kampflos; Teildaten-Fälle der Panels; Queue-Filter als Helfer mit Test; `tournamentWinner` mit `clubDuel: null` + Bracket; Fixture-Score im Header-Test | 5 |
| 20 | E2E: Runde 2 nur per Überschrift geprüft (4 Spiele, pausierter Spieler fehlen); «Runde 1»-Text ungescoped; Rangliste nur Radio; Locators auf aktives Tabpanel eingrenzen | 5 |
| 21 | Doku: ADR 0021 um Vertragserweiterung (Board je Rundenspiel), 409 bei Nutzdaten-Abweichung, Pausenliste; README-Restpunkte streichen | 6 |

---

### Task 1: Engine – Tests und Aufräumen (Befund 10)

**Files:**
- Modify: `packages/tournament-engine/src/club-duel.ts`, `club-duel.spec.ts`, `tournament.ts`

**Interfaces (Produces):**
- `calculateCrossRoundStandings` wirft `TournamentValidationError("DUPLICATE_PARTICIPANT", …)`, wenn eine `playerId` in `sideA`/`sideB` doppelt oder auf beiden Seiten steht; doppelte Einträge in `unopposedWalkoverWinnerIds` zählen wie bisher je einmal (dokumentieren) – **Entscheid:** je Eintrag ein Sieg bleibt (ein Spieler kann zwei unbesetzte Plätze gewinnen).
- `ClubMatchResult`-Alias bleibt (wird von API genutzt) – nur der veraltete Kommentar («Task 3») wird entfernt.
- Lifecycle: `CLUB_DUEL_STAGE_ORDER`/`CLUB_DUEL_STATUS_BY_STAGE` zu einem Array `{ type, status }` zusammenführen, ohne `?? "COMPLETED"`.

- [ ] **Step 1: Failing Tests**

```ts
describe("pairClubSwissRound – Optimalität", () => {
  it("findet für n ≤ 6 dieselbe minimale Kostensumme wie eine erschöpfende Suche", () => {
    let state = 4242;
    const next = () => { state = (state * 1_103_515_245 + 12_345) % 2_147_483_648; return state / 2_147_483_648; };
    const permutations = (items: readonly number[]): number[][] =>
      items.length <= 1 ? [[...items]] : items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
    for (let iteration = 0; iteration < 60; iteration += 1) {
      const n = 2 + Math.floor(next() * 5);
      const sideA = ranked("a", n);
      const sideB = ranked("b", n, n);
      const previous = sideA.flatMap((a) => sideB.filter(() => next() < 0.3).map((b) => ({ playerAId: a.playerId, playerBId: b.playerId })));
      const previousSet = new Set(previous.map((p) => `${p.playerAId}:${p.playerBId}`));
      const penalty = n * n + 1;
      const cost = (i: number, j: number) => Math.abs(i - j) + (previousSet.has(`${sideA[i]?.playerId}:${sideB[j]?.playerId}`) ? penalty : 0);
      const best = Math.min(...permutations(sideB.map((_, j) => j)).map((perm) => perm.reduce((sum, j, i) => sum + cost(i, j), 0)));
      const paired = pairClubSwissRound({ round: 2, sideA, sideB, previousPairings: previous, pauses: new Map(), played: new Map() });
      const actual = paired.pairings.reduce((sum, pairing) => sum + cost(sideA.findIndex((a) => a.playerId === pairing.playerAId), sideB.findIndex((b) => b.playerId === pairing.playerBId)), 0);
      expect(actual).toBe(best);
    }
  });
});

describe("Validierung", () => {
  it("lehnt doppelte Seeds und leere Seiten ab", () => {
    const duplicateSeed = [...clubParticipants(2, 2).slice(0, 3), { playerId: "b-2", seed: 1, side: "B" as const }];
    expect(() => planClubDuel({ participants: duplicateSeed, qualifyingRounds: 1, finalRoundSize: 2, thirdPlaceMatch: false })).toThrowError(new TournamentValidationError("DUPLICATE_SEED", "Every seed must be unique."));
    expect(() => planClubDuel({ participants: clubParticipants(3, 0), qualifyingRounds: 1, finalRoundSize: 2, thirdPlaceMatch: false })).toThrowError(TournamentValidationError);
    expect(() => previewClubDuel({ sideACount: 4, sideBCount: 4, qualifyingRounds: 2, finalRoundSize: 2, thirdPlaceMatch: false, boardCount: 0, bestOfLegs: 3 })).toThrowError(TournamentValidationError);
  });
  it("Kreuzwertung: Walkover zählt ohne Legs, doppelte Teilnehmer werden abgelehnt", () => {
    const standings = calculateCrossRoundStandings({ sideA: [{ playerId: "a-1", qualifyingRank: 1 }], sideB: [{ playerId: "b-1", qualifyingRank: 1 }], results: [walkover("a-1", "b-1", "b-1")] });
    expect(standings.sideB[0]).toMatchObject({ won: 1, legsFor: 0, legsAgainst: 0 });
    expect(() => calculateCrossRoundStandings({ sideA: [{ playerId: "x", qualifyingRank: 1 }], sideB: [{ playerId: "x", qualifyingRank: 1 }], results: [] })).toThrowError(new TournamentValidationError("DUPLICATE_PARTICIPANT", "A participant may only appear once."));
  });
});
```

`ranked`, `clubParticipants`, `walkover` existieren in der Spec-Datei. `clubParticipants(3, 0)` muss eine leere Seite B liefern (Helper prüfen).

- [ ] **Step 2: Rot → Implementieren → Grün**

Duplikatprüfung in `calculateCrossRoundStandings` vor dem Aufbau der Map; Lifecycle-Arrays zusammenführen; Kommentar beim Alias ersetzen durch «Resultatform, gemeinsam mit den Gruppen (`GroupMatchResult`)».

- [ ] **Step 3: Build, Commit**

```bash
cd packages/tournament-engine && npx vitest run && cd ../.. && pnpm --filter @darts-platform/tournament-engine typecheck && pnpm --filter @darts-platform/tournament-engine build
git commit -am "test(tournament-engine): Optimalitaet der Paarung, Validierungsfaelle und Kreuzwertung absichern"
```

---

### Task 2: API – Vertrag, Idempotenz, Pausen, Ereignisse, Aufräumen (Befunde 1–8)

**Files:**
- Modify: `packages/schemas/src/club-duel.ts` (`clubRoundMatchSchema.boardName: z.string().nullable().default(null)`), Build
- Modify: `apps/api/src/tournaments/club-duel-projection.ts` (Board je Rundenspiel; Pausen früherer Runden; gemeinsames Mapping)
- Modify: `apps/api/src/tournaments/completed-match-results.ts` (reiner Mapper exportieren)
- Modify: `apps/api/src/tournaments/tournaments.repository.ts` (`getDashboardData` lädt `boards` bereits – `boardName` je Match über `match.boardId` zuordnen; zusätzlich **Board-Historie**: abgeschlossene Matches haben `boardId` noch gesetzt? prüfen; wenn beim Abschluss genullt, `boardName` aus dem Scoring-Match (`matches.boardId`) über `scoringById` holen)
- Modify: `apps/api/src/tournaments/advance-club-duel.ts` (Format vor Sperre prüfen; Outbox `TOURNAMENT_PHASE_RESOLVED` + Audit beim Besetzen von Finalrunde/Final; Doc-Kommentar)
- Modify: `apps/api/src/players/players.repository.ts`, `players.service.ts`, `players.controller.ts` (409 bei Nutzdaten-Abweichung; Query-Parsing)
- Modify: `apps/api/src/tournaments/tournaments.service.ts` (Fehlercode-Mapping)
- Tests: `club-duel.integration.spec.ts`, `guest-players.integration.spec.ts`

**Interfaces (Produces):**
- `clubRoundMatchSchema.boardName: string | null` – Scheibe des Spiels (laufend oder gespielt), sonst null.
- `POST …/players/guests` mit bekannter `commandId` und anderen Nutzdaten (anderer Verein oder andere Namensmenge, case-insensitiv) → 409 `{ code: "COMMAND_PAYLOAD_MISMATCH" }`; gleiche Nutzdaten → wie bisher das frühere Ergebnis.
- `GET …/players?kind=BOGUS` → 400 mit Code `INVALID_QUERY` (eigener Parser `parseQuery(schema, value)` in `apps/api/src/common/parse-query.ts`, analog `parseBody`).
- Outbox-Event `TOURNAMENT_PHASE_RESOLVED` `{ tournamentId, stageKey, resolvedMatchIds }` + Audit-Aktion `TOURNAMENT_PHASE_RESOLVED` in derselben Transaktion, wenn `resolveSideRanks` mindestens ein Match verändert.
- Pausen früherer Runden: `pausedPlayerIds(round) = Teilnehmer ohne Spiel in dieser Runde, die zu diesem Zeitpunkt aktiv waren` – «aktiv zu diesem Zeitpunkt» = `status === "ACTIVE"` oder `withdrawnAt > createdAt des ersten Spiels der Folgerunde` (für die aktuelle Runde: wie bisher nur ACTIVE).

- [ ] **Step 1: Failing Tests** (Auszug; Helfer aus den bestehenden Specs nutzen)

```ts
it("liefert je Rundenspiel die Scheibe und behält Pausierende früherer Runden nach ihrem Rückzug", async () => {
  // Runde 1 spielen (Board bekannt), dann einen Pausierenden der Runde 1 zurückziehen, dann Dashboard laden:
  // rounds[0].matches.every(m => m.boardName === boardName) und rounds[0].pausedPlayerIds enthält den Zurückgezogenen weiterhin
});

it("lehnt dieselbe commandId mit anderen Namen mit 409 COMMAND_PAYLOAD_MISMATCH ab", async () => {
  const commandId = randomUUID();
  await service.createGuests({ organizationId, data: { commandId, clubName: "DC", names: ["Anna"] }, auth, audit });
  await expect(service.createGuests({ organizationId, data: { commandId, clubName: "DC", names: ["Anna", "Beat"] }, auth, audit }))
    .rejects.toMatchObject({ response: { code: "COMMAND_PAYLOAD_MISMATCH" } });
  await expect(service.createGuests({ organizationId, data: { commandId, clubName: "dc ", names: ["anna"] }, auth, audit })).resolves.toHaveLength(1);
});

it("schreibt beim Besetzen der Finalrunde genau ein Outbox- und ein Audit-Ereignis", async () => {
  // nach der letzten Quali-Runde: outboxEvents TOURNAMENT_PHASE_RESOLVED mit stageKey "final-round" → 1; auditEvents gleich
});
```

- [ ] **Step 2: Implementieren** (Reihenfolge: Schema → Build → Projektion/Repository → advance → Players → Service-Mapping)

Für den Mapper: `completed-match-results.ts` exportiert `toCompletedResult(match, legsOf): ClubMatchResult | "unopposed" | null` (rein); `loadCompletedMatchResults` und die Projektion nutzen ihn.

- [ ] **Step 3: Tests, Commit(s)**

```bash
pnpm --filter @darts-platform/schemas build
cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/tournaments src/players src/matches && cd ../..
pnpm --filter @darts-platform/api typecheck
```

Commits getrennt: `feat(api): Scheibe je Rundenspiel im Vereinsduell-Dashboard`, `fix(api): Gastspieler-Erfassung lehnt abweichende Nutzdaten zur bekannten commandId ab`, `fix(api): Pausenliste frueherer Runden beruecksichtigt spaetere Rueckzuege`, `feat(api): Ereignis beim Besetzen von Finalrunde und Final`, `refactor(api): gemeinsamer Resultat-Mapper, Formatpruefung vor Sperre, Query-Parser`.

---

### Task 3: API – Testlücken (Befunde 9, 11)

**Files:**
- Modify: `apps/api/src/tournaments/club-duel.integration.spec.ts`, `apps/api/src/players/guest-players.integration.spec.ts`
- Create: `apps/api/src/tournaments/club-duel-projection.spec.ts` (Unit, ohne DB)
- Create oder Modify: HTTP-Test über `createApiTestApplication` (`apps/api/src/testing/api-harness.ts`) für `POST /organizations/:org/tournaments` mit `format: "CLUB_DUEL"` (Muster: bestehende Controller-Specs mit `app.inject`)

- [ ] Tests: Outbox `TOURNAMENT_ROUND_PAIRED` genau eins je Paarung und keines bei Rollback (Rollback erzwingen: Visit mit falscher `expectedVersion` nach dem letzten Spiel – oder einfacher: Anzahl Events = Anzahl gepaarter Runden über den ganzen Durchlauf); HTTP 201 für CLUB_DUEL-Anlage und 400 für Seite < Finalrunde; `?kind=BOGUS` → 400, `GUEST`/`ALL` filtern; gleiche `commandId` in zwei Organisationen → zwei getrennte Anlagen; Fremd-Board → `INVALID_TOURNAMENT_BOARDS`; `TOURNAMENT_CREATED` Outbox + Audit bei Anlage; `getStates` liefert `clubLabel` (über `tournamentsService.dashboard` → `boards[].match.participants` oder direkt `matchesRepository.getStates`); `projectClubDuel`: null bei ROUND_ROBIN, fehlende Legs → Match ohne Resultat, 4:4 mit Sieger wird gewertet.
- [ ] Commit `test(api): Vereinsduell – Ereignisse, HTTP-Anlage, Gaeste-Filter, Projektion`

---

### Task 4: Web – Code-Befunde (Befunde 2, 12–18)

**Files:**
- Modify: `apps/web/src/components/tournament/club-duel/club-rounds.tsx` (Scheibe je Spiel: `· {boardName}` falls vorhanden), `club-duel-tabs.tsx` (kein `tabIndex` auf dem Tabpanel), `club-standings.tsx` (Rundung: `Math.round(Math.abs(v)*10)/10` mit Vorzeichen)
- Modify: `apps/web/src/components/live/live-tournament.tsx` (toter Walkover-Zweig raus)
- Modify: `apps/web/src/components/tournament/club-duel-setup.tsx` + `setup-sheet.tsx` (mobiler Umschalter «{A} | {B}» unter `lg` als `role="radiogroup"`, Muster `InputModeSwitch`; ab `lg` beide Spalten; neue Gäste optimistisch aus der Panel-Antwort in die B-Liste mergen, bis der Refetch sie liefert; `finalRoundSize`-Meldung nach Zod-Issue unterscheiden: Bereich vs. Seitenprüfung)
- Create: `packages/ui/src/sektorenring/field.tsx` → `TextArea` (gleiche Basisklassen wie `TextInput`, `min-h-32`), Export in `packages/ui/src/index.ts`; `guest-players-panel.tsx` nutzt sie; Build `packages/ui`
- Tests: bestehende Render-Specs anpassen/ergänzen (Umschalter zeigt auf schmalem Viewport nur eine Spalte – in happy-dom über die Radiogroup-Interaktion prüfen, nicht über Breite)

- [ ] Commits: `feat(web): Runden-Tab zeigt die Scheibe je Spiel`, `feat(web): Spielerspalten mobil umschaltbar, neue Gaeste sofort sichtbar`, `fix(web): Tab-Stopps, Rundung, tote Zweige, Meldung Finalrunde`, `feat(ui): TextArea-Primitive`

---

### Task 5: Web – Tests und E2E-Tiefe (Befunde 19, 20)

**Files:**
- Modify: `live-tournament.render.spec.tsx` (mode=board mit clubDuel: keine Vereinsduell-Sektionen), `scoreboard-sides.render.spec.tsx` (Doppel mit zwei Kürzeln), `club-duel-panel.render.spec.tsx` (Finalspiel kampflos; Teildaten: keine Runde, finals null, Pausierende), `dashboard-header.render.spec.tsx` (Fixture-Score konsistent), `tournament-winner.spec.ts` (`clubDuel: null` + Bracket)
- Create: `apps/web/src/lib/club-duel-queue.ts` + Spec (`visibleQueue(queue, format)` – Filter aus `command-centre.tsx` ausgelagert)
- Modify: `apps/web/tests/club-duel.spec.ts` (Runde 2: vier Spiele im aktiven Tabpanel, Pausierender aus Runde 1 spielt in Runde 2; «Runde 1» im Tabpanel gescoped; Rangliste: Seite VFC zeigt 4 Siege; Locators auf `getByRole("tabpanel")` eingrenzen)
- [ ] `pnpm test:e2e` grün; Commit `test(web): Vereinsduell – Render- und E2E-Luecken schliessen`

---

### Task 6: Doku und Gesamtsuite (Befund 21)

- [ ] ADR 0021: Abschnitt «Nacharbeit 02.10.2026»: Board je Rundenspiel im Vertrag, 409 `COMMAND_PAYLOAD_MISMATCH`, Pausenliste früherer Runden, Ereignis `TOURNAMENT_PHASE_RESOLVED`. README: Restpunkte-Liste aktualisieren (Scheiben jetzt vorhanden). Commit `docs: ADR 0021 und README zur Vereinsduell-Nacharbeit`.
- [ ] `pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm test:e2e` grün; Sicherheitsmatrizen (neue Route? keine – aber `parse-query` ändert Fehlerform: Isolationsmatrix prüfen).
- [ ] PR gegen `develop`: Problem/Lösung/Architektur/keine Migration/Tests/Security.
