# Bearbeiten und Löschen – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spieler, Mitglieder und Organisationen lassen sich im UI bearbeiten und löschen – mit den Grenzen aus der Spec (Spieler nur ohne Historie endgültig, Mitglieder entfernen, Organisation nur OWNER mit Namensbestätigung).

**Architecture:** Drei neue DELETE-Routen nach dem Bestandsmuster Controller → Service (Permission) → Repository (Transaktion, `organizationId`, Audit in derselben Transaktion). Zwei neue Permissions im Domain-Paket. Web: ein gemeinsamer `ConfirmDialog`, ein Spieler-Bearbeiten-Dialog, Entfernen-Button in der Mitgliederliste, neue Seite `/organisation`.

**Tech Stack:** NestJS + Fastify, Drizzle/PostgreSQL, Zod (`@darts-platform/schemas`), Next.js/React, TanStack Query, React Hook Form, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-24-bearbeiten-loeschen-design.md`

## Global Constraints

- Jede Repository-Funktion erhält `organizationId` explizit; jede Query ist danach eingeschränkt (AGENTS.md §14).
- Audit-Insert in derselben Transaktion wie die Mutation, auf Repository-Ebene, Aktionsnamen SCREAMING_SNAKE_CASE.
- Fehler im einheitlichen Format über Nest-Exceptions mit `{ code, message }`; keine Stacktraces.
- Kein `any`. `strict: true`.
- Keine Migration (Permissions leben im Code; es kommt keine Spalte dazu).
- Neue Fehlercodes: `PLAYER_HAS_HISTORY` (409), `ORGANIZATION_NAME_MISMATCH` (400). Wiederverwendet: `SELF_MEMBERSHIP_CHANGE_FORBIDDEN` (403), `OWNER_CHANGE_REQUIRES_OWNER` (403), `LAST_OWNER_PROTECTED` (409).
- Neue Audit-Aktionen: `PLAYER_DELETED`, `MEMBER_REMOVED`, `ORGANIZATION_DELETED`.
- UI-Texte Deutsch, Schweizer Rechtschreibung (kein ß). Dialoge: `role="dialog"`, `aria-modal`, `aria-labelledby`, `aria-describedby`, Escape schliesst, Fokus kehrt zurück.
- Commit-Messages: Conventional Commits, Deutsch, **kein** `Co-Authored-By`-Trailer.
- Einzelne API-Testdatei: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/<pfad>.spec.ts`. Vorher geänderte Pakete bauen: `pnpm --filter @darts-platform/domain build`, `pnpm --filter @darts-platform/schemas build` (API-Tests lesen `packages/*/dist`).
- Web-Einzeltest: `cd apps/web && npx vitest run src/<pfad>.spec.tsx`. E2E nur über `pnpm test:e2e` bzw. `npx dotenv -e .env -- pnpm --filter @darts-platform/web test:e2e <datei>.spec.ts` aus dem Repo-Root.
- Lokale Infrastruktur muss laufen: `pnpm infra:up`.

## Lieferung

Ein Branch `feature/bearbeiten-loeschen`, drei PRs nach `develop`:

- PR 1 nach Task 4 (Spieler, inkl. beider Permissions)
- PR 2 nach Task 6 (Mitglieder)
- PR 3 nach Task 8 (Organisation, ADR)

Nach jedem Merge wird `develop` in den Branch zurückgemergt, bevor der nächste Task beginnt.

## Dateiübersicht

| Datei | Verantwortung |
| --- | --- |
| `packages/domain/src/permissions.ts` | `player:delete`, `organization:delete`; ADMIN ohne `organization:delete` |
| `packages/schemas/src/organization.ts` | `deleteOrganizationSchema` |
| `apps/api/src/players/players.{repository,service,controller}.ts` | `deletePermanently` |
| `apps/api/src/players/player-deletion.integration.spec.ts` (neu) | Tests endgültiges Löschen |
| `apps/api/src/organizations/organizations.{repository,service,controller}.ts` | `removeMember`, `deleteOrganization` |
| `apps/api/src/organizations/member-removal.integration.spec.ts` (neu) | Tests Entfernen |
| `apps/api/src/organizations/organization-deletion.integration.spec.ts` (neu) | Tests Löschen Organisation |
| `apps/api/src/security/tenant-isolation-matrix.integration.spec.ts` | Body für `DELETE /organizations/:organizationId` |
| `apps/web/src/components/confirm-dialog.tsx` (neu) | gemeinsamer Bestätigungsdialog |
| `apps/web/src/components/players/player-edit-dialog.tsx` (neu) | Bearbeiten aller Spielerfelder |
| `apps/web/src/components/players/player-list.tsx` | Aktionen Bearbeiten/Archivieren/Reaktivieren/Löschen |
| `apps/web/src/components/organization/members-route.tsx` | Entfernen |
| `apps/web/src/lib/membership-actions.ts` | `canRemove` |
| `apps/web/src/app/organisation/page.tsx`, `apps/web/src/components/organization/organization-settings-route.tsx` (neu) | Organisationsseite |
| `apps/web/src/components/tenant-dashboard.tsx` | Link «Organisation» |
| `apps/web/src/lib/api-client.ts` | Übersetzungen der neuen Codes |
| `apps/web/public/bedienungsanleitung.html`, `ARCHITECTURE.md`, `docs/adr/0018-loeschkonzept.md` | Doku |

---

## PR 1 – Spieler

### Task 1: Permissions `player:delete` und `organization:delete`

**Files:**
- Modify: `packages/domain/src/permissions.ts`
- Test: `packages/domain/src/permissions.spec.ts`

**Interfaces:**
- Produces: `OrganizationPermission` enthält `"player:delete"` und `"organization:delete"`. `hasOrganizationPermission("ADMIN", "organization:delete") === false`.

- [ ] **Step 1: Failing test ergänzen** (am Ende des `describe` in `permissions.spec.ts`)

```ts
  it("reserves permanent player deletion for owners and admins", () => {
    expect(hasOrganizationPermission("OWNER", "player:delete")).toBe(true);
    expect(hasOrganizationPermission("ADMIN", "player:delete")).toBe(true);
    for (const role of ["TOURNAMENT_DIRECTOR", "SCORER", "MEMBER", "VIEWER"] as const) {
      expect(hasOrganizationPermission(role, "player:delete")).toBe(false);
    }
  });

  it("reserves deleting the organization for owners", () => {
    expect(hasOrganizationPermission("OWNER", "organization:delete")).toBe(true);
    for (const role of ["ADMIN", "TOURNAMENT_DIRECTOR", "SCORER", "MEMBER", "VIEWER"] as const) {
      expect(hasOrganizationPermission(role, "organization:delete")).toBe(false);
    }
  });
```

- [ ] **Step 2: Test laufen lassen, muss scheitern**

Run: `cd packages/domain && npx vitest run src/permissions.spec.ts`
Expected: FAIL (Typfehler/false für unbekannte Permission).

- [ ] **Step 3: Implementieren**

