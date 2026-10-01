# Liga-Resultatkorrektur Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Leitung öffnet ein gespieltes Spiel einer abgeschlossenen Liga-Begegnung mit Begründung wieder, damit es neu gescort und die Begegnung mit korrigiertem Resultat erneut abgeschlossen wird.

**Architecture:** Ein neues Encounter-Kommando `result-corrections` (Recht `encounter:manage`) läuft wie die übrigen Encounter-Kommandos über `EncountersService.command(...)`. Die Datenbanklogik liegt – wie `correctTournamentResult` – im `MatchesRepository` (`correctEncounterResult`), weil sie das Match wieder öffnen muss; die Match-Wiedereröffnung wird mit der Turnier-Korrektur geteilt. Begegnung, Entscheidungsdoppel und Slot werden in derselben Transaktion zurückgesetzt; Tabelle und Rangliste rechnen sich live neu.

**Tech Stack:** TypeScript strict, NestJS/Fastify, Drizzle/PostgreSQL, Zod, Next.js/React, TanStack Query, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-01-liga-resultatkorrektur-design.md` – vor jedem Task lesen; sie ist bindend, der Plan argumentiert von dort.

## Global Constraints

- Branch `feature/liga-resultatkorrektur` (von develop 2099dc6). Vor dem ersten Commit `git branch --show-current` prüfen.
- Conventional Commits auf Deutsch, **kein** `Co-Authored-By` oder sonstiger Trailer. Nicht pushen.
- Route exakt: `POST /api/v1/organizations/:organizationId/encounters/:encounterId/result-corrections`.
- Body exakt: `{ commandId: uuid, expectedVersion: int ≥ 0, slotId: uuid, reason: string trim 3..500 }`, Schema-Name `correctEncounterResultSchema`, Typ `CorrectEncounterResultInput`.
- Recht exakt `encounter:manage`. Kein `@AllowDevice()`.
- Neue Fehlercodes exakt: `ENCOUNTER_NOT_CORRECTABLE` (409), `SLOT_NOT_CORRECTABLE` (409), `DECIDER_CORRECTION_REQUIRED` (409). Bestehend wiederverwendet: `BOARD_UNAVAILABLE`, `PLAYER_BUSY`, `ENCOUNTER_VERSION_CONFLICT`.
- Outbox/Audit exakt: `ENCOUNTER_RESULT_CORRECTED` (Outbox `aggregateType: "Encounter"`, Audit `entityType: "Encounter"`), dazu die bestehenden `ENCOUNTER_SLOT_REOPENED` (Outbox + Audit).
- Korrigierbare `encounters.result_type`: `PLAYED`, `DECIDER`; nicht `FORFEIT`.
- Sperrreihenfolge: Encounter → EncounterSlot → Match → Board → Players.
- Web-Texte exakt aus Spec §4 (Deutsch Schweiz, kein ß).
- Einzelne API-Testdatei: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/<pfad>.spec.ts`. Pakete gegen dist: nach Änderungen an `packages/*` `pnpm --filter @darts-platform/<paket> build`.
- Web-Build nur `pnpm build`; E2E nur `pnpm test:e2e` bzw. `npx dotenv -e .env -- pnpm --filter @darts-platform/web test:e2e <datei>`, im Vordergrund, danach `apps/web/next-env.d.ts` ggf. per `git checkout` zurücksetzen.
- Dialoge/Formularfelder nur im offenen Zustand mounten.

## Dateiübersicht

| Datei | Verantwortung |
|---|---|
| `packages/schemas/src/encounter.ts` (bzw. die Datei mit den übrigen Encounter-Kommandoschemas) | `correctEncounterResultSchema` |
| `apps/api/src/matches/matches.repository.ts` | `correctEncounterResult`; gemeinsame private Hilfe zur Match-Wiedereröffnung mit `correctTournamentResult` |
| `apps/api/src/encounters/sync-encounter-slot.ts` | `reopenEncounterSlotForMatch` so aufteilen, dass der Korrekturweg die Slot-Öffnung ohne «Begegnung läuft»-Prüfung nutzt |
| `apps/api/src/encounters/encounters.service.ts`, `encounters.controller.ts`, `encounters.module.ts` | Kommando `correctResult`, Route, DI |
| `apps/api/src/encounters/encounter-correction.integration.spec.ts` (neu) | API-Tests |
| `apps/api/src/security/*.integration.spec.ts` | Matrizen |
| `apps/web/src/lib/api-client.ts` | Fehlermeldungen |
| `apps/web/src/components/league/*` | Knopf «Resultat korrigieren», Grundfeld, Link zum Scoreboard |
| `apps/web/tests/team-encounter.spec.ts` oder neue E2E-Datei | E2E |
| `docs/adr/0020-liga-resultatkorrektur.md`, `apps/web/public/bedienungsanleitung.html` | Doku |

