# Spec: Organisationen, Spieler und Mitglieder bearbeiten und löschen

Datum: 24.09.2026. Status: vom Nutzer freigegeben (Chat vom 24.09.2026).
Umsetzung in drei PRs nach `develop`: Spieler → Mitglieder → Organisation.

## Ausgangslage

| Entität | API heute | UI heute |
| --- | --- | --- |
| Spieler | `PATCH` alle Felder inkl. `status`; `DELETE :playerId` archiviert (`status=INACTIVE`, `player:archive`) | Inline-Bearbeitung nur `displayName`/`nickname`; «Archivieren» ohne Bestätigung; kein Reaktivieren |
| Mitglied | `PATCH members/:userId` (Rolle, `ACTIVE`/`SUSPENDED`); Spieler verknüpfen/lösen | Rolle, Zugang deaktivieren/reaktivieren, Verknüpfung; kein Entfernen |
| Organisation | `PATCH /organizations/:id` (`name`, `timezone`, `locale`; `organization:update`) | kein Bildschirm |

Endgültig löschen lässt sich keine der drei Entitäten. Spieler mit Historie
sind durch RESTRICT-Fremdschlüssel geschützt (`match_participant_players`,
`visits.thrower_player_id`, `tournament_participants`,
`tournament_group_participants`, `tournament_matches.participant_one_id` /
`participant_two_id` / `winner_player_id`, `team_players`,
`encounter_nominations`, `encounter_lineup_entries`,
`encounter_substitutions.out_player_id` / `in_player_id`).

## Entscheide

1. **Spieler:** Archivieren bleibt der Normalfall und ist reversibel.
   Endgültig löschen geht nur für Spieler ohne jede Historie.
2. **Mitglied löschen** heisst: aus der Organisation entfernen. Die
   Mitgliedschaft wird gelöscht, eine Spieler-Verknüpfung in dieser
   Organisation gelöst, das Benutzerkonto bleibt bestehen.
3. **Organisation löschen:** endgültig, nur OWNER, mit Eingabe des
   Organisationsnamens. Alle Daten der Organisation werden in einer
   Transaktion gelöscht; der Audit-Eintrag über die Löschung bleibt.

Nicht Teil dieser Spec: Anonymisieren von Spielern, Löschen von
Benutzerkonten, Löschfristen oder Wiederherstellung einer Organisation.

## Berechtigungen

Neu in `packages/domain/src/permissions.ts`:

| Permission | OWNER | ADMIN | übrige |
| --- | --- | --- | --- |
| `player:delete` | ja | ja | nein |
| `organization:delete` | ja | **nein** | nein |

ADMIN erhält heute alle Permissions (`new Set(organizationPermissions)`).
`organization:delete` wird dort ausdrücklich ausgenommen. Das Entfernen von
Mitgliedern nutzt die bestehende `organization:manage_members`. Keine
Migration nötig; Permissions leben im Code.

## 1. Spieler

### API

`DELETE /api/v1/organizations/:organizationId/players/:playerId/permanent`

- Service prüft `player:delete`.
- Repository in einer Transaktion:
  1. Spieler mit `organizationId` + `playerId` lesen und sperren
     (`FOR UPDATE`). Fehlt er → 404.
  2. Historie prüfen: existiert eine Zeile in einer der RESTRICT-Tabellen
     oben für diesen Spieler → Ergebnis `has-history` → **409
     `PLAYER_HAS_HISTORY`** («This player has match, tournament, team or
     encounter history and can only be archived.»).
  3. Audit `PLAYER_DELETED`, `entityType: "Player"`, `oldValue` = vorherige
     Zeile, `newValue: null`.
  4. `DELETE FROM players` (mit `organizationId`). `player_avatars` und
     `player_statistic_aggregates` gehen per CASCADE,
     `organization_invitations.player_id` wird per SET NULL gelöst.
  5. Scheitert das Löschen trotzdem an einem Fremdschlüssel (Postgres-Code
     `23503`, zum Beispiel wegen einer parallel entstandenen Historie), wird
     das ebenfalls auf 409 `PLAYER_HAS_HISTORY` abgebildet.
- Antwort: **204** ohne Body.
- Gilt unabhängig vom Status: auch ein aktiver Spieler ohne Historie kann
  gelöscht werden.

Bestehendes bleibt: `DELETE :playerId` archiviert, `PATCH` mit
`status: "ACTIVE"` reaktiviert (`player:update`).

### UI (`apps/web/src/components/players/`)