In `organizationPermissions` nach `"organization:manage_roles"` einfügen `"organization:delete",` und nach `"player:archive"` einfügen `"player:delete",`.

ADMIN ersetzen:

```ts
  // Die Organisation zu loeschen bleibt der Inhaberschaft vorbehalten
  // (Spec 2026-09-24-bearbeiten-loeschen): ADMIN erhaelt sonst jede
  // Permission, diese eine nicht.
  ADMIN: new Set<OrganizationPermission>(
    organizationPermissions.filter((permission) => permission !== "organization:delete"),
  ),
```

- [ ] **Step 4: Tests grün**

Run: `cd packages/domain && npx vitest run` — Expected: PASS. Danach `pnpm --filter @darts-platform/domain build` und `pnpm --filter @darts-platform/domain typecheck`.

Prüfen, ob irgendwo eine vollständige Permission-Liste gespiegelt wird (z. B. Snapshot oder `ARCHITECTURE.md:315-335`): `grep -rn "player:archive" --include=*.ts --include=*.md . | grep -v node_modules`. Codestellen, die eine vollständige Liste erwarten, anpassen; die Doku folgt in Task 4.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/permissions.ts packages/domain/src/permissions.spec.ts
git commit -m "feat(domain): Permissions player:delete und organization:delete"
```

### Task 2: API – Spieler endgültig löschen

**Files:**
- Modify: `apps/api/src/players/players.repository.ts` (neue Methode nach `archive`, ca. Zeile 307)
- Modify: `apps/api/src/players/players.service.ts` (neue Methode nach `archive`)
- Modify: `apps/api/src/players/players.controller.ts` (neue Route nach `archive`, ca. Zeile 106)
- Create: `apps/api/src/players/player-deletion.integration.spec.ts`

**Interfaces:**
- Consumes: Permission `"player:delete"` (Task 1).
- Produces: `DELETE /api/v1/organizations/:organizationId/players/:playerId/permanent` → 204; 404 unbekannt; 403 ohne Permission; 409 `PLAYER_HAS_HISTORY`.
- Repository: `deletePermanently(input: TenantActorInput & { readonly playerId: string }): Promise<"deleted" | "not-found" | "has-history">`.

- [ ] **Step 1: Failing Integrationstest schreiben**

`player-deletion.integration.spec.ts`: Aufbau wie `apps/api/src/players/tenant-isolation.integration.spec.ts` (gleiche Instanziierung von `DatabaseService`, `OrganizationsRepository`, `OrganizationAccessService`, `PlayersRepository`, `PlayersService`; eigene Organisationen und Benutzer mit `randomUUID()`, Aufräumen in `afterAll` per `delete(organizations)`/`delete(users)`). Benutzer: `ownerUserId` (OWNER), `directorUserId` (TOURNAMENT_DIRECTOR) in Organisation A; `foreignUserId` OWNER in Organisation B.

Fälle (jeweils Spieler direkt per `databaseService.database.insert(players)` anlegen):

```ts
it("deletes a player without history, with avatar and audit", async () => {
  const [player] = await db.insert(players).values({
    organizationId: orgA, displayName: "Ohne Historie", status: "ACTIVE",
  }).returning();
  await db.insert(playerAvatars).values({
    organizationId: orgA, playerId: player!.id, contentType: "image/webp",
    bytes: Buffer.from([1, 2, 3]), checksum: "abc",
  });
  const [invitation] = await db.insert(organizationInvitations).values({ /* offene Einladung mit playerId: player.id – Pflichtfelder aus schema.ts:260-300 übernehmen */ }).returning();

  await playersService.deletePermanently({ organizationId: orgA, playerId: player!.id, auth: ownerAuth, audit });

  expect(await db.select().from(players).where(eq(players.id, player!.id))).toEqual([]);
  expect(await db.select().from(playerAvatars).where(eq(playerAvatars.playerId, player!.id))).toEqual([]);
  const [after] = await db.select().from(organizationInvitations).where(eq(organizationInvitations.id, invitation!.id));
  expect(after?.playerId).toBeNull();
  const [event] = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, player!.id), eq(auditEvents.action, "PLAYER_DELETED")));
  expect(event?.organizationId).toBe(orgA);
  expect(event?.actorUserId).toBe(ownerUserId);
  expect(event?.newValue).toBeNull();
});

it("refuses a player with history with 409 PLAYER_HAS_HISTORY and keeps him", async () => {
  // Historie über teamPlayers (einfachste RESTRICT-Tabelle): Team anlegen, Spieler in den Kader.
  // Pflichtfelder von teams / teamPlayers aus schema.ts:1180-1230 übernehmen.
  await expect(playersService.deletePermanently({ organizationId: orgA, playerId: withHistory.id, auth: ownerAuth, audit }))
    .rejects.toMatchObject({ status: 409, response: { code: "PLAYER_HAS_HISTORY" } });
  expect(await db.select().from(players).where(eq(players.id, withHistory.id))).toHaveLength(1);
  // kein PLAYER_DELETED-Audit
});

it("refuses a player with match history", async () => {
  // Match mit zwei Spielern über playersService/matchesService anlegen ODER direkt matches + match_participants + match_participant_players einfügen.
  // Erwartung wie oben: 409 PLAYER_HAS_HISTORY.
});

it("forbids roles without player:delete", async () => {
  await expect(playersService.deletePermanently({ organizationId: orgA, playerId: p.id, auth: directorAuth, audit }))
    .rejects.toMatchObject({ status: 403 });
});

it("answers 404 for a player of another organization", async () => {
  await expect(playersService.deletePermanently({ organizationId: orgA, playerId: foreignPlayer.id, auth: ownerAuth, audit }))
    .rejects.toMatchObject({ status: 404 });
  expect(await db.select().from(players).where(eq(players.id, foreignPlayer.id))).toHaveLength(1);
});
```

Die ausgelassenen Pflichtfelder (`/* … */`) konkret aus `packages/database/src/schema.ts` übernehmen; keine Platzhalter im Test lassen. Prüfe, wie `HttpException` in bestehenden Integrationstests abgefragt wird (`grep -rn "rejects.toMatchObject" apps/api/src | head`), und übernimm dieselbe Form.

- [ ] **Step 2: Test laufen lassen – scheitert** (`deletePermanently` existiert nicht)

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/players/player-deletion.integration.spec.ts`

- [ ] **Step 3: Repository implementieren** (`players.repository.ts`, Imports um `encounterLineupEntries, encounterNominations, encounterSubstitutions, matchParticipantPlayers, teamPlayers, tournamentGroupParticipants, tournamentMatches, tournamentParticipants, visits` aus `@darts-platform/database` und `or`, `sql` aus `drizzle-orm` erweitern)

