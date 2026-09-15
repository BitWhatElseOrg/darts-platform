# Spieler-Konto-Verknüpfung — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Konto und Spielerprofil werden optional 1:1 je Organisation verknüpft; Spieler- und Mitgliederliste bekommen Suche, Filter und eine Team-Spalte.

**Architecture:** Nullable `players.user_id` mit partiellem Unique-Index als Wahrheit. Die Verknüpfung entsteht im Einladungspfad (`organization_invitations.player_id`, gesetzt beim Annehmen in derselben Transaktion) oder manuell über eine eigene schmale Ressource unter `organization:manage_members`. Sie gewährt keine Berechtigung, sondern beantwortet nur „welcher Spieler bin ich" — damit braucht die Selbstsicht weder neuen Endpunkt noch neue Permission. Suche und Filter laufen clientseitig auf den ohnehin vollständig geladenen Listen; die Prädikate sind reine Funktionen ausserhalb der Komponenten.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL, NestJS/Fastify, Zod, Next.js/React, TanStack Query, React Hook Form, Vitest, Testcontainers.

**Spec:** `docs/superpowers/specs/2026-09-15-spieler-konto-verknuepfung-design.md`
**ADR:** `docs/adr/0015-spieler-konto-verknuepfung.md`

## Global Constraints

- Jede tenant-bezogene Abfrage filtert explizit nach `organization_id` (AGENTS.md §14). Kein Endpunkt leitet die Organisation aus Clientdaten ab.
- Jede Mutation wird serverseitig autorisiert; UI-Sichtbarkeit ist Bedienhilfe, nie Sicherheitsgrenze (AGENTS.md §13).
- Schreibpfade sind transaktional, inklusive Audit-Eintrag in derselben Transaktion (AGENTS.md §10).
- Sperrreihenfolge bleibt Organisation → Mitgliedschaft → Spieler beziehungsweise Einladung → Mitgliedschaft → Spieler. Keine neue Kreuzung.
- Kein `any`. `strict: true`.
- Fehlerformat `{ error: { code, message, correlationId } }`; neue Codes: `PLAYER_ALREADY_LINKED`, `PLAYER_NOT_ASSIGNABLE`.
- Migrationen sind versioniert und werden nach dem Deployment nicht umgeschrieben (AGENTS.md §21). Nächste Nummer: `0030`.
- Deutschsprachige UI-Texte in Schweizer Rechtschreibung, kein ß.
- Abschluss-Gates: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

---

### Task 1: Datenmodell und Migration

**Files:**
- Modify: `packages/database/src/schema.ts` (`players`, `organizationInvitations`)
- Create: `packages/database/drizzle/0030_player_account_link.sql`
- Modify: `packages/database/drizzle/meta/_journal.json`
- Test: `packages/database/src/player-account-link.integration.spec.ts`

**Interfaces:**
- Produces: `players.userId` (`uuid | null`), `organizationInvitations.playerId` (`uuid | null`), Unique-Index `players_organization_user_unique`.

- [ ] **Step 1: Migration schreiben**

```sql
ALTER TABLE "players" ADD COLUMN "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "players_organization_user_unique" ON "players" USING btree ("organization_id","user_id") WHERE "user_id" is not null;--> statement-breakpoint
CREATE INDEX "players_user_id_idx" ON "players" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD COLUMN "player_id" uuid REFERENCES "players"("id") ON DELETE SET NULL;
```

Journal-Eintrag mit `"idx": 30`, `"tag": "0030_player_account_link"`, `"version": "7"`, `"breakpoints": true` ergänzen.

- [ ] **Step 2: Drizzle-Schema angleichen**

In `players`: `userId: uuid("user_id").references(() => users.id, { onDelete: "set null" })` plus in der Indexliste `uniqueIndex("players_organization_user_unique").on(table.organizationId, table.userId).where(sql\`${table.userId} is not null\`)` und `index("players_user_id_idx").on(table.userId)`.

In `organizationInvitations`: `playerId: uuid("player_id").references(() => players.id, { onDelete: "set null" })`. Die Tabelle steht im File **vor** `players` — Drizzle löst die Referenz über den Thunk auf, also ist keine Umsortierung nötig.

- [ ] **Step 3: Integrationstest schreiben (muss zuerst scheitern)**

