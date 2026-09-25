# Follow-ups Bearbeiten und Löschen – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die fünf nicht blockierenden Follow-ups aus dem Abschlussreview von `feature/bearbeiten-loeschen` (PRs #73–#75) schliessen.

**Architecture:** Nur Web, Schemas und ein E2E-Helper. Keine neue Route, keine Migration.

**Tech Stack:** Next.js/React, TanStack Query, React Hook Form + Zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-24-bearbeiten-loeschen-design.md` (Grundlage), ADR `docs/adr/0018-loeschkonzept.md`. Die Follow-ups selbst stammen aus dem Abschlussreview und sind hier als Anforderungen festgehalten.

## Global Constraints

- UI-Texte Deutsch, Schweizer Rechtschreibung (kein ß).
- Dialoge weiter über `apps/web/src/components/confirm-dialog.tsx` bzw. `apps/web/src/components/players/player-edit-dialog.tsx`; Dialoge mit Formularfeldern nur im offenen Zustand mounten (sonst Strict-Mode-Kollisionen in bestehenden E2E-Locators).
- Keine Business-Logik in Komponenten ausser UI-Zustand. Kein `any`.
- Commits: Conventional Commits, Deutsch, **kein** `Co-Authored-By`-Trailer. Branch `fix/bearbeiten-loeschen-follow-ups`, nicht pushen (macht der Controller).
- Web-Einzeltest: `cd apps/web && npx vitest run src/<pfad>`; ganze Web-Unit-Suite `cd apps/web && npx vitest run --dir src`.
- E2E aus dem Repo-Root: `npx dotenv -e .env -- pnpm --filter @darts-platform/web test:e2e <datei>.spec.ts`; jeder Web-Task fährt zusätzlich die volle E2E-Suite `pnpm test:e2e`. `apps/web/next-env.d.ts` danach unverändert.
- API-Einzeltest: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/<pfad>.spec.ts`; vorher `pnpm --filter @darts-platform/schemas build`.

---

### Task 1: Spielerliste – Dialoge auf Listenebene, Fokus nach dem Löschen, Hinweis auf Kontoverknüpfung

**Files:**
- Modify: `apps/web/src/components/players/player-list.tsx`
- Modify: `apps/web/src/components/players/roster-route.tsx` (Überschrift «Spieler» fokussierbar)
- Test: `apps/web/src/components/players/player-list.render.spec.tsx`

**Anforderungen:**
1. **Dialoge einmal je Liste statt je Zeile.** Heute rendert jede `PlayerRow` eigene `ConfirmDialog`-Instanzen (Archivieren, Löschen) und bei Bedarf einen `PlayerEditDialog`; jede Instanz registriert über `useDialogFocusReturn` einen dokumentweiten `focusout`-Listener. Umbauen: `PlayerList` hält einen Zustand `{ kind: "edit" | "archive" | "delete"; player: PlayerResponse } | null` und rendert höchstens einen Dialog. Die Zeilen melden nur noch die Absicht (`onEdit(player)`, `onArchive(player)`, `onDelete(player)`, `onReactivate(player)`). Die Mutationen (archive, delete, reactivate) wandern in `PlayerList` bzw. in einen kleinen Hook in derselben Datei; bestehendes Verhalten bleibt erhalten: 409 `PLAYER_HAS_HISTORY` → Meldung und «Stattdessen archivieren» (nur aktiv + `canArchive`, Button während `isPending` gesperrt, Fehler im offenen Dialog sichtbar), beim Öffnen werden beide Mutationen zurückgesetzt, Escape während `pending` schliesst nicht, Invalidierung von `["players", organizationId]`.
2. **Fokus nach dem Löschen.** Nach erfolgreichem endgültigem Löschen verschwindet die Zeile samt Fokus-Rückgabeziel; der Fokus landet heute auf `<body>`. Neu: Fokus auf die Überschrift «Spieler» in `roster-route.tsx` (`tabIndex={-1}`, per Ref oder `id` von `PlayerList` erreichbar – sauberste Variante wählen, z. B. Prop `headingRef` oder ein `onDeleted`-Callback), und eine Statusmeldung `role="status"` «{Name} wurde gelöscht.» in der Liste. Beim Archivieren/Reaktivieren bleibt die Zeile bestehen; dort kehrt der Fokus wie bisher zum auslösenden Button zurück.
3. **Hinweis auf Kontoverknüpfung.** Hat der Spieler ein verknüpftes Konto (`player.hasAccount`), ergänzt der Löschdialog den Satz: «Die Verknüpfung mit dem Benutzerkonto wird dabei aufgehoben; das Konto selbst bleibt bestehen.»

- [ ] Render-Tests zuerst (rot): höchstens ein `dialog` im DOM bei mehreren Spielern nach Öffnen; nach erfolgreichem Löschen hat die Überschrift den Fokus und die Statusmeldung ist sichtbar; Hinweissatz nur bei `hasAccount: true`; bestehende Tests (409-Fallback, IDs, Refetch, Escape/pending, Archiv-Reset) bleiben grün bzw. werden an die neue Struktur angepasst, ohne ihre Aussage zu verlieren.
- [ ] Umsetzen, Tests grün, Web-Typecheck, ESLint auf geänderten Dateien, Web-Unit-Suite, `player-management.spec.ts`, volle E2E-Suite.
- [ ] Commit `refactor(web): Spielerdialoge auf Listenebene, Fokus nach dem Loeschen, Hinweis auf Kontoverknuepfung`.