---

### Task 1: API – Kommando `result-corrections`

**Files:**
- Modify: Encounter-Schemadatei in `packages/schemas/src/` (dort, wo `declareEncounterForfeitSchema` steht), Export in `index.ts`
- Modify: `apps/api/src/matches/matches.repository.ts`
- Modify: `apps/api/src/encounters/sync-encounter-slot.ts`
- Modify: `apps/api/src/encounters/encounters.service.ts`, `encounters.controller.ts`, ggf. `encounters.module.ts`
- Modify: `apps/api/src/common/league-error.ts` oder `conflictFor` (je nachdem, wo Repository-Ergebnisse auf HTTP abgebildet werden)
- Create: `apps/api/src/encounters/encounter-correction.integration.spec.ts`
- Modify: `apps/api/src/security/tenant-isolation-matrix.integration.spec.ts` (Body für die neue Route), ggf. `permission-matrix.integration.spec.ts`

**Interfaces:**
- Produces:
  - `correctEncounterResultSchema`, `type CorrectEncounterResultInput` aus `@darts-platform/schemas`
  - `EncountersService.correctResult(input: EncounterCommandInput<CorrectEncounterResultInput>): Promise<EncounterDetail>`
  - `MatchesRepository.correctEncounterResult(input: { organizationId; encounterId; data: CorrectEncounterResultInput; auth: AuthContext; audit: AuditContext }): Promise<EncounterCorrectionResult>`, wobei `EncounterCorrectionResult` die Werte `"ok" | "not-found" | "slot-not-found" | "version-conflict" | "command-id-reused" | "encounter-not-correctable" | "slot-not-correctable" | "decider-correction-required" | "board-unavailable" | "player-busy"` umfasst (Namen bestehender Ergebnisse aus `EncounterMutationResult` übernehmen, falls dort anders geschrieben).

- [ ] **Step 1: Bestand lesen**

Lies vollständig: Spec; `correctTournamentResult` und `undoInTransaction` in `matches.repository.ts`; `sync-encounter-slot.ts`; `update-encounter-progress.ts`; `EncountersService.command`, `conflictFor`, die Idempotenz der Encounter-Kommandos (`encounter_commands`, wie und wo `findDuplicate…`/Insert passieren) in `encounters.repository.ts`; `TournamentsService.correctResult` (wie der Service das Matches-Repository nutzt); `encounter-undo.integration.spec.ts` (Aufbau-Muster). Notiere im Report, wo das Encounter-Kommando seine `commandId` speichert und wie die Version geprüft wird – das neue Kommando muss es genauso tun.

- [ ] **Step 2: Failing Tests schreiben**

`encounter-correction.integration.spec.ts` mit echtem Aufbau (CompetitionsService/EncountersService: anlegen, ansetzen, Meldungen, Start, `assignSlot`, Scoren bis zum Checkout – Hilfen aus `encounter-undo.integration.spec.ts` übernehmen). Fälle:

1. «korrigiert das letzte Spiel einer abgeschlossenen Begegnung»: nach Korrektur Begegnung `RUNNING`, `result`/`resultType`/Punkte/`completedAt` null, Version +1; Slot `IN_PROGRESS` mit `boardId`; Match `IN_PROGRESS`, letzter Visit `revertedAt` gesetzt; `CompetitionsService.standings` zählt die Begegnung nicht mehr als gespielt; Outbox `ENCOUNTER_RESULT_CORRECTED` und `ENCOUNTER_SLOT_REOPENED`; Audit `ENCOUNTER_RESULT_CORRECTED` mit `reason` und altem Resultat. Danach Checkout durch die andere Seite → Begegnung `COMPLETED` mit neuem Resultat, Tabelle entsprechend.
2. «korrigiert ein früheres Spiel» (nicht das zuletzt abgeschlossene).
3. «korrigiert das Entscheidungsdoppel» (Begegnung mit Gleichstand nach regulären Spielen, Decider gespielt).
4. «lehnt ein reguläres Spiel nach gespieltem Entscheidungsdoppel ab» → 409 `DECIDER_CORRECTION_REQUIRED`.
5. «setzt einen gestrichenen Decider zurück»: Decider war `CANCELLED` (nicht gebraucht) → nach Korrektur `WAITING`; erneuter Abschluss ohne Gleichstand → wieder `CANCELLED`.
6. Ablehnungen ohne Änderung (Begegnung, alle Slots, Match, Visits, Outbox, Audit per Vor-/Nach-Vergleich): Begegnung `RUNNING` → `ENCOUNTER_NOT_CORRECTABLE`; Forfait → `ENCOUNTER_NOT_CORRECTABLE`; Walkover-Slot → `SLOT_NOT_CORRECTABLE`; Scheibe belegt → `BOARD_UNAVAILABLE`; Spieler spielt anderswo → `PLAYER_BUSY`; falsche Version → `ENCOUNTER_VERSION_CONFLICT`; Slot fremder Begegnung → 404.
7. «ist idempotent»: gleiche `commandId` zweimal → ein Visit zurückgenommen, ein Outbox-Eintrag.
8. «verlangt encounter:manage»: MEMBER und SCORER → 403.

- [ ] **Step 3: Rot laufen lassen** – erwartet: Route/Service fehlen.

- [ ] **Step 4: Implementieren**