Fälle: zwei Spieler derselben Organisation mit demselben `user_id` verletzen den Unique-Index (23505); dasselbe `user_id` in zwei verschiedenen Organisationen ist erlaubt; beliebig viele Spieler mit `user_id = null` sind erlaubt; `DELETE` eines Users setzt `players.user_id` auf null und lässt die Spielerzeile stehen.

- [ ] **Step 4: Tests ausführen**

Run: `cd apps/api && npx dotenv -e .env.test -- vitest run ../../packages/database/src/player-account-link.integration.spec.ts` (Muster aus `[[api-single-test-file]]`; `pnpm --filter … test --` filtert nicht).
Expected: grün.

- [ ] **Step 5: Commit**

```bash
git add packages/database && git commit -m "feat(database): Verknuepfung von Konto und Spielerprofil im Schema"
```

---

### Task 2: Schemas und Vertragsfläche

**Files:**
- Modify: `packages/schemas/src/player.ts`
- Modify: `packages/schemas/src/organization.ts`
- Test: `packages/schemas/src/organization.spec.ts`

**Interfaces:**
- Produces: `playerSchema.hasAccount: boolean`; `organizationSummarySchema.playerId: string | null`; `organizationMemberSchema.player: { id: string; displayName: string } | null`; `createInvitationSchema.playerId?: string`; `linkMemberPlayerSchema = z.object({ playerId: z.uuid() })` samt Typ `LinkMemberPlayerInput`.

- [ ] **Step 1: Schemas erweitern**

`playerSchema` bekommt `hasAccount: z.boolean()` — bewusst kein `userId` und keine E-Mail (Spec E5). `createPlayerSchema` und `updatePlayerSchema` bleiben unverändert: die Verknüpfung wird nicht über den Spielerpfad geschrieben.

- [ ] **Step 2: Test für die Schreibgrenze**

Test: `createInvitationSchema` akzeptiert eine UUID als `playerId`, weist einen Nicht-UUID-String zurück und bleibt ohne `playerId` gültig. `linkMemberPlayerSchema` weist ein leeres Objekt zurück.

- [ ] **Step 3: Tests ausführen und committen**

Run: `pnpm --filter @darts-platform/schemas test`

---

### Task 3: Lesemodelle in der API

**Files:**
- Modify: `apps/api/src/players/players.repository.ts` (`list`, `get`, `create`, `update`, `archive` — überall `hasAccount` projizieren)
- Modify: `apps/api/src/organizations/organizations.repository.ts` (`listForUser`, `listMembers`)
- Test: `apps/api/src/players/tenant-isolation.integration.spec.ts`, `apps/api/src/organizations/memberships.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`players.userId`), Task 2 (Schemas).
- Produces: `PlayerResponse.hasAccount`, `OrganizationSummary.playerId`, `OrganizationMember.player`.

- [ ] **Step 1: Projektionen umstellen**

`players`-Abfragen selektieren die Spalten explizit statt `select()` und ergänzen `hasAccount: sql<boolean>\`${players.userId} is not null\``. `listForUser` bekommt einen `leftJoin` auf `players` über `(players.organizationId, players.userId)` und liefert `playerId`. `listMembers` bekommt denselben `leftJoin` und liefert `player` als Objekt oder null.

- [ ] **Step 2: Tests ergänzen (zuerst rot)**

Fälle: ein Spieler ohne Konto liefert `hasAccount: false`, mit Konto `true`; die Spielerliste enthält an keiner Stelle eine E-Mail-Adresse des Kontos; `organizationSummary.playerId` zeigt den eigenen Spieler und bleibt null, wenn die verknüpfte Zeile zu einer anderen Organisation gehört; `listMembers` zeigt `player: null` für unverknüpfte Mitglieder.

- [ ] **Step 3: Tests ausführen und committen**

---

### Task 4: Einladung mit Spielerbezug