```ts
function isForeignKeyViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23503";
}

  /**
   * Loescht einen Spieler endgueltig — nur, wenn er keine Historie hat
   * (Spec 2026-09-24-bearbeiten-loeschen). Die RESTRICT-Fremdschluessel
   * bleiben die letzte Wache; die ausdrueckliche Pruefung vorher liefert
   * eine verstaendliche Antwort statt eines Datenbankfehlers.
   */
  public async deletePermanently(
    input: TenantActorInput & { readonly playerId: string },
  ): Promise<"deleted" | "not-found" | "has-history"> {
    try {
      return await this.databaseService.database.transaction(async (transaction) => {
        const [previous] = await transaction
          .select()
          .from(players)
          .where(and(eq(players.organizationId, input.organizationId), eq(players.id, input.playerId)))
          .limit(1)
          .for("update");

        if (previous === undefined) {
          return "not-found";
        }

        if (await hasPlayerHistory(transaction, input.organizationId, input.playerId)) {
          return "has-history";
        }

        await transaction.insert(auditEvents).values({
          organizationId: input.organizationId,
          actorUserId: input.userId,
          action: "PLAYER_DELETED",
          entityType: "Player",
          entityId: previous.id,
          oldValue: previous,
          newValue: null,
          ip: input.audit.ip,
          userAgent: input.audit.userAgent,
          correlationId: input.audit.correlationId,
        });

        await transaction
          .delete(players)
          .where(and(eq(players.organizationId, input.organizationId), eq(players.id, input.playerId)));

        return "deleted";
      });
    } catch (error) {
      // Eine parallel entstandene Historie scheitert am RESTRICT-Schluessel.
      if (isForeignKeyViolation(error)) {
        return "has-history";
      }
      throw error;
    }
  }
```

Hilfsfunktion (Modulebene, unter `toPlayerResponse`):

```ts
/** Kommt der Spieler in einer Tabelle vor, die ihn per RESTRICT festhaelt? */
async function hasPlayerHistory(
  executor: DatabaseExecutor,
  organizationId: string,
  playerId: string,
): Promise<boolean> {
  const probes = [
    executor.select({ id: matchParticipantPlayers.playerId }).from(matchParticipantPlayers)
      .where(and(eq(matchParticipantPlayers.organizationId, organizationId), eq(matchParticipantPlayers.playerId, playerId))).limit(1),
    executor.select({ id: visits.id }).from(visits)
      .where(and(eq(visits.organizationId, organizationId), eq(visits.throwerPlayerId, playerId))).limit(1),
    executor.select({ id: tournamentParticipants.playerId }).from(tournamentParticipants)
      .where(and(eq(tournamentParticipants.organizationId, organizationId), eq(tournamentParticipants.playerId, playerId))).limit(1),
    executor.select({ id: tournamentGroupParticipants.playerId }).from(tournamentGroupParticipants)
      .where(and(eq(tournamentGroupParticipants.organizationId, organizationId), eq(tournamentGroupParticipants.playerId, playerId))).limit(1),
    executor.select({ id: tournamentMatches.id }).from(tournamentMatches)
      .where(and(
        eq(tournamentMatches.organizationId, organizationId),
        or(
          eq(tournamentMatches.participantOneId, playerId),
          eq(tournamentMatches.participantTwoId, playerId),
          eq(tournamentMatches.winnerPlayerId, playerId),
        ),
      )).limit(1),
    executor.select({ id: teamPlayers.playerId }).from(teamPlayers)
      .where(and(eq(teamPlayers.organizationId, organizationId), eq(teamPlayers.playerId, playerId))).limit(1),
    executor.select({ id: encounterNominations.playerId }).from(encounterNominations)
      .where(and(eq(encounterNominations.organizationId, organizationId), eq(encounterNominations.playerId, playerId))).limit(1),
    executor.select({ id: encounterLineupEntries.playerId }).from(encounterLineupEntries)
      .where(and(eq(encounterLineupEntries.organizationId, organizationId), eq(encounterLineupEntries.playerId, playerId))).limit(1),
    executor.select({ id: encounterSubstitutions.id }).from(encounterSubstitutions)
      .where(and(
        eq(encounterSubstitutions.organizationId, organizationId),
        or(eq(encounterSubstitutions.outPlayerId, playerId), eq(encounterSubstitutions.inPlayerId, playerId)),
      )).limit(1),
  ];
  const results = await Promise.all(probes);
  return results.some((rows) => rows.length > 0);
}
```

Vor dem Einbau prüfen: Hat jede dieser Tabellen eine Spalte `organizationId` und die hier verwendete Id-Spalte (`id` bzw. `playerId`)? `grep -n` in `schema.ts` ab den Zeilen 471, 531, 911, 1041, 1073, 1201, 1545, 1593, 1633. Fehlt `organizationId` in einer Tabelle, dort nur nach `playerId` filtern (die Spieler-Id ist global eindeutig) und das im Kommentar begründen. `Promise.all` auf einer Transaktion: falls der Treiber parallele Queries auf einer Verbindung nicht erlaubt, sequentiell in einer `for`-Schleife ausführen.

- [ ] **Step 4: Service** (`players.service.ts`, `ConflictException` importieren)

```ts
  public async deletePermanently(input: {
    readonly organizationId: string;
    readonly playerId: string;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<void> {
    await this.organizationAccessService.requirePermission({
      organizationId: input.organizationId,
      userId: input.auth.user.id,
      permission: "player:delete",
    });
    const outcome = await this.playersRepository.deletePermanently({
      organizationId: input.organizationId,
      playerId: input.playerId,
      userId: input.auth.user.id,
      audit: input.audit,
    });
    switch (outcome) {
      case "not-found":
        throw new NotFoundException("Player not found.");
      case "has-history":
        throw new ConflictException({
          code: "PLAYER_HAS_HISTORY",
          message: "This player has match, tournament, team or encounter history and can only be archived.",
        });
      case "deleted":
        return;
    }
  }
```

- [ ] **Step 5: Controller** (`players.controller.ts`, `HttpCode` importieren)

```ts
  /**
   * Endgueltiges Loeschen, nur ohne Historie. Die Route darunter
   * (`DELETE :playerId`) archiviert und bleibt der Normalfall.
   */
  @Delete(":playerId/permanent")
  @HttpCode(204)
  public async deletePermanently(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("playerId", ParseUUIDPipe) playerId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.playersService.deletePermanently({
      organizationId,
      playerId,
      auth,
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
    });
  }
```

- [ ] **Step 6: Tests grün**