### Task 2: Mitgliederliste – Fokus nach dem Entfernen

**Files:**
- Modify: `apps/web/src/components/organization/members-route.tsx`
- Test: bestehende oder neue Render-Spec für `members-route` (prüfen, ob eine existiert; sonst `members-route.render.spec.tsx` nach dem Muster von `organization-settings-route.render.spec.tsx`)

**Anforderungen:** Nach erfolgreichem «Entfernen» verschwindet die Zeile; Fokus auf die Überschrift der Mitgliederliste (`tabIndex={-1}`) und Statusmeldung `role="status"` «{Name} wurde aus der Organisation entfernt.». Der Dialog liegt dort bereits auf Listenebene.

- [ ] Render-Test zuerst, dann umsetzen; Web-Typecheck, ESLint, Web-Unit-Suite, `members.spec.ts`, volle E2E-Suite.
- [ ] Commit `fix(web): Fokus nach dem Entfernen eines Mitglieds`.

### Task 3: Zeitzone und Sprache prüfen und auswählbar machen

**Files:**
- Modify: `packages/schemas/src/organization.ts` (+ Spec im Schemas-Paket)
- Modify: `apps/web/src/components/organization/organization-settings-route.tsx` (+ Render-Spec)
- Test: API-Integrationstest für `PATCH /organizations/:id` mit ungültiger Zeitzone (bestehende Datei `apps/api/src/organizations/organizations.integration.spec.ts` erweitern)

**Anforderungen:**
1. `timezone` in `createOrganizationSchema` und `updateOrganizationSchema` muss eine gültige IANA-Zeitzone sein: Prüfung per `new Intl.DateTimeFormat("en-US", { timeZone: value })` in `try/catch` (akzeptiert auch `UTC`, das in `Intl.supportedValuesOf("timeZone")` fehlt). Meldung: «Unbekannte Zeitzone.»
2. `locale` muss ein gültiges BCP-47-Tag sein: `Intl.getCanonicalLocales(value)` darf nicht werfen. Meldung: «Unbekannte Sprache.»
3. Web: Zeitzone als `<select>` aus `Intl.supportedValuesOf("timeZone")` (plus `UTC`, plus der aktuell gespeicherte Wert, falls er nicht in der Liste steht), Vorauswahl der gespeicherte Wert. Sprache als `<select>` mit `de-CH` (Deutsch, Schweiz), `fr-CH` (Französisch, Schweiz), `it-CH` (Italienisch, Schweiz), `en-GB` (Englisch) plus dem gespeicherten Wert, falls abweichend.
4. Ehrlich kommunizieren: unter den beiden Feldern ein Hinweis «Wird für Datums- und Zeitangaben dieser Organisation vorgemerkt.» ist **nicht** gewünscht, solange die Werte nirgends wirken; stattdessen im Ledger/Report vermerken, dass die Werte bisher ungenutzt sind (Nutzung ist eigenes Feature).
5. API-Test: `PATCH` mit `timezone: "Mars/Olympus"` → 400 `VALIDATION_ERROR`, gültige Zeitzone → 200.

- [ ] Tests zuerst (Schemas, Render, API), dann umsetzen; Schemas-Build, Typecheck (schemas, api, web), ESLint, betroffene Tests, `organization-settings.spec.ts`, volle E2E-Suite (Locators in `organization-settings.spec.ts` ggf. von Textfeld auf `selectOption` umstellen).
- [ ] Commit `feat: Zeitzone und Sprache der Organisation pruefen und auswaehlen`.

### Task 4: Stabiler Scoreboard-Helper in `team-encounter.spec.ts`

**Files:**
- Modify: `apps/web/tests/team-encounter.spec.ts` (Helper `record()`, ca. Zeile 197-218)

**Anforderungen:** `record()` wartet nach einer Rundenaufnahme auf `getByRole("button", { name: "Ziffer 0" })` enabled. Wechselt der Wurf danach zu einer Seite, die unter Double In noch nicht eröffnet hat, zeigt die Fläche das Dart-Keypad und «Ziffer 0» bleibt gesperrt – in CI einmal rot (PR #73), lokal grün (Race gegen den Refetch). Die Erfolgsbedingung so formulieren, dass sie in beiden Keypad-Modi gilt und trotzdem nachweist, dass die Aufnahme übernommen und das Absenden vorbei ist (z. B. `anyPlainKey = /^(Fehlwurf|Ziffer 0)$/` enabled wie in `openScoreboard`, plus Restscore-Assertion des Aufrufers, oder Warten auf das Ende von `submitPending` über einen vorhandenen stabilen Indikator). Kommentar im Helper anpassen. Keine Änderung am Anwendungscode.

- [ ] Umsetzen; `team-encounter.spec.ts` dreimal hintereinander allein grün (`--repeat-each=3` falls die Konfiguration es zulässt, sonst drei Läufe), dann volle E2E-Suite.
- [ ] Commit `test(web): Scoreboard-Helper wartet modusunabhaengig auf die uebernommene Aufnahme`.