**Files:**
- Modify: `apps/api/src/organizations/organizations.repository.ts` (`createInvitation`, `acceptInvitation`)
- Modify: `apps/api/src/organizations/organizations.service.ts` (`invite`, `acceptInvitation`)
- Test: `apps/api/src/organizations/memberships.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1, Task 2, Task 3.
- Produces: `AcceptInvitationResult` um `{ outcome: "player-already-linked" }` und `{ outcome: "player-not-assignable" }` erweitert.

- [ ] **Step 1: `createInvitation` prüft den Spieler**

Innerhalb der bestehenden Transaktion, vor dem `INSERT`: Spieler mit `id = playerId` **und** `organizationId = input.organizationId` lesen. Fehlt er, ist er nicht `ACTIVE` oder hat er bereits ein `user_id`, wird `player-not-assignable` zurückgegeben; der Service wirft daraus 422 `PLAYER_NOT_ASSIGNABLE`. Der Audit-Eintrag `MEMBER_INVITED` bekommt `playerId` in `newValue`.

- [ ] **Step 2: `acceptInvitation` verknüpft unter der Sperre**

Nach der Mitgliedschaft, vor dem Audit-Eintrag. Reihenfolge Einladung → Mitgliedschaft → Spieler bleibt. Der Spieler wird `for update` gelesen und nur beschrieben, wenn `user_id is null`. Die fünf Fälle aus der Spec:

| Lage | Rückgabe |
|---|---|
| `player_id` null | wie bisher `accepted` |
| Spielerzeile fehlt | `accepted`, ohne Verknüpfung |
| `user_id` = dieses Konto | `accepted`, idempotent |
| `user_id` = anderes Konto | `player-already-linked` (Transaktion rollt zurück, Einladung bleibt `PENDING`) |
| Spieler `INACTIVE` | `player-not-assignable` (Rollback) |

Zusätzlich: ist das annehmende Konto in dieser Organisation bereits mit einem **anderen** Spieler verknüpft, ebenfalls `player-already-linked`. Der Unique-Index ist das Sicherheitsnetz; ein 23505 aus dem `UPDATE` wird im Service ebenfalls zu 409 `PLAYER_ALREADY_LINKED` statt zu 500.

- [ ] **Step 3: Audit**

`MEMBER_INVITATION_ACCEPTED` bekommt `playerId` in `newValue`; zusätzlich ein eigener `PLAYER_LINKED`-Eintrag mit `entityType: "Player"`, damit die Spielerhistorie unabhängig vom Einladungspfad lesbar bleibt.

- [ ] **Step 4: Tests schreiben (zuerst rot)**

Je ein Integrationstest pro Tabellenzeile oben, plus: Einladung mit organisationsfremder `playerId` wird beim Erstellen mit 422 abgelehnt; nach einem 409 ist die Einladung noch `PENDING` und derselbe Claim-Token gilt weiter; nach erfolgreicher Annahme trägt `players.user_id` das Konto und `organizationSummary.playerId` den Spieler.

- [ ] **Step 5: Tests ausführen und committen**

---

### Task 5: Manuelle Zuordnung

**Files:**
- Modify: `apps/api/src/organizations/organizations.controller.ts`
- Modify: `apps/api/src/organizations/organizations.service.ts`
- Modify: `apps/api/src/organizations/organizations.repository.ts`
- Test: `apps/api/src/organizations/memberships.integration.spec.ts`

**Interfaces:**
- Consumes: Task 2 (`linkMemberPlayerSchema`), Task 3 (`OrganizationMember.player`).
- Produces: `PUT /organizations/:organizationId/members/:userId/player` → `OrganizationMember`; `DELETE …/player` → 204.

- [ ] **Step 1: Repository**

`linkMemberPlayer` und `unlinkMemberPlayer`, beide transaktional in der Reihenfolge Organisation (`for update`) → Mitgliedschaft → Spieler. `linkMemberPlayer` verlangt eine bestehende Mitgliedschaft in dieser Organisation (jeder Status) und einen aktiven, freien Spieler derselben Organisation; eine bestehende Zuordnung **desselben** Kontos auf einen anderen Spieler wird in derselben Transaktion gelöst und neu gesetzt. Ergebnisvarianten: `linked`, `membership-not-found`, `player-not-assignable`, `player-already-linked`. `unlinkMemberPlayer` ist idempotent.

- [ ] **Step 2: Service und Controller**

Beide Endpunkte verlangen `organization:manage_members` über `organizationAccessService.requirePermission`. Ergebnisvarianten werden auf 404 / 422 `PLAYER_NOT_ASSIGNABLE` / 409 `PLAYER_ALREADY_LINKED` abgebildet; `DELETE` antwortet mit `@HttpCode(204)`.

- [ ] **Step 3: Audit**

`PLAYER_LINKED` / `PLAYER_UNLINKED`, `entityType: "Player"`, `entityId` der Spieler, `oldValue`/`newValue` mit `userId`, in derselben Transaktion.

- [ ] **Step 4: Tests schreiben (zuerst rot)**

Fälle: ein `SCORER` bekommt 403; ein Admin einer fremden Organisation bekommt 404 statt 403 (keine Existenzauskunft); Zuordnen, erneutes Zuordnen desselben Paars (idempotent), Umhängen auf einen anderen Spieler, Zuordnen eines bereits vergebenen Spielers (409), eines archivierten Spielers (422), eines organisationsfremden Spielers (404/422); `DELETE` ohne bestehende Zuordnung liefert 204; jede erfolgreiche Mutation erzeugt genau einen Audit-Eintrag.

- [ ] **Step 5: Tests ausführen und committen**

---

### Task 6: Filterfunktionen im Web

**Files:**
- Create: `apps/web/src/lib/list-filter.ts`
- Create: `apps/web/src/lib/list-filter.spec.ts`

**Interfaces:**
- Produces:
  - `normalizeForSearch(value: string): string`
  - `matchesSearch(haystack: readonly (string | null | undefined)[], needle: string): boolean`
  - `type PlayerFilter = { readonly search: string; readonly status: "ALL" | "ACTIVE" | "INACTIVE"; readonly teamId: "ALL" | "NONE" | string; readonly account: "ALL" | "WITH" | "WITHOUT" }`
  - `type MemberFilter = { readonly search: string; readonly role: "ALL" | OrganizationRole; readonly status: "ALL" | MembershipStatus; readonly link: "ALL" | "LINKED" | "UNLINKED" }`
  - `filterPlayers(players, filter, teamsByPlayer: ReadonlyMap<string, readonly string[]>)`, `filterMembers(members, filter)`

- [ ] **Step 1: Tests schreiben**

```ts
describe("normalizeForSearch", () => {
  it("entfernt Akzente und vereinheitlicht Grossschreibung", () => {
    expect(normalizeForSearch("Jérôme Müller")).toBe("jerome muller");
  });
});