Run: Datei aus Step 2, dann `src/security/tenant-isolation-matrix.integration.spec.ts` und `src/testing/route-inventory.integration.spec.ts` (neue Route wird automatisch erfasst; muss 403/404 liefern). `pnpm --filter @darts-platform/api typecheck` und `pnpm --filter @darts-platform/api lint`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/players
git commit -m "feat(api): Spieler ohne Historie endgueltig loeschen"
```

### Task 3: Web – Spieler bearbeiten, archivieren, reaktivieren, löschen

**Files:**
- Create: `apps/web/src/components/confirm-dialog.tsx`
- Create: `apps/web/src/components/confirm-dialog.render.spec.tsx`
- Create: `apps/web/src/components/players/player-edit-dialog.tsx`
- Modify: `apps/web/src/components/players/player-list.tsx`
- Modify: `apps/web/src/components/players/roster-route.tsx:53-56` (`canDelete`)
- Modify: `apps/web/src/components/players/player-list.render.spec.tsx`
- Modify: `apps/web/src/lib/api-client.ts` (Meldung `PLAYER_HAS_HISTORY`)

**Interfaces:**
- Consumes: `DELETE …/players/:id/permanent` (Task 2), `DELETE …/players/:id` (Archiv), `PATCH …/players/:id`.
- Produces: `ConfirmDialog` (auch von Task 6 und 8 genutzt):

```ts
export function ConfirmDialog(props: {
  readonly open: boolean;
  readonly title: string;
  readonly description: React.ReactNode;
  readonly confirmLabel: string;
  readonly confirmVariant?: "danger" | "primary";
  readonly pending: boolean;
  readonly error: string | null;
  readonly confirmDisabled?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly children?: React.ReactNode; // z. B. Eingabefeld für Namensbestätigung
}): React.JSX.Element | null;
```

- [ ] **Step 1: `ConfirmDialog` mit Render-Test (TDD)**

Vorab lesen: `apps/web/src/components/match/use-dialog-focus-return.ts` (erwartet ein `HTMLDialogElement`-Ref) und ein vorhandenes `*.render.spec.tsx` (z. B. `player-avatar-control.render.spec.tsx`) für das Testmuster. Verwende ein natives `<dialog>` mit `showModal()`/`close()` in einem `useEffect`, damit `useDialogFocusReturn` passt und Escape nativ über das `cancel`-Event schliesst (`onCancel` aufrufen, `event.preventDefault()`). Optik aus `OwnerTransferDialog` (`members-route.tsx:453-486`) übernehmen: `rounded-2xl border border-ring-red-deep/50 bg-slate-950 p-5 text-white shadow-2xl sm:p-6`, Buttons `variant="outline"` und `variant={confirmVariant ?? "danger"}` aus `@darts-platform/ui`. Fehler als `<p role="alert" className="text-body text-rose-300">`.

Tests:
- rendert nichts bei `open=false`
- zeigt Titel/Beschreibung, `aria-labelledby`/`aria-describedby` zeigen auf vorhandene IDs (`useId()`)
- Klick auf Bestätigen ruft `onConfirm`, Abbrechen ruft `onCancel`
- `confirmDisabled` bzw. `pending` deaktiviert Bestätigen
- `error` wird als `role="alert"` angezeigt

Falls jsdom `HTMLDialogElement.showModal` nicht kennt: im Test `HTMLDialogElement.prototype.showModal = vi.fn()` / `close = vi.fn()` stubben (prüfen, ob ein Setup das schon tut: `grep -rn showModal apps/web/src`).

Run: `cd apps/web && npx vitest run src/components/confirm-dialog.render.spec.tsx` → erst FAIL, nach Implementierung PASS.

- [ ] **Step 2: `PlayerEditDialog`**

React Hook Form + `zodResolver`, Muster aus `player-form.tsx`. Felder: `firstName`, `lastName`, `displayName` (Pflicht), `nickname`, `email`, `externalReference`, vorbelegt aus `player`. Leere optionale Felder als `null` senden (so wie `player-form.tsx` es beim Anlegen macht – dort nachsehen). Mutation `PATCH /organizations/${organizationId}/players/${player.id}` mit `schema: playerSchema`, bei Erfolg `invalidateQueries({ queryKey: ["players", organizationId] })` und schliessen. Eingaben nutzen `inputClassName` aus `./form-styles`. Dialog-Grundgerüst wie `ConfirmDialog` (natives `<dialog>`, gleiche Klassen), Titel «Spieler bearbeiten», Buttons «Abbrechen»/«Speichern».

- [ ] **Step 3: `PlayerList`/`PlayerRow` umbauen**

- Props: `canEdit`, `canArchive`, neu `canDelete`.
- Inline-Bearbeitung entfernen; «Bearbeiten» öffnet `PlayerEditDialog`.
- «Archivieren» (aktiv, `canArchive`) öffnet `ConfirmDialog`: Titel «Spieler archivieren», Text «{Name} kann danach keine neuen Matches und Turniere bestreiten. Resultate und Statistik bleiben erhalten, und du kannst den Spieler jederzeit reaktivieren.», Button «Archivieren», `confirmVariant="primary"`.
- «Reaktivieren» (archiviert, `canEdit`): direkt `PATCH { status: "ACTIVE" }`, ohne Dialog.
- «Löschen» (`canDelete`) öffnet `ConfirmDialog`: Titel «Spieler endgültig löschen», Text «{Name} wird mit Profilbild und Statistik gelöscht. Das lässt sich nicht rückgängig machen. Spieler, die bereits gespielt haben oder in einem Team stehen, lassen sich nur archivieren.», Button «Endgültig löschen».
  - Mutation `DELETE /organizations/${organizationId}/players/${player.id}/permanent`, `schema: z.undefined()` (siehe `api-client.ts:161-166` für 204).
  - Fehler `ApiClientError` mit `code === "PLAYER_HAS_HISTORY"`: Dialog zeigt die Meldung aus `userFacingErrorMessage` und, wenn `player.status === "ACTIVE" && canArchive`, einen zusätzlichen Button «Stattdessen archivieren» (als `children` im Dialog), der die Archiv-Mutation auslöst und den Dialog schliesst.
- Mutationen invalidieren `["players", organizationId]`; Fehler der Mutationen sichtbar (`role="alert"`).
- In `roster-route.tsx`: `const canDeletePlayers = hasOrganizationPermission(organization.role, "player:delete");` und an `PlayerList` durchreichen.
- `api-client.ts` → `localizedMessage`: `PLAYER_HAS_HISTORY: "Dieser Spieler hat bereits gespielt oder steht in einem Team. Er lässt sich nur archivieren."`

- [ ] **Step 4: Render-Tests in `player-list.render.spec.tsx` ergänzen**

Bestehende Tests lesen und das Mock-Muster für `apiRequest`/`fetch` übernehmen. Neue Fälle:
- «Löschen» nur mit `canDelete`; «Reaktivieren» nur bei archivierten Spielern mit `canEdit`; «Archivieren» öffnet einen Dialog statt sofort zu senden.
- Löschen mit 409 `PLAYER_HAS_HISTORY` zeigt die Meldung und «Stattdessen archivieren»; Klick sendet `DELETE …/players/:id` (ohne `/permanent`).
- Bearbeiten öffnet einen Dialog mit allen sechs Feldern, vorbelegt.

Run: `cd apps/web && npx vitest run src/components/players` → PASS. Dazu `pnpm --filter @darts-platform/web typecheck` und `lint`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): Spieler bearbeiten, archivieren mit Bestaetigung, reaktivieren und loeschen"
```

### Task 4: E2E Spieler, Doku, PR 1

**Files:**
- Create: `apps/web/tests/player-management.spec.ts`
- Modify: `apps/web/public/bedienungsanleitung.html`
- Modify: `ARCHITECTURE.md` (Permissions-Liste um `player:delete`, `organization:delete`)

- [ ] **Step 1: E2E schreiben**