- Schema `correctEncounterResultSchema` nach Global Constraints; `packages/schemas` bauen.
- `sync-encounter-slot.ts`: die Slot-Wiedereröffnung (Update, Outbox `ENCOUNTER_SLOT_REOPENED`, Audit) in eine interne Funktion ziehen, die der Undo-Pfad (mit Prüfung «Begegnung läuft», Decider-Regel aus PR #92) und der Korrekturpfad (eigene Prüfungen, Begegnung bereits `RUNNING` gesetzt) gemeinsam nutzen. Verhalten des Undo-Pfads unverändert lassen (bestehende `encounter-undo.integration.spec.ts` bleibt grün).
- `matches.repository.ts`: Den Match-Teil von `correctTournamentResult` (letzte Aufnahme per `UNDO_LAST_VISIT` zurücknehmen, Folgeleg löschen, Leg öffnen, `syncProjection`, `score_commands`) in eine private Methode ziehen, die beide Korrekturen nutzen; `correctTournamentResult` verhält sich unverändert (Turnier-Tests grün).
- `correctEncounterResult` nach Spec §2/§3: Sperren in der Reihenfolge der Global Constraints, alle Prüfungen vor dem ersten Schreiben, dann Begegnung zurücksetzen (Checks `encounters_completed_result_check`, `encounters_result_pair_check` beachten), gestrichenen Decider auf `WAITING`, Slot öffnen, Match öffnen, `updateEncounterProgress`, Outbox, Audit (`auditActor`). Idempotenz und Versionsprüfung genau wie die übrigen Encounter-Kommandos (Step 1).
- Service: `correctResult` über `command(input, "encounter:manage", () => this.matchesRepository.correctEncounterResult(input))` (Injektion von `MatchesRepository` wie im `TournamentsService`; Modul-Verdrahtung prüfen, keine zyklischen Modul-Imports). Neue Ergebnisse in `conflictFor` abbilden (409, Codes aus Global Constraints, `details.currentState`). Exhaustive `switch` beibehalten.
- Controller: Route nach dem Muster von `declareForfeit`.
- Matrizen: `bodies` in der Tenant-Matrix um `{ commandId, expectedVersion: 0, slotId, reason: "Matrix" }` ergänzen (gültige Zod-Werte); Permission-Matrix nur anpassen, wenn sie es verlangt.

- [ ] **Step 5: Grün laufen lassen** – neue Spec, `src/encounters/*.spec.ts`, `src/matches/*.spec.ts`, `src/tournaments/*.spec.ts`, `src/security/*.spec.ts`, `src/board-devices/*.spec.ts`; `pnpm --filter @darts-platform/api typecheck`; `pnpm lint`.

- [ ] **Step 6: Commit** `feat(api): Resultate abgeschlossener Liga-Begegnungen korrigieren`

---

### Task 2: Web – «Resultat korrigieren» in der Begegnung

**Files:**
- Modify: `apps/web/src/lib/api-client.ts` (Meldungen aus Spec §4, Ergänzung der Undo-Meldung `ENCOUNTER_RESULT_REQUIRES_CORRECTION`)
- Modify/Create: `apps/web/src/components/league/` – Kommandozentrale (`encounter-command-centre.tsx`, `slot-list.tsx`, `use-encounter-command.ts`), ggf. neue Komponente `encounter-correction.tsx`
- Test: `encounter-command-centre.render.spec.tsx` bzw. neue Render-Spec

**Interfaces:**
- Consumes: Route und Schema aus Task 1; `EncounterDetail`-Antwort.

- [ ] **Step 1: Bestand lesen** – `results-panel.tsx` und `correctResult` in `command-centre.tsx` (Turnier) als Muster; wie die Encounter-Kommandozentrale Kommandos mit `commandId`/`expectedVersion` sendet (`use-encounter-command.ts`), Fehler zeigt und Rechte prüft (`hasOrganizationPermission`).
- [ ] **Step 2: Failing Render-Tests**:
  - Knopf «Resultat korrigieren» nur bei abgeschlossener Begegnung, nur an gespielten Slots, nur mit `encounter:manage`.
  - Grundfeld «Korrekturgrund»: «Korrektur starten» erst ab 3 Zeichen aktiv, max. 500.
  - Erfolg: Anfrage an `…/result-corrections` mit `slotId`, `reason`, `commandId`, `expectedVersion`; danach Link «Zum Scoreboard» auf die Scoringfläche des Matches (`/matches/<matchId>?organisation=<org>&begegnung=<encounterId>`, bestehende Route prüfen).
  - Fehler sichtbar (z. B. `DECIDER_CORRECTION_REQUIRED` mit Spec-Text).
- [ ] **Step 3: Implementieren** – Feld nur im offenen Zustand mounten, Touch-Ziele ≥ 44 px, sichtbarer Fokus, keine Information nur über Farbe.
- [ ] **Step 4: Tests** – Render-Spec, `pnpm --filter @darts-platform/web test`, `typecheck`, `pnpm lint`; danach `pnpm test:e2e` (voll), um Locator-Brüche zu finden.
- [ ] **Step 5: Commit** `feat(web): Liga-Resultat in der Begegnung korrigieren`

---

### Task 3: E2E – Begegnung korrigieren

**Files:** `apps/web/tests/team-encounter.spec.ts` (neuer Fall) oder `apps/web/tests/encounter-correction.spec.ts`

- [ ] **Step 1:** Fall: Begegnung über die UI bzw. bestehende Helfer zu Ende spielen (Muster `team-encounter.spec.ts`), «Resultat korrigieren» am letzten Spiel mit Grund, «Zum Scoreboard», letzte Aufnahme neu eintragen, sodass sich der Sieger des Spiels ändert, Begegnung erneut abgeschlossen; Tabelle der Liga zeigt das neue Resultat. Feste Daten relativ zu `Date.now()`.
- [ ] **Step 2:** Fokussiert grün, dann `pnpm test:e2e` voll grün.
- [ ] **Step 3: Commit** `test(web): E2E fuer die Korrektur eines Liga-Resultats`

---

### Task 4: Dokumentation

**Files:** `docs/adr/0020-liga-resultatkorrektur.md` (Aufbau wie ADR 0019), `apps/web/public/bedienungsanleitung.html` (Abschnitt im Liga-Teil, Stil übernehmen, keine Inline-Skripte)

- [ ] **Step 1:** ADR 0020: Kontext (Undo aus PR #92 endet an der abgeschlossenen Begegnung), Entscheid (Wiedereröffnen statt Eintragen, Umfang, Decider-Regel, Recht, Sperrreihenfolge, Audit/Outbox, gemeinsame Match-Wiedereröffnung mit der Turnier-Korrektur), Folgen (Tabelle live, Statistik idempotent, Walkover/Forfait nicht korrigierbar), verworfen (direktes Eintragen).
- [ ] **Step 2:** Bedienungsanleitung: «Ein Resultat einer abgeschlossenen Begegnung korrigieren» in nummerierten Schritten für Vereinsverantwortliche; Texte exakt wie in der UI.
- [ ] **Step 3: Commit** `docs: ADR 0020 und Anleitung zur Korrektur von Liga-Resultaten`

---

### Task 5: Volle Prüfung

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e` – alles grün; Befunde als `fix:`-Commits.
