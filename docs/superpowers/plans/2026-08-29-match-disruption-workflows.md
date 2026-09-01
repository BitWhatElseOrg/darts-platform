# Match Disruption Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an audited technical match-abort workflow and a tournament-scoped player-withdrawal workflow with deterministic walkover progression.

**Architecture:** Lifecycle state and result provenance are persisted explicitly. Pure walkover and qualification decisions live in `@darts-platform/tournament-engine`; Nest services authorize and validate commands; tenant-scoped repositories persist each mutation transactionally with optimistic concurrency, idempotency, audit and outbox events. React only renders server-derived state and invokes commands through accessible confirmation dialogs.

**Tech Stack:** TypeScript 5.9 strict, NestJS/Fastify, Drizzle/PostgreSQL, Zod, React/Next.js, TanStack Query, Tailwind, Vitest, Playwright

**Spec:** `docs/superpowers/specs/2026-08-29-match-abort-player-withdrawal-design.md`

## Global Constraints

- A technical abort returns a linked tournament match to `READY`; it never marks a participant withdrawn.
- A withdrawal is tournament-scoped; completed played results remain unchanged and open direct matches become walkovers.
- Walkovers award two table points and record `0:0` legs; withdrawn participants cannot qualify.
- Only `OWNER`, `ADMIN` and `TOURNAMENT_DIRECTOR` receive `match:abort`; withdrawal requires `tournament:update`.
- Every command is tenant-scoped, idempotent by `commandId`, version-checked, audited and broadcast only after commit.
- No central scoring or tournament logic may be implemented in React.
- Existing migrations remain immutable; schema changes use a new generated migration.
- Production code may not use `any`.

---

### Task 0: Preserve the approved simplified checkout baseline

**Files:**
- Modify: `apps/web/src/components/match-workspace.tsx`
- Test: `apps/web/tests/foundation.spec.ts`

**Interfaces:**
- Consumes: the already verified checkout-dialog implementation in the worktree
- Produces: a clean checkpoint before lifecycle work begins

- [ ] **Step 1: Re-run the focused browser test**

Run: `pnpm --filter @darts-platform/web exec playwright test tests/foundation.spec.ts --grep "completes the full authenticated organization and match flow"`

Expected: PASS; the normal visit uses three darts and a zero score opens the checkout dialog.

- [ ] **Step 2: Commit only the approved checkout files**

```bash
git add apps/web/src/components/match-workspace.tsx apps/web/tests/foundation.spec.ts
git commit -m "feat: simplify scoreboard checkout entry"
```

### Task 1: Persist explicit lifecycle and result provenance

**Files:**
- Modify: `packages/domain/src/permissions.ts`
- Modify: `packages/domain/src/permissions.spec.ts`
- Modify: `packages/database/src/schema.ts`
- Modify: `packages/database/src/index.ts`
- Create: `packages/database/drizzle/0010_match_disruptions.sql`
- Modify: `packages/schemas/src/match.ts`
- Create: `packages/schemas/src/match.spec.ts`
- Modify: `packages/schemas/src/tournament.ts`
- Modify: `packages/schemas/src/tournament.spec.ts`
- Modify: `packages/schemas/src/index.ts`

**Interfaces:**
- Produces: `match:abort`, `AbortMatchInput`, `AbortMatchResponse`, `WithdrawTournamentParticipantInput`, `TournamentParticipantStatus`, `TournamentMatchResultType`
- Produces DB fields: `matches.status=ABORTED`, tournament participant withdrawal metadata, and `tournament_matches.result_type`

- [ ] **Step 1: Write failing permission and schema tests**

Add assertions equivalent to:

```ts
expect(hasOrganizationPermission("TOURNAMENT_DIRECTOR", "match:abort")).toBe(true);
expect(hasOrganizationPermission("SCORER", "match:abort")).toBe(false);

expect(abortMatchSchema.parse({
  commandId: randomUUID(), expectedVersion: 2, controllerId: randomUUID(), reason: "Neustart",
})).toMatchObject({ expectedVersion: 2, reason: "Neustart" });

expect(withdrawTournamentParticipantSchema.parse({
  commandId: randomUUID(), expectedVersion: 4, playerId: randomUUID(), reason: "Verletzung",
})).toMatchObject({ reason: "Verletzung" });
```

Also assert that a two-character withdrawal reason and a reason over 500 characters fail.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @darts-platform/domain exec vitest run src/permissions.spec.ts && pnpm --filter @darts-platform/schemas exec vitest run src/match.spec.ts src/tournament.spec.ts`

Expected: FAIL because `match:abort` and both schemas do not exist.

- [ ] **Step 3: Implement types, Zod schemas and Drizzle columns**

Define:

```ts
export const abortMatchSchema = z.object({
  commandId: z.uuid(),
  expectedVersion: z.number().int().nonnegative(),
  controllerId: z.uuid().optional(),
  reason: z.string().trim().max(500).optional(),
});
export const abortMatchResponseSchema = z.object({
  matchId: z.uuid(),
  status: z.literal("ABORTED"),
  tournamentMatchId: z.uuid().nullable(),
});
export const tournamentParticipantStatusSchema = z.enum(["ACTIVE", "WITHDRAWN"]);
export const tournamentMatchResultTypeSchema = z.enum(["PLAYED", "BYE", "WALKOVER"]);
export const withdrawTournamentParticipantSchema = z.object({
  commandId: z.uuid(),
  expectedVersion: z.number().int().nonnegative(),
  playerId: z.uuid(),
  reason: z.string().trim().min(3).max(500),
});
```

Extend DB checks for `ABORTED`, `ABORT_MATCH`, `WITHDRAW_PARTICIPANT`, participant status and result type. Add the permission only to owner/admin/director role sets.

- [ ] **Step 4: Generate and inspect the migration**

Run: `pnpm --filter @darts-platform/database exec drizzle-kit generate --config=drizzle.config.ts --name=match_disruptions`

Expected: `0010_match_disruptions.sql` plus its Drizzle metadata snapshot.

Edit the generated migration so data is backfilled before the final consistency check:

```sql
UPDATE "tournament_matches" SET "result_type" = 'PLAYED' WHERE "status" = 'COMPLETED';
UPDATE "tournament_matches" SET "result_type" = 'BYE' WHERE "status" = 'BYE';
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_result_type_consistency"
CHECK (
  ("status" = 'COMPLETED' AND "result_type" IN ('PLAYED', 'WALKOVER')) OR
  ("status" = 'BYE' AND "result_type" = 'BYE') OR
  ("status" NOT IN ('COMPLETED', 'BYE') AND "result_type" IS NULL)
);
```

- [ ] **Step 5: Verify GREEN**

Run: `pnpm --filter @darts-platform/domain test && pnpm --filter @darts-platform/schemas test && pnpm --filter @darts-platform/database typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/domain packages/schemas packages/database
git commit -m "feat: model match disruption states"
```

### Task 2: Add deterministic walkover decisions to the Tournament Engine

**Files:**
- Modify: `packages/tournament-engine/src/tournament.ts`
- Modify: `packages/tournament-engine/src/tournament.spec.ts`
- Modify: `packages/tournament-engine/src/index.ts`

**Interfaces:**
- Consumes: `ACTIVE | WITHDRAWN` participant states and tournament match graph snapshots
- Produces: discriminated `GroupMatchResult` and `resolveTournamentWithdrawals(input): readonly WithdrawalMatchDecision[]`

- [ ] **Step 1: Write failing group-table tests**

Use a played result and a walkover result:

```ts
const standings = calculateGroupStandings({
  participants: participants(3),
  withdrawnPlayerIds: ["p3"],
  results: [
    { type: "PLAYED", playerOneId: "p1", playerTwoId: "p2", playerOneLegs: 2, playerTwoLegs: 1, winnerPlayerId: "p1" },
    { type: "WALKOVER", playerOneId: "p2", playerTwoId: "p3", playerOneLegs: 0, playerTwoLegs: 0, winnerPlayerId: "p2" },
  ],
});
expect(standings.find((row) => row.playerId === "p2")).toMatchObject({ played: 2, won: 1, lost: 1, legsFor: 1, legsAgainst: 2, points: 2 });
expect(standings.find((row) => row.playerId === "p3")?.withdrawn).toBe(true);
```

Assert that `PLAYED` rejects a tie and `WALKOVER` rejects non-zero legs.

- [ ] **Step 2: Write failing graph tests**

Cover these concrete graphs:

- READY `p1` versus withdrawn `p2` -> `COMPLETED/WALKOVER`, winner `p1`
- WAITING withdrawn `p2` versus unresolved source -> remains `WAITING`; once source winner `p3` is supplied -> walkover winner `p3`
- both resolved participants withdrawn -> `CANCELLED`, no winner
- a walkover semifinal propagates its winner into the final

- [ ] **Step 3: Verify RED**

Run: `pnpm --filter @darts-platform/tournament-engine exec vitest run src/tournament.spec.ts`

Expected: FAIL because walkover result variants and `resolveTournamentWithdrawals` are missing.

- [ ] **Step 4: Implement the minimal pure domain API**

Use explicit interfaces:

```ts
export type GroupMatchResult =
  | { readonly type: "PLAYED"; readonly playerOneId: string; readonly playerTwoId: string; readonly playerOneLegs: number; readonly playerTwoLegs: number; readonly winnerPlayerId: string }
  | { readonly type: "WALKOVER"; readonly playerOneId: string; readonly playerTwoId: string; readonly playerOneLegs: 0; readonly playerTwoLegs: 0; readonly winnerPlayerId: string };