Muster und Fixtures aus `apps/web/tests/player-avatar.spec.ts` und `apps/web/tests/fixtures.ts` übernehmen (Anmeldung als Owner einer frischen Organisation). Ablauf:
1. Spieler «Testspieler Löschbar» anlegen → «Bearbeiten» → Spitzname und E-Mail ändern → Speichern → neue Werte in der Liste sichtbar.
2. «Archivieren» → Dialog bestätigen → Status «Archiviert» → «Reaktivieren» → Status «Aktiv».
3. «Löschen» → «Endgültig löschen» → Spieler verschwindet aus der Liste.
4. Zweiten Spieler anlegen, in ein Team aufnehmen (UI unter `/teams`, oder per API-Request im Test, wie andere Specs es tun) → «Löschen» → Meldung «nur archivieren» und Button «Stattdessen archivieren» → Klick → Status «Archiviert».

Run: `npx dotenv -e .env -- pnpm --filter @darts-platform/web test:e2e player-management.spec.ts` (aus dem Repo-Root) → PASS.

- [ ] **Step 2: Bedienungsanleitung**

Im Abschnitt über Spieler (Datei durchsuchen nach «Spieler») einen Unterabschnitt «Spieler bearbeiten, archivieren und löschen» ergänzen: Bearbeiten aller Felder; Archivieren (reversibel, Historie bleibt); Reaktivieren; Endgültig löschen nur ohne Historie, nur Owner/Admin. Wenn ein neuer `<section id="…">` entsteht, muss er im Inhaltsverzeichnis als `<li><a href="#…">` stehen (Test `apps/web/src/lib/bedienungsanleitung.spec.ts`).

Run: `cd apps/web && npx vitest run src/lib/bedienungsanleitung.spec.ts` → PASS.

- [ ] **Step 3: `ARCHITECTURE.md`** Permissions-Block (um Zeile 315-335) um `player:delete` und `organization:delete` ergänzen, mit einem Satz: `organization:delete` nur OWNER.

- [ ] **Step 4: Volle Suite**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e
```

Alles grün. Rote Fälle nicht übergehen (bekannte Flakes siehe Memory: E2E-Kontention, Shared-DB-Race in `prune-outbox` – Einzellauf zur Bestätigung).

- [ ] **Step 5: Commit, Push, PR 1**

```bash
git add apps/web/tests/player-management.spec.ts apps/web/public/bedienungsanleitung.html ARCHITECTURE.md
git commit -m "test(web): Spielerverwaltung Ende-zu-Ende; Doku nachgezogen"
git push -u origin feature/bearbeiten-loeschen
```

PR nach `develop` mit den Abschnitten aus AGENTS.md §23 (Problem, Lösung, Architektur, DB-Migrationen: keine, Tests, Security, Screenshots). Nach grüner CI mergen (Merge-Commit), danach `git merge origin/develop` in den Branch.

---

## PR 2 – Mitglieder

### Task 5: API – Mitglied entfernen

**Files:**
- Modify: `apps/api/src/organizations/organizations.repository.ts` (neue Methode `removeMembership` nach `updateMembership`, ca. Zeile 1230)
- Modify: `apps/api/src/organizations/organizations.service.ts` (neue Methode `removeMember` nach `updateMember`)
- Modify: `apps/api/src/organizations/organizations.controller.ts` (neue Route nach `PATCH :organizationId/members/:userId`, ca. Zeile 200)
- Create: `apps/api/src/organizations/member-removal.integration.spec.ts`

**Interfaces:**
- Produces: `DELETE /api/v1/organizations/:organizationId/members/:userId` → 204; 403 `SELF_MEMBERSHIP_CHANGE_FORBIDDEN`; 403 `OWNER_CHANGE_REQUIRES_OWNER`; 409 `LAST_OWNER_PROTECTED`; 404; 403 ohne `organization:manage_members`.
- Repository: `removeMembership(input: { organizationId; targetUserId; actorUserId; audit }): Promise<{ outcome: "removed" } | { outcome: "not-found" } | { outcome: "actor-not-active" } | { outcome: "owner-change-requires-owner" } | { outcome: "last-owner" }>`.

- [ ] **Step 1: Failing Integrationstest**

Aufbau wie `apps/api/src/organizations/memberships.integration.spec.ts` (dort lesen: Instanziierung, Anlegen von Benutzern/Mitgliedschaften, Aufräumen). Fälle:
- OWNER entfernt ein MEMBER mit verknüpftem Spieler: Mitgliedschaft weg, `players.user_id` NULL, Audit `MEMBER_REMOVED` (`oldValue` enthält `role`, `status`, `email`) und `PLAYER_UNLINKED`, Benutzerzeile existiert weiter.
- Entfernen der eigenen Mitgliedschaft → 403 `SELF_MEMBERSHIP_CHANGE_FORBIDDEN`.
- ADMIN entfernt OWNER → 403 `OWNER_CHANGE_REQUIRES_OWNER`.
- Letzter aktiver OWNER: Über den Dienst nicht erreichbar. Ein OWNER-Ziel entfernt nur ein aktiver OWNER, der selbst nicht das Ziel ist, also bleibt immer mindestens einer. Die Prüfung `last-owner` wird trotzdem implementiert (Verteidigung in der Tiefe wie in `updateMembership`), mit einem Kommentar, warum der Zweig heute unerreichbar ist. Kein Test dafür.
- TOURNAMENT_DIRECTOR ohne `organization:manage_members` → 403.
- Unbekannter Benutzer → 404. Mitglied einer fremden Organisation → 404.
- Nach dem Entfernen neue Einladung an dieselbe E-Mail möglich (`organizationsService.createInvitation` o. ä. – Methodennamen im Service nachsehen) und Annahme erzeugt wieder eine Mitgliedschaft.

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/organizations/member-removal.integration.spec.ts` → FAIL.

- [ ] **Step 2: Repository `removeMembership`**

Nach dem Muster von `updateMembership` (`organizations.repository.ts:1060-1230`): Akteur sperren (`for("update", { of: memberships })`), aktiv und gültige Rolle prüfen → sonst `actor-not-active`; Ziel mit Join auf `users` sperren → sonst `not-found`; `current.role === "OWNER" && actorRole !== "OWNER"` → `owner-change-requires-owner`; aktiver OWNER ohne weiteren aktiven OWNER → `last-owner`. Dann:

```ts
      const [linked] = await transaction
        .update(players)
        .set({ userId: null, updatedAt: new Date() })
        .where(and(eq(players.organizationId, input.organizationId), eq(players.userId, input.targetUserId)))
        .returning({ id: players.id });

      if (linked !== undefined) {
        await transaction.insert(auditEvents).values({
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: "PLAYER_UNLINKED",
          entityType: "Player",
          entityId: linked.id,
          oldValue: { userId: input.targetUserId },
          newValue: { userId: null, reason: "MEMBER_REMOVED" },
          ip: input.audit.ip,
          userAgent: input.audit.userAgent,
          correlationId: input.audit.correlationId,
        });
      }

      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: "MEMBER_REMOVED",
        entityType: "Membership",
        entityId: current.id,
        oldValue: { userId: input.targetUserId, email: current.email, role: current.role, status: current.status },
        newValue: null,
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });

      await transaction
        .delete(memberships)
        .where(and(eq(memberships.organizationId, input.organizationId), eq(memberships.userId, input.targetUserId)));

      return { outcome: "removed" };
```