describe("filterPlayers", () => {
  it("findet Müller über die Eingabe Muller", () => { /* … */ });
  it("kombiniert Status- und Kontofilter", () => { /* … */ });
  it("liefert bei leerer Suche die unveränderte Liste", () => { /* … */ });
  it("trennt Spieler ohne Team über teamId NONE", () => { /* … */ });
});
```

Bewusst enthalten: der Umlaut-Fall, weil „Muller" sonst kein „Müller" findet und das bei Schweizer Namen sofort auffällt.

- [ ] **Step 2: Implementieren**

`normalizeForSearch` über `value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("de-CH").trim()`. Die Filter sind reine Funktionen ohne React-Bezug (AGENTS.md §4).

- [ ] **Step 3: Tests ausführen und committen**

Run: `pnpm --filter @darts-platform/web test`

---

### Task 7: Spielerliste — Zerlegung, Filterleiste, Team-Spalte

**Files:**
- Modify: `apps/web/src/components/players/roster-route.tsx` (302 Zeilen, wird zerlegt)
- Create: `apps/web/src/components/players/player-list.tsx`
- Create: `apps/web/src/components/players/player-form.tsx`
- Create: `apps/web/src/components/players/invitation-form.tsx`
- Create: `apps/web/src/components/list-filter-bar.tsx`
- Test: `apps/web/src/components/players/player-list.render.spec.tsx`

**Interfaces:**
- Consumes: Task 3 (`hasAccount`), Task 6 (Filter), bestehendes `teamListSchema`.
- Produces: `ListFilterBar` mit Suchfeld, beliebig vielen Select-Filtern und `aria-live`-Trefferzahl.

- [ ] **Step 1: Zerlegen ohne Verhaltensänderung, committen**

Liste, Spielerformular und Einladungsformular in eigene Dateien; `roster-route.tsx` behält Datenholen und Zusammenbau. Zwischenstand: `pnpm --filter @darts-platform/web test` und `pnpm typecheck` grün.

- [ ] **Step 2: Team-Zuordnung laden**

Zweite Query auf `/organizations/:id/teams` (`teamListSchema`, Berechtigung `team:read`, die auch `MEMBER` hat). Daraus eine `Map<playerId, string[]>` der **aktiven** Zugehörigkeiten (`validTo === null`); die Captain-Rolle wird als Textkürzel „(C)" angehängt, nicht als Farbe (AGENTS.md §19).

- [ ] **Step 3: Filterleiste einsetzen**

Suchfeld (`type="search"`, beschriftet), Selects für Status, Team und Konto, Trefferzahl als `aria-live="polite"` („12 von 87 Spielern"), Leerzustand mit „Filter zurücksetzen". Filterzustand als lokaler `useState`.

- [ ] **Step 4: Render-Test**

Fälle: Zeile mit und ohne Team; Kontomarkierung bei `hasAccount`; Leerzustand nach einem Filter ohne Treffer; die Trefferzahl steht in einer `aria-live`-Region.

- [ ] **Step 5: Tests ausführen und committen**

---

### Task 8: Mitgliederliste — Filter und Zuordnung

**Files:**
- Modify: `apps/web/src/components/organization/members-route.tsx`
- Create: `apps/web/src/components/organization/member-player-link.tsx`
- Test: `apps/web/src/components/organization/member-player-link.render.spec.tsx`

**Interfaces:**
- Consumes: Task 3 (`OrganizationMember.player`), Task 5 (Endpunkte), Task 6, Task 7 (`ListFilterBar`).

- [ ] **Step 1: Filterleiste einsetzen**

Suche über Anzeigename und E-Mail; Selects für Rolle, Status und Spielerzuordnung.

- [ ] **Step 2: Zuordnung**

Pro Zeile „Spieler zuordnen" mit durchsuchbarer Auswahl (nur `status === "ACTIVE"` und `hasAccount === false`, plus der aktuell zugeordnete Spieler) und „Zuordnung lösen" mit Rückfrage. Mutationen über `apiRequest`, danach `invalidateQueries` auf `["members", organizationId]` **und** `["players", organizationId]`, weil `hasAccount` sich mit ändert. Sichtbar nur bei `organization:manage_members`.

- [ ] **Step 3: Fehlerfälle sichtbar machen**

409 und 422 werden über `userFacingErrorMessage` als Text an der Zeile ausgegeben, nicht verschluckt.

- [ ] **Step 4: Render-Test und Commit**

Fälle: Zeile mit und ohne Zuordnung; die Aktionen fehlen ohne `organization:manage_members`; ein 409 erscheint als Text.

---

### Task 9: Mein Profil

**Files:**
- Modify: `apps/web/src/components/workspace-shell.tsx`
- Test: bestehender Render-Test der Shell beziehungsweise neuer Fall

**Interfaces:**
- Consumes: Task 3 (`OrganizationSummary.playerId`).

- [ ] **Step 1: Einstieg ergänzen**

Wenn `organization.playerId !== null`, ein Link „Mein Profil" auf `/spieler/${organization.playerId}`. Kein neuer Endpunkt, keine neue Berechtigung — `MEMBER` hat `player:read` und `statistics:read`.

- [ ] **Step 2: Test, Lauf, Commit**

---

### Task 10: Dokumentation und Abschluss-Gates

**Files:**
- Modify: `DATABASE_SCHEMA.md` (Spalten `players.user_id`, `organization_invitations.player_id`, neuer Index)
- Modify: `ARCHITECTURE.md` (Abschnitt Mitgliedschaften: die beiden Verknüpfungswege, Verweis auf ADR 0015)

- [ ] **Step 1: Doku nachziehen**

- [ ] **Step 2: Gates ausführen**

```bash
pnpm lint && pnpm typecheck && pnpm test && NODE_ENV=production pnpm build
```

`NODE_ENV` ist beim Web-Build gesetzt, sonst bricht der Prerender mit einem irreführenden React-Fehler ab (`[[web-build-needs-node-env]]`).

- [ ] **Step 3: Commit**

## Self-Review

- **Spec-Abdeckung:** Datenmodell → Task 1; Lesemodelle (E5) → Task 3; Einladungspfad samt fünf Konfliktfällen → Task 4; manuelle Zuordnung (E4) → Task 5; Suche/Filter (E3) → Tasks 6–8; Team-Spalte (E2) → Task 7; Selbstsicht → Task 9; Tests → in jeder Task; Doku und ADR → Task 10 plus bereits committete ADR 0015.
- **Typkonsistenz:** `hasAccount` (Spieler), `playerId` (Organisationszusammenfassung und Einladung), `player` (Mitglied) werden in Task 2 definiert und in Tasks 3, 7, 8, 9 unter genau diesen Namen verwendet.
- **Offen gelassen:** serverseitige Filter und Paginierung (Spec „Nicht im Umfang"); ressourcenbezogene Captain-Rechte (ADR 0015, Konsequenzen).