export interface WithdrawalMatchSnapshot {
  readonly id: string;
  readonly status: "WAITING" | "READY" | "IN_PROGRESS" | "COMPLETED" | "BYE" | "CANCELLED";
  readonly participantOneId: string | null;
  readonly participantTwoId: string | null;
  readonly sourceOneMatchId: string | null;
  readonly sourceTwoMatchId: string | null;
  readonly winnerPlayerId: string | null;
}

export interface WithdrawalMatchDecision {
  readonly matchId: string;
  readonly status: "WAITING" | "READY" | "COMPLETED" | "BYE" | "CANCELLED";
  readonly participantOneId: string | null;
  readonly participantTwoId: string | null;
  readonly winnerPlayerId: string | null;
  readonly resultType: "WALKOVER" | "BYE" | null;
}
```

The resolver works on copies, processes source dependencies in rounds until stable, and returns only changed matches.

- [ ] **Step 5: Verify GREEN and refactor**

Run: `pnpm --filter @darts-platform/tournament-engine test`

Expected: PASS with existing tournament-generation tests unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/tournament-engine
git commit -m "feat: resolve tournament walkovers"
```

### Task 3: Implement the transactional technical match abort

**Files:**
- Create: `apps/api/src/matches/abort-match.ts`
- Modify: `apps/api/src/matches/matches.repository.ts`
- Modify: `apps/api/src/matches/matches.service.ts`
- Modify: `apps/api/src/matches/matches.controller.ts`
- Modify: `apps/api/src/matches/matches.integration.spec.ts`

**Interfaces:**
- Consumes: `AbortMatchInput`, `match:abort`
- Produces: `abortScoringMatch(transaction, input)` reusable by tournament withdrawal and `MatchesService.abort(...)`

- [ ] **Step 1: Write the failing integration test**

Create a match with a board, submit two visits, then call:

```ts
const result = await service.abort({
  organizationId,
  matchId: state.id,
  data: { commandId, expectedVersion: state.version, controllerId, reason: "Board neu starten" },
  auth,
  audit,
});
expect(result).toEqual({ matchId: state.id, status: "ABORTED", tournamentMatchId: null });
```

Assert: no legs/visits remain, match status is `ABORTED`, board is `AVAILABLE`, lease is deleted, list omits the match, `MATCH_ABORTED` and audit records exist. Repeat the same command and assert the same response. Add stale-version, foreign-controller and `SCORER` authorization assertions.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @darts-platform/api exec vitest run src/matches/matches.integration.spec.ts`

Expected: FAIL because `MatchesService.abort` does not exist.

- [ ] **Step 3: Implement the reusable transaction primitive**

`abortScoringMatch` must accept an existing Drizzle transaction and return:

```ts
interface AbortedScoringMatch {
  readonly matchId: string;
  readonly boardId: string | null;
  readonly discardedVisitCount: number;
  readonly previousVersion: number;
}
```

It deletes visits/legs, resets participant legs, marks the match `ABORTED`, clears board/current player, deletes the controller lease and frees the board. It inserts the `ABORT_MATCH` score command but does not mutate tournament scheduling rows.

The `ABORT_MATCH` payload stores `tournamentMatchId`, `discardedVisitCount`, `reason` and `source`. This lets duplicate direct-abort requests reproduce the original response after the tournament link has been cleared.

- [ ] **Step 4: Add repository, service and controller orchestration**

Implement `POST :matchId/abort`. The repository performs duplicate-command detection before match lookup, locks all rows, checks version/controller, invokes the primitive, resets a linked tournament match to `READY`, bumps tournament version, and inserts audit/outbox records in the same transaction. `list` and `getState` exclude `ABORTED` rows so the existing `MatchStateResponse` remains limited to playable and completed states.

- [ ] **Step 5: Verify GREEN**

Run: `pnpm --filter @darts-platform/api exec vitest run src/matches/matches.integration.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/matches
git commit -m "feat: abort active scoring matches"
```

### Task 4: Implement tournament participant withdrawal and progression

**Files:**
- Modify: `apps/api/src/tournaments/tournaments.repository.ts`
- Modify: `apps/api/src/tournaments/tournaments.service.ts`
- Modify: `apps/api/src/tournaments/tournaments.controller.ts`
- Modify: `apps/api/src/tournaments/tournaments.integration.spec.ts`
- Modify: `apps/api/src/tournaments/tournaments.reference.integration.spec.ts`

**Interfaces:**
- Consumes: `WithdrawTournamentParticipantInput`, `resolveTournamentWithdrawals`, `abortScoringMatch`
- Produces: `TournamentsService.withdrawParticipant(...)` returning `TournamentDashboard`

- [ ] **Step 1: Write failing group-withdrawal integration tests**

Build a four-player group tournament. Complete one match involving the future withdrawn player, assign another match, submit a visit, then withdraw that player. Assert:

- the completed played result remains `PLAYED`
- active scoring rows are aborted and its board is free
- every remaining direct group match is `WALKOVER`
- walkover standings use two points and `0:0` legs
- withdrawn participant is excluded from qualified rows
- command repetition is idempotent

- [ ] **Step 2: Write failing KO-withdrawal integration tests**

Use an eight-player bracket and assert that withdrawal from an active semifinal awards the opponent a walkover and fills the correct final slot. Add a WAITING opponent case and a completed-tournament rejection.

- [ ] **Step 3: Verify RED**

Run: `pnpm --filter @darts-platform/api exec vitest run src/tournaments/tournaments.integration.spec.ts`

Expected: FAIL because the withdrawal endpoint and persistence do not exist.

- [ ] **Step 4: Implement repository transaction**

Add `withdrawParticipant(input)` with this order: duplicate command, tenant-scoped tournament lock, version check, active participant lock, mark `WITHDRAWN`, abort at most one active scoring session, run the pure resolver, persist decisions, propagate winners, resolve groups, recompute stage/tournament completion, insert `WITHDRAW_PARTICIPANT`, audit and outbox rows.

Refactor the existing regular match completion path only enough to share winner propagation and completion recomputation; preserve result-correction behavior. Every regular completion sets `result_type = PLAYED`, generated byes set `result_type = BYE`, walkovers carry no `scoring_match_id`, and group resolution maps them to the engine's `WALKOVER` result variant with `0:0` legs.

- [ ] **Step 5: Add service and controller**

Parse `withdrawTournamentParticipantSchema`, require `tournament:update`, map not-found/version/completed/already-withdrawn cases to the standard API error shape, and return a freshly projected dashboard.

- [ ] **Step 6: Verify GREEN**

Run: `pnpm --filter @darts-platform/api test`

Expected: PASS, including the 32-player reference integration test.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/tournaments
git commit -m "feat: withdraw tournament participants"
```