Prüfen, ob der bestehende Code `reason: "MANUAL"` als geschlossene Menge irgendwo validiert (`grep -rn "reason: \"MANUAL\"\|\"MANUAL\"" apps packages --include=*.ts`); falls ja, `"MEMBER_REMOVED"` dort ergänzen.

- [ ] **Step 3: Service `removeMember`**

`requirePermission(... "organization:manage_members")`; `targetUserId === auth.user.id` → `ForbiddenException({ code: "SELF_MEMBERSHIP_CHANGE_FORBIDDEN", message: "Your own membership is changed by another administrator." })`; `switch` auf das Ergebnis mit denselben Exceptions/Texten wie `updateMember` (`organizations.service.ts:420-450`), `last-owner` → `ConflictException({ code: "LAST_OWNER_PROTECTED", message: "The last active owner cannot be removed." })`; `removed` → `return`.

- [ ] **Step 4: Controller**

```ts
  @Delete(":organizationId/members/:userId")
  @HttpCode(204)
  public async removeMember(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("userId", ParseUUIDPipe) userId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.organizationsService.removeMember({
      organizationId,
      targetUserId: userId,
      auth,
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
    });
  }
```

Prüfen, ob `userId` in den bestehenden Member-Routen mit `ParseUUIDPipe` geparst wird (Better-Auth-IDs sind evtl. keine UUIDs) – gleiches Muster wie `PATCH :organizationId/members/:userId` verwenden.

- [ ] **Step 5: Tests grün** – neue Datei, `memberships.integration.spec.ts`, `tenant-isolation-matrix.integration.spec.ts`, `route-inventory.integration.spec.ts`; `typecheck`, `lint` für `@darts-platform/api`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/organizations
git commit -m "feat(api): Mitglied aus der Organisation entfernen"
```

### Task 6: Web – Mitglied entfernen, E2E, Doku, PR 2

**Files:**
- Modify: `apps/web/src/lib/membership-actions.ts` (+ zugehöriger Spec, falls vorhanden: `ls apps/web/src/lib | grep membership`)
- Modify: `apps/web/src/components/organization/members-route.tsx`
- Modify: `apps/web/tests/members.spec.ts`
- Modify: `apps/web/public/bedienungsanleitung.html`, `ARCHITECTURE.md` (Mitgliederabschnitt um Zeile 360-385)

**Interfaces:**
- Consumes: `ConfirmDialog` (Task 3), `DELETE …/members/:userId` (Task 5).
- Produces: `MembershipRowActions.canRemove: boolean`.

- [ ] **Step 1: `membershipRowActions` um `canRemove` erweitern (TDD)**

Regeln: `organization:manage_members` fehlt → false; eigene Zeile → false; Ziel OWNER und Akteur nicht OWNER → false; Ziel aktiver OWNER und `activeOwnerCount <= 1` → false; sonst true. Achtung: heute prüft die Funktion zuerst `organization:manage_roles` und gibt früh `blocked(...)` zurück; `canRemove` hängt an `manage_members`. Heute haben beide Permissions dieselben Rollen (OWNER, ADMIN); die Funktion so umbauen, dass `canRemove` unabhängig berechnet wird, und `blocked` um `canRemove: false` ergänzen. Tests in der bestehenden Spec-Datei (oder neu `membership-actions.spec.ts`) für alle fünf Regeln.

- [ ] **Step 2: `members-route.tsx`**

Button «Entfernen» (`variant="outline"`) je Zeile, wenn `canRemove`. `ConfirmDialog`: Titel «Mitglied entfernen», Text «{Name} verliert den Zugang zu dieser Organisation. Eine Spieler-Verknüpfung wird gelöst. Das Konto bleibt bestehen, und du kannst die Person später wieder einladen. Wenn du den Zugang nur vorübergehend sperren willst, nutze «Zugang deaktivieren».», Button «Entfernen». Mutation `DELETE /organizations/${organization.id}/members/${member.userId}`, `schema: z.undefined()`, bei Erfolg `invalidateMembers` (vorhanden) und Dialog schliessen; Fehler im Dialog über `error`.

- [ ] **Step 3: E2E in `members.spec.ts`**

Bestehenden Fall lesen; neuen Fall ergänzen: Owner lädt ein Mitglied ein, es nimmt an (bestehende Helfer `registration-invitation.ts`/`sign-up.ts`), Owner entfernt es → Zeile verschwindet; erneute Einladung derselben Adresse gelingt.

Run: `npx dotenv -e .env -- pnpm --filter @darts-platform/web test:e2e members.spec.ts` → PASS.

- [ ] **Step 4: Doku** – Bedienungsanleitung (Mitglieder: Entfernen vs. Deaktivieren), `ARCHITECTURE.md` Mitgliederabschnitt (neue Route, Permission `organization:manage_members`, Audit `MEMBER_REMOVED`). Manual-Spec laufen lassen.

- [ ] **Step 5: Volle Suite, Commit, Push, PR 2**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e
git add apps/web ARCHITECTURE.md
git commit -m "feat(web): Mitglied entfernen mit Bestaetigung"
git push
```

PR nach `develop`, nach grüner CI mergen, danach `git merge origin/develop`.

---

## PR 3 – Organisation

### Task 7: API – Organisation löschen

**Files:**
- Modify: `packages/schemas/src/organization.ts` (`deleteOrganizationSchema`, Typ `DeleteOrganizationInput`; Export über `packages/schemas/src/index.ts` prüfen)
- Modify: `apps/api/src/organizations/organizations.repository.ts` (neue Methode `deleteOrganization` nach `update`, ca. Zeile 240)
- Modify: `apps/api/src/organizations/organizations.service.ts`
- Modify: `apps/api/src/organizations/organizations.controller.ts` (nach `@Patch(":organizationId")`, ca. Zeile 112)
- Modify: `apps/api/src/security/tenant-isolation-matrix.integration.spec.ts` (`bodies`)
- Create: `apps/api/src/organizations/organization-deletion.integration.spec.ts`

**Interfaces:**
- Consumes: Permission `"organization:delete"` (Task 1).
- Produces: `DELETE /api/v1/organizations/:organizationId` mit Body `{ confirmName: string }` → 204; 400 `VALIDATION_ERROR` bei fehlendem Body; 400 `ORGANIZATION_NAME_MISMATCH`; 403 für ADMIN und darunter; 404.
- Schema:

```ts
/** Bestaetigung beim Loeschen: der Name muss eingetippt werden (Spec 2026-09-24). */
export const deleteOrganizationSchema = z.object({
  confirmName: z.string().trim().min(1).max(255),
});
export type DeleteOrganizationInput = z.infer<typeof deleteOrganizationSchema>;
```