- **Bearbeiten-Dialog** statt Inline-Bearbeitung: Vorname, Nachname,
  Anzeigename, Spitzname, E-Mail, externe Referenz. React Hook Form + Zod
  mit `updatePlayerSchema` aus `@darts-platform/schemas`. Sichtbar mit
  `player:update`.
- **Archivieren** mit Bestätigungsdialog (Text: Spieler kann keine neuen
  Matches und Turniere mehr bestreiten, Historie bleibt, jederzeit
  reaktivierbar). Sichtbar mit `player:archive`.
- **Reaktivieren** bei archivierten Spielern (`PATCH status: "ACTIVE"`).
  Sichtbar mit `player:update`.
- **Endgültig löschen** mit Bestätigungsdialog. Sichtbar mit
  `player:delete`. Antwortet der Server mit 409 `PLAYER_HAS_HISTORY`,
  zeigt der Dialog die Erklärung und bietet «Stattdessen archivieren» an
  (nur wenn der Spieler aktiv ist und `player:archive` vorliegt).
- Dialoge folgen dem bestehenden Muster von `OwnerTransferDialog`
  (`role="dialog"`, `aria-modal`, `aria-labelledby`/`-describedby`), mit
  Fokusrückgabe (`use-dialog-focus-return.ts`) und Escape zum Schliessen.
  Ein gemeinsamer `ConfirmDialog` in `apps/web/src/components/` ersetzt
  die Kopien, sofern der `OwnerTransferDialog` ohne Verhaltensänderung
  darauf umgestellt werden kann.
- Nach jeder Mutation wird die Spielerliste über TanStack Query
  invalidiert. Fehler erscheinen sichtbar (`role="alert"`).

## 2. Mitglieder

### API

`DELETE /api/v1/organizations/:organizationId/members/:userId`

- Service prüft `organization:manage_members`.
- Eigene Mitgliedschaft → **403 `SELF_MEMBERSHIP_CHANGE_FORBIDDEN`** (wie
  beim `PATCH`).
- Repository in einer Transaktion, analog `updateMembership`:
  1. Mitgliedschaft der handelnden Person sperren; nicht aktiv →
     403 `PERMISSION_DENIED`.
  2. Ziel-Mitgliedschaft sperren; fehlt → 404.
  3. Ziel ist OWNER und handelnde Person nicht OWNER → **403
     `OWNER_CHANGE_REQUIRES_OWNER`**.
  4. Ziel ist aktiver OWNER und kein anderer aktiver OWNER existiert →
     **409 `LAST_OWNER_PROTECTED`**.
  5. Verknüpften Spieler dieser Organisation lösen (`players.user_id =
     NULL`), mit Audit `PLAYER_UNLINKED` wie beim bestehenden Lösen.
  6. Audit `MEMBER_REMOVED`, `entityType: "Membership"`, `oldValue` mit
     `userId`, `email`, `role`, `status`, `newValue: null`.
  7. Mitgliedschaft löschen.
- Antwort: **204**.
- Offene Einladungen an dieselbe E-Mail bleiben unberührt. Eine neue
  Einladung nach dem Entfernen ist möglich.

### UI (`apps/web/src/components/organization/members-route.tsx`)

- Button «Entfernen» je Mitglied (nicht bei sich selbst; bei OWNER nur für
  OWNER sichtbar). Bestätigungsdialog nennt die Folgen: Zugang zur
  Organisation weg, Spieler-Verknüpfung gelöst, Konto bleibt, erneute
  Einladung möglich.
- «Zugang deaktivieren» bleibt als reversible Variante.
- Serverfehler (`LAST_OWNER_PROTECTED` usw.) erscheinen im Dialog.

## 3. Organisation

### API

`DELETE /api/v1/organizations/:organizationId`

- Body: `{ "confirmName": string }`, Zod-Schema
  `deleteOrganizationSchema` in `packages/schemas/src/organization.ts`.
- Service prüft `organization:delete`. Stimmt `confirmName` nach `trim()`
  nicht exakt mit dem gespeicherten Namen überein → **400
  `ORGANIZATION_NAME_MISMATCH`**. Reihenfolge wie im Bestand: erst
  Validierung, dann Autorisierung, dann Namensvergleich.