### Task 5: Project participant and result state consistently

**Files:**
- Modify: `packages/schemas/src/tournament.ts`
- Modify: `apps/api/src/tournaments/tournaments.repository.ts`
- Modify: `apps/api/src/tournaments/tournaments.service.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/web/src/components/live/live-tournament.tsx`
- Modify: `apps/web/src/components/tournament/standings-sheet.tsx`
- Modify: `apps/web/src/components/tournament/results-panel.tsx`

**Interfaces:**
- Produces dashboard `participants[]` with withdrawal metadata, standing-row `status`, and result/bracket `resultType`
- Ensures only played completed scoring matches feed statistics

- [ ] **Step 1: Add failing projection assertions**

Extend tournament integration tests:

```ts
expect(dashboard.participants.find((entry) => entry.playerId === withdrawnId)).toMatchObject({ status: "WITHDRAWN", withdrawalReason: "Verletzung" });
expect(dashboard.recentResults.some((result) => result.resultType === "WALKOVER")).toBe(true);
expect(dashboard.groups.flatMap((group) => group.rows).find((row) => row.playerId === withdrawnId)?.status).toBe("WITHDRAWN");
```

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @darts-platform/api exec vitest run src/tournaments/tournaments.integration.spec.ts`

Expected: FAIL because dashboard schemas lack these fields.

- [ ] **Step 3: Extend server projection and statistics filter**

Add exact dashboard fields and map walkover group results into the engine. The worker must ignore tournament scoring matches unless the linked result type is `PLAYED`; free completed matches remain eligible.

- [ ] **Step 4: Render read-only labels**

Render visible text labels „Zurückgezogen“, „Walkover“ and „Freilos“ in tournament and public live views. Do not use color as the only signal.

- [ ] **Step 5: Verify GREEN**

Run: `pnpm --filter @darts-platform/schemas test && pnpm --filter @darts-platform/api test && pnpm --filter @darts-platform/worker typecheck && pnpm --filter @darts-platform/web typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/schemas apps/api/src/tournaments apps/worker apps/web/src/components/live apps/web/src/components/tournament
git commit -m "feat: expose tournament disruption state"
```

### Task 6: Add the accessible Scoreboard abort dialog

**Files:**
- Create: `apps/web/src/components/match-abort-dialog.tsx`
- Modify: `apps/web/src/components/match-workspace.tsx`
- Modify: `apps/web/src/lib/offline-command-queue.ts`
- Test: `apps/web/tests/foundation.spec.ts`

**Interfaces:**
- Consumes: abort API response and a `canAbort` prop derived from the organization role
- Produces: `removeOfflineCommandsForScope(scope): Promise<number>` and destructive confirmation UI

- [ ] **Step 1: Write the failing Playwright flow**

Start a match, score a visit, open „Match abbrechen“, cancel once, reopen and confirm. Assert that the dialog explains discarded visits, the match disappears, and the board reads „frei“. Assert a scorer cannot see the button.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @darts-platform/web exec playwright test tests/foundation.spec.ts --grep "match flow"`