- [ ] **Step 1: Failing Integrationstest mit vollständig gefüllter Organisation**

In `organization-deletion.integration.spec.ts` zwei Organisationen (A wird gelöscht, B bleibt). A über die bestehenden **Services** füllen, damit alle Tabellen realistisch belegt sind – die Fixture in `tenant-isolation-matrix.integration.spec.ts` (Abschnitt «Echte Ressourcen», ab ca. Zeile 250) legt bereits Spieler, Board, Match, Turnier, Team, Wettbewerb und Begegnung über die API an; diesen Aufbau über `createApiHarness`/`collectRoutes` (siehe `apps/api/src/testing/api-harness.ts`) oder die Services nachbilden. Zusätzlich: eine Aufnahme im Match (`POST …/visits`), einen Avatar, eine offene Einladung (erzeugt `email_deliveries`), eine Begegnung mit Aufstellung. B bekommt mindestens einen Spieler und ein Match.

Fälle:
- OWNER löscht A mit korrektem Namen: danach für **jede** Tabelle mit `organization_id` 0 Zeilen für A (Liste per SQL aus `information_schema.columns where column_name = 'organization_id' and table_name <> 'audit_events'` ermitteln und je Tabelle `select count(*) … where organization_id = $1` prüfen). B unverändert (Zählung vorher/nachher). Audit `ORGANIZATION_DELETED` existiert mit `organizationId: null`, `entityId: A`, `oldValue.name`/`slug` gesetzt. Benutzerkonten existieren weiter.
- Name mit Leerzeichen aussen (`"  Verein A  "`) → Erfolg (trim). Falscher Name / andere Gross-/Kleinschreibung → 400 `ORGANIZATION_NAME_MISMATCH`, nichts gelöscht.
- ADMIN → 403. Mitglied von B auf A → 403. Unbekannte Id → 403 oder 404 (je nach `requirePermission`-Verhalten; bestehende Tests zeigen, welches).

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/organizations/organization-deletion.integration.spec.ts` → FAIL.

- [ ] **Step 2: Repository `deleteOrganization`**

```ts
  /**
   * Loescht eine Organisation mit allen Daten (Spec 2026-09-24). Der
   * Audit-Eintrag traegt die Identitaet selbst, weil
   * `audit_events.organization_id` beim Loeschen auf NULL faellt.
   */
  public async deleteOrganization(input: {
    readonly organizationId: string;
    readonly actorUserId: string;
    readonly confirmName: string;
    readonly audit: AuditContext;
  }): Promise<"deleted" | "not-found" | "actor-not-owner" | "name-mismatch"> {
    return this.databaseService.database.transaction(async (transaction) => {
      const [current] = await transaction
        .select()
        .from(organizations)
        .where(eq(organizations.id, input.organizationId))
        .limit(1)
        .for("update");
      if (current === undefined) return "not-found";

      const [actor] = await transaction
        .select({ role: memberships.role, status: memberships.status })
        .from(memberships)
        .where(and(eq(memberships.organizationId, input.organizationId), eq(memberships.userId, input.actorUserId)))
        .limit(1)
        .for("update");
      if (actor === undefined || actor.status !== "ACTIVE" || actor.role !== "OWNER") return "actor-not-owner";

      if (current.name !== input.confirmName) return "name-mismatch";

      const [memberCount] = await transaction.select({ value: count() }).from(memberships).where(eq(memberships.organizationId, input.organizationId));
      const [playerCount] = await transaction.select({ value: count() }).from(players).where(eq(players.organizationId, input.organizationId));
      const [tournamentCount] = await transaction.select({ value: count() }).from(tournaments).where(eq(tournaments.organizationId, input.organizationId));

      await transaction.insert(auditEvents).values({
        organizationId: null,
        actorUserId: input.actorUserId,
        action: "ORGANIZATION_DELETED",
        entityType: "Organization",
        entityId: current.id,
        oldValue: {
          id: current.id, name: current.name, slug: current.slug, timezone: current.timezone, locale: current.locale,
          members: memberCount?.value ?? 0, players: playerCount?.value ?? 0, tournaments: tournamentCount?.value ?? 0,
        },
        newValue: null,
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });

      await transaction.delete(organizations).where(eq(organizations.id, input.organizationId));
      return "deleted";
    });
  }