- Repository in einer Transaktion:
  1. Organisation sperren (`FOR UPDATE`); fehlt → 404.
  2. Mitgliedschaft der handelnden Person erneut prüfen: aktiver OWNER,
     sonst 403.
  3. Audit `ORGANIZATION_DELETED`, `entityType: "Organization"`,
     `entityId` = Organisations-Id, `oldValue` mit `id`, `name`, `slug`,
     `timezone`, `locale` und Anzahl Mitglieder/Spieler/Turniere,
     `newValue: null`. Weil `audit_events.organization_id` beim Löschen
     auf NULL gesetzt wird, trägt der Eintrag die Identität selbst.
  4. Alle Daten der Organisation löschen. Innerhalb eines Mandanten gibt es
     RESTRICT-Fremdschlüssel (Spieler ↔ Matches/Turniere/Teams/Begegnungen,
     `tournament_boards.board_id`, `encounters.home_team_id` /
     `away_team_id`). Ob `DELETE FROM organizations` mit der Kaskade allein
     durchläuft, ist nicht belegt. Deshalb löscht das Repository die
     abhängigen Tabellen in einer festen, getesteten Reihenfolge und zuletzt
     die Organisation. Alle Statements tragen `organization_id = $1`.
- Antwort: **204**.
- Kein Realtime-Broadcast nötig: Clients anderer Mitglieder erhalten beim
  nächsten Zugriff 403/404 und die Auswahl fällt zurück.

### UI

- Neue Seite `/organisation` (`apps/web/src/app/organisation/page.tsx`),
  verlinkt aus dem Dashboard für Rollen mit `organization:update`.
- Formular Name, Zeitzone, Sprache (React Hook Form + Zod mit
  `updateOrganizationSchema`). Slug nur angezeigt.
- Bereich «Organisation löschen», nur mit `organization:delete`: Text mit
  den Folgen (alle Spieler, Turniere, Matches, Ligen, Statistiken,
  Mitgliedschaften; unumkehrbar), Eingabefeld für den Namen, Button erst
  aktiv, wenn der Name exakt passt.
- Nach dem Löschen: Organisationsauswahl zurücksetzen
  (`lib/organization-selection.ts`), Queries invalidieren, Weiterleitung
  zur Startseite.

## Fehlerformat

Alle neuen Fehler im einheitlichen Format (`error.code`, `message`,
`correlationId`). Neue Codes: `PLAYER_HAS_HISTORY` (409),
`ORGANIZATION_NAME_MISMATCH` (400).

## Tests

- **Domain:** Permission-Tests für `player:delete` und
  `organization:delete` je Rolle (ADMIN ohne `organization:delete`).
- **API-Integration je Route:**
  - Erfolg inkl. Audit-Eintrag und Folgedaten (Avatar weg,
    Einladung ohne Spielerbezug; Verknüpfung gelöst; alle Mandantendaten
    weg).
  - 403 für Rollen ohne Permission, 404 für fremde Organisation
    (Mandantentrennung).
  - Spieler mit Historie in jeder RESTRICT-Tabelle → 409.
  - Mitglieder: sich selbst, letzter OWNER, OWNER durch ADMIN.
  - Organisation: falscher Name → 400; ADMIN → 403; eine vollständig
    gefüllte Organisation (Spieler, Board, Match mit Aufnahmen, Turnier mit
    Gruppen und K.-o., Team, Wettbewerb, Begegnung mit Aufstellung,
    Einladung, E-Mail-Auftrag, Avatar, Statistik) wird vollständig
    gelöscht, eine zweite Organisation bleibt unverändert.
- **Tenant-Isolations-Matrix**
  (`apps/api/src/security/tenant-isolation-matrix.integration.spec.ts`):
  die drei neuen Routen aufnehmen.
- **Web:** Render-Tests für die Dialoge (Sichtbarkeit je Permission,
  409-Fallback, Namensbestätigung).
- **E2E (Playwright):** je ein Ablauf Spieler bearbeiten/löschen, Mitglied
  entfernen, Organisation umbenennen und löschen.

## Dokumentation

- ADR 0018 «Löschkonzept für Spieler, Mitglieder und Organisationen».
- `ARCHITECTURE.md`: Permissions-Liste und Mitgliederabschnitt.
- Bedienungsanleitung (`apps/web/public/bedienungsanleitung.html`):
  Bearbeiten, Archivieren, Löschen, Entfernen, Organisationsseite.

## Offene Punkte

- **Datenschutz:** Audit-Einträge eines gelöschten Spielers oder einer
  gelöschten Organisation enthalten weiterhin Personendaten (zum Beispiel
  Name und E-Mail in `oldValue`). Ob das so bleiben darf oder anonymisiert
  werden muss, klärt Legal/Compliance. Diese Spec ändert daran nichts.