Expected: FAIL because the abort button is absent.

- [ ] **Step 3: Implement queue cleanup and mutation**

Add an IndexedDB cursor deletion scoped by `scope`. Call the abort endpoint only while online; after success remove scoped offline commands and invalidate `matches`, `boards`, and tournament-dashboard queries.

- [ ] **Step 4: Implement the dialog**

Use native `<dialog>`, `aria-labelledby`, Escape cancellation, visible focus, a rose destructive action and touch targets at least 44px. Copy ends with „Match endgültig abbrechen“ and includes the queued-command count.

- [ ] **Step 5: Verify GREEN**

Run: `pnpm --filter @darts-platform/web exec playwright test tests/foundation.spec.ts --grep "match flow"`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/match-abort-dialog.tsx apps/web/src/components/match-workspace.tsx apps/web/src/lib/offline-command-queue.ts apps/web/tests/foundation.spec.ts
git commit -m "feat: abort matches from scoreboard"
```

### Task 7: Add the tournament withdrawal dialog

**Files:**
- Create: `apps/web/src/components/tournament/player-withdrawal-dialog.tsx`
- Modify: `apps/web/src/components/tournament/command-centre.tsx`
- Modify: `apps/web/src/components/tournament/disruptions-panel.tsx`
- Test: `apps/web/tests/foundation.spec.ts`

**Interfaces:**
- Consumes: dashboard `participants`, withdrawal endpoint and `canCorrect`/director capability
- Produces: an online-only „Spieler fällt aus“ workflow with reason validation

- [ ] **Step 1: Write the failing browser test**

Open a running tournament, invoke „Spieler fällt aus“, select an active participant, verify that a two-character reason blocks submission, submit „Verletzung“, then assert visible `Zurückgezogen` and `Walkover` labels plus a freed active board.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @darts-platform/web exec playwright test tests/foundation.spec.ts --grep "tournament"`

Expected: FAIL because the withdrawal action is absent.

- [ ] **Step 3: Implement the dialog and command**

The dialog lists only `ACTIVE` participants, requires 3–500 characters, summarizes irreversible effects, disables submit offline, handles 409 by adopting `currentState`, and writes the returned dashboard directly into TanStack Query.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @darts-platform/web exec playwright test tests/foundation.spec.ts --grep "tournament"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/tournament apps/web/tests/foundation.spec.ts
git commit -m "feat: withdraw players from tournament dashboard"
```

### Task 8: Verify, audit and prepare the branch for merge

**Files:**
- Modify only when verification reveals a defect in files already in scope

**Interfaces:**
- Produces: a green, reviewed feature branch ready for local merge

- [ ] **Step 1: Run formatting and static checks**

Run: `git diff --check && pnpm lint && pnpm typecheck`

Expected: exit 0.

- [ ] **Step 2: Run all automated tests and build**

Run: `pnpm test && pnpm build && pnpm test:e2e`

Expected: all tasks and Playwright tests pass.

- [ ] **Step 3: Perform UI and security review**

Run the Impeccable audit on both dialogs at desktop and 390px mobile widths. Run the Codex Security diff scan against `main`, including tenant filters, authorization, command replay, concurrency, IndexedDB deletion scope and destructive confirmation.

- [ ] **Step 4: Self-review the diff**

Run: `git diff main...HEAD --stat && git status --short`

Expected: only planned source, migration, test and documentation files; no generated `.next` artifacts or secrets.

- [ ] **Step 5: Commit review fixes and re-run affected checks**

```bash
git add packages/domain packages/database packages/schemas packages/tournament-engine apps/api apps/worker apps/web
git commit -m "fix: harden match disruption workflows"
```

Skip this commit when review found nothing.