```

**Kaskade:** Zuerst mit dem einfachen `delete(organizations)` testen – die bestehenden Integrationstests räumen Organisationen mit Turnieren und Begegnungen bereits so ab (`tournaments.integration.spec.ts:160`, `encounters.integration.spec.ts:414`). Läuft der Test aus Step 1 damit grün, bleibt es dabei, und ein Kommentar nennt den Test als Beleg. Scheitert er an einem RESTRICT-Schlüssel (`23503`), vor dem letzten `delete` die blockierenden Tabellen in der Reihenfolge der Fehlermeldungen explizit löschen (jeweils `where organization_id = $1`) und im Kommentar begründen. Die Spec erlaubt beides; der Test entscheidet.

`audit_events.organization_id` muss `null` zulassen (Schema `schema.ts:320` prüfen; es ist `SET NULL`, also nullable). `count` aus `drizzle-orm` importieren; `tournaments` aus `@darts-platform/database`.

- [ ] **Step 3: Service `deleteOrganization`**

```ts
  public async deleteOrganization(input: {
    readonly organizationId: string;
    readonly data: DeleteOrganizationInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<void> {
    await this.organizationAccessService.requirePermission({
      organizationId: input.organizationId,
      userId: input.auth.user.id,
      permission: "organization:delete",
    });
    const outcome = await this.organizationsRepository.deleteOrganization({
      organizationId: input.organizationId,
      actorUserId: input.auth.user.id,
      confirmName: input.data.confirmName,
      audit: input.audit,
    });
    switch (outcome) {
      case "not-found":
        throw new NotFoundException("This organization does not exist.");
      case "actor-not-owner":
        throw new ForbiddenException("You do not have permission to access this organization resource.");
      case "name-mismatch":
        throw new BadRequestException({
          code: "ORGANIZATION_NAME_MISMATCH",
          message: "The confirmation does not match the organization name.",
        });
      case "deleted":
        return;
    }
  }
```

Prüfen, ob `ApiExceptionFilter` den `code` aus einer `BadRequestException({ code, message })` durchreicht (andere Stellen im Code mit eigenem 400-Code suchen: `grep -rn "BadRequestException({" apps/api/src | head`).

- [ ] **Step 4: Controller**

```ts
  @Delete(":organizationId")
  @HttpCode(204)
  public async delete(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const data: DeleteOrganizationInput = parseBody(deleteOrganizationSchema, body);
    await this.organizationsService.deleteOrganization({
      organizationId,
      data,
      auth,
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
    });
  }
```

Fastify akzeptiert einen JSON-Body auf `DELETE`. Im Integrationstest einen echten HTTP-Request über den Harness (`app.inject({ method: "DELETE", url, payload: { confirmName } })`) mit abdecken, nicht nur den Service.

- [ ] **Step 5: Tenant-Matrix**

In `bodies` ergänzen: `"DELETE /api/v1/organizations/:organizationId": { confirmName: "Verein B" },`. Im zweiten Durchgang läuft Owner A gegen Organisation B – Erwartung 403, Schnappschuss unverändert. Darauf achten, dass die Route **nie** mit Owner B als Akteur gegen B läuft (die Fixture nutzt `currentAuth = ownerBAuth` nur zum Anlegen).

- [ ] **Step 6: Tests grün** – neue Datei, Matrix, Route-Inventar, `organizations.integration.spec.ts`; `pnpm --filter @darts-platform/schemas build`, `typecheck`, `lint`.

- [ ] **Step 7: Commit**

```bash
git add packages/schemas apps/api/src
git commit -m "feat(api): Organisation mit Namensbestaetigung endgueltig loeschen"
```

### Task 8: Web – Organisationsseite, E2E, ADR, PR 3

**Files:**
- Create: `apps/web/src/app/organisation/page.tsx`
- Create: `apps/web/src/components/organization/organization-settings-route.tsx`
- Create: `apps/web/src/components/organization/organization-settings-route.render.spec.tsx`
- Modify: `apps/web/src/components/tenant-dashboard.tsx:445-455`
- Modify: `apps/web/src/lib/api-client.ts` (`ORGANIZATION_NAME_MISMATCH`)
- Create: `apps/web/tests/organization-settings.spec.ts`
- Create: `docs/adr/0018-loeschkonzept.md`
- Modify: `apps/web/public/bedienungsanleitung.html`, `ARCHITECTURE.md`, `ROADMAP.md` (Phase-7-Status: «Settings» teilweise)

**Interfaces:**
- Consumes: `PATCH /organizations/:id` (Bestand, Antwort `organizationSummarySchema`), `DELETE /organizations/:id` (Task 7), `ConfirmDialog` (Task 3), `WorkspaceShell` (wie `roster-route.tsx`).

- [ ] **Step 1: Seite und Route**

`page.tsx` nach dem Muster von `apps/web/src/app/mitglieder/page.tsx` (liest `searchParams.organisation`, rendert `OrganizationSettingsRoute`). `OrganizationSettingsRoute` nutzt `WorkspaceShell` (Titel «Organisation», Lead «Stammdaten der Organisation pflegen.») und rendert:

1. **Stammdaten-Formular** (nur mit `organization:update`, sonst Werte nur lesend): React Hook Form + `zodResolver(updateOrganizationSchema)`, Felder Name, Zeitzone (Textfeld, Vorgabe `Europe/Zurich`), Sprache (Textfeld, Vorgabe `de-CH`); Slug nur angezeigt mit Hinweis «Der Kurzname steht in Links und Einladungen und lässt sich nicht ändern.». Mutation `PATCH`, `schema: organizationSummarySchema`, Erfolg: `invalidateQueries({ queryKey: ["organizations"] })` (den tatsächlich verwendeten Key der Organisationsliste nachsehen: `grep -rn "queryKey: \[\"organizations\"" apps/web/src`), Erfolgsmeldung «Gespeichert.» mit `role="status"`.
2. **Gefahrenbereich «Organisation löschen»** (nur mit `organization:delete`): Text «Löscht die Organisation mit allen Spielern, Turnieren, Matches, Ligen, Statistiken und Mitgliedschaften. Das lässt sich nicht rückgängig machen.», Button «Organisation löschen» öffnet `ConfirmDialog` mit Eingabefeld (Label «Zur Bestätigung den Namen „{name}" eintippen»), `confirmDisabled` solange `input.trim() !== organization.name`. Mutation `DELETE` mit Body `{ confirmName: input }`, `schema: z.undefined()`. Erfolg: `queryClient.removeQueries({ queryKey: [...] })` für die Organisation, `invalidateQueries` der Organisationsliste, `router.push("/")`. Die gemerkte Auswahl fällt über `resolveOrganization` automatisch auf eine andere Organisation zurück (`lib/organization-selection.ts`), ein explizites Zurücksetzen ist nicht nötig – im Code kommentieren.

- [ ] **Step 2: Dashboard-Link** in `tenant-dashboard.tsx` nach dem Mitglieder-Link:

```tsx
        {hasOrganizationPermission(organization.role, "organization:update") ? (
          <OverviewLink
            href={`/organisation${organisationParam}`}
            title="Organisation"
            description="Name, Zeitzone, Sprache und Löschen"
          />
        ) : null}
```

- [ ] **Step 3: Render-Tests** – Formular nur mit `organization:update`; Löschbereich nur für OWNER (ADMIN sieht ihn nicht); Löschen-Button im Dialog erst aktiv bei exakt passendem Namen; 400 `ORGANIZATION_NAME_MISMATCH` wird angezeigt. `api-client.ts`: `ORGANIZATION_NAME_MISMATCH: "Der eingegebene Name stimmt nicht mit dem Namen der Organisation überein."`

Run: `cd apps/web && npx vitest run src/components/organization` → PASS.

- [ ] **Step 4: E2E `organization-settings.spec.ts`** – Owner einer frischen Organisation: Dashboard → «Organisation» → Name ändern → gespeichert und im Dashboard sichtbar → «Organisation löschen» → falscher Name hält den Button gesperrt → richtiger Name → Weiterleitung zur Startseite, Organisation nicht mehr in der Auswahl. Organisation im Test frisch anlegen (Fixture), nie eine geteilte Testorganisation löschen.

Run: `npx dotenv -e .env -- pnpm --filter @darts-platform/web test:e2e organization-settings.spec.ts` → PASS.

- [ ] **Step 5: ADR 0018** `docs/adr/0018-loeschkonzept.md` im Format der bestehenden ADRs (`docs/adr/0017-ausgehende-emails.md` lesen): Kontext (Historie, RESTRICT), Entscheid (Archiv als Normalfall, Löschen ohne Historie, Mitglied entfernen, Organisation nur OWNER mit Namensbestätigung, Audit ausserhalb des Mandanten), Konsequenzen (irreversibel, Restore nur über PITR; Personendaten in Audit-Einträgen bleiben – offener Punkt für Legal/Compliance), verworfene Alternativen (Anonymisieren, Löschfrist).

- [ ] **Step 6: Doku** – Bedienungsanleitung (Organisationsseite, Löschen), `ARCHITECTURE.md` (Route `DELETE /organizations/:id`, `organization:delete`), `ROADMAP.md` Phase 7 Status: «Settings» als teilweise umgesetzt (Name, Zeitzone, Sprache, Löschen). Manual-Spec laufen lassen.

- [ ] **Step 7: Volle Suite, Commit, Push, PR 3**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e
git add apps/web docs/adr ARCHITECTURE.md ROADMAP.md
git commit -m "feat(web): Organisationsseite mit Stammdaten und Loeschen"
git push
```

PR nach `develop`, nach grüner CI mergen. Staging deployt `develop` automatisch; danach Staging-Smoke: `GET https://api-staging.dartbase.ch/api/v1/health` → `ok`, `DELETE /api/v1/organizations/<zufällige uuid>` ohne Session → 401.
