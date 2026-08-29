# Development Demo Seed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add and execute an idempotent local-development seed containing 32 fictional players, two completed tournaments and one running tournament.

**Architecture:** A development-only API script bootstraps identity through Better Auth and drives organizations, tournaments, assignments and scoring through existing repositories/services. Fixed natural keys and command IDs make reruns idempotent while a production/non-local database guard prevents accidental seeding.

**Tech Stack:** TypeScript 5.9, Better Auth, Nest service classes, Drizzle/PostgreSQL, pnpm, Vitest

**Spec:** `docs/superpowers/specs/2026-08-29-match-abort-player-withdrawal-design.md`

## Global Constraints

- Never delete or reset existing local data.
- Refuse `NODE_ENV=production` and non-local `DATABASE_URL` unless `ALLOW_REMOTE_DEV_SEED=true` is explicitly set.
- Create exactly one demo organization with 32 active fictional players and eight boards.
- Create two completed tournaments and one running 32-player tournament.
- Use normal domain/service commands so versions, audit, outbox and projections match production behavior.
- Do not print environment values or secrets; print only fixed demo login credentials and created object counts.

---

### Task 1: Add a tested seed guard and deterministic identity helpers

**Files:**
- Create: `apps/api/src/development/seed-development.ts`
- Create: `apps/api/src/development/seed-development.spec.ts`

**Interfaces:**
- Produces: `assertDevelopmentSeedAllowed(environment, override): void`
- Produces: fixed constants `DEMO_EMAIL`, `DEMO_ORGANIZATION_SLUG`, 32 player names and deterministic command IDs

- [ ] **Step 1: Write failing guard tests**

```ts
expect(() => assertDevelopmentSeedAllowed({ nodeEnv: "production", databaseUrl: "postgres://localhost/db" }, false)).toThrow("production");
expect(() => assertDevelopmentSeedAllowed({ nodeEnv: "development", databaseUrl: "postgres://remote.example/db" }, false)).toThrow("non-local");
expect(() => assertDevelopmentSeedAllowed({ nodeEnv: "development", databaseUrl: "postgres://127.0.0.1:5432/db" }, false)).not.toThrow();
```

Also assert the fictional player-name array has length 32 and unique entries.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @darts-platform/api exec vitest run src/development/seed-development.spec.ts`

Expected: FAIL because the seed module is missing.

- [ ] **Step 3: Implement guard and constants**

Parse the URL with `new URL(databaseUrl)` and accept only `localhost`, `127.0.0.1` or `::1` unless the explicit override is true. Export pure helpers without opening a database connection during module import.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @darts-platform/api exec vitest run src/development/seed-development.spec.ts`

Expected: PASS.

### Task 2: Implement idempotent demo creation through application services

**Files:**
- Modify: `apps/api/src/development/seed-development.ts`
- Modify: `apps/api/src/development/seed-development.spec.ts`
- Modify: `apps/api/package.json`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Produces: `seedDevelopmentData(): Promise<SeedSummary>`
- Produces root command `pnpm db:seed:dev`

- [ ] **Step 1: Write a failing database integration test**

Against the integration database, invoke the seed twice with a random test profile containing unique email/slug/name prefixes, and assert both summaries report:

```ts
expect(summary).toMatchObject({
  players: 32,
  boards: 8,
  completedTournaments: 2,
  runningTournaments: 1,
});
```

Then query by the test profile slug and assert there are exactly 32 players and exactly three demo tournaments, with status counts `COMPLETED=2` and active=`1`. Existing non-demo organizations must remain. Delete only the test-profile organization and user in `afterAll`; never delete the default demo profile.

- [ ] **Step 2: Verify RED**

Run: `ALLOW_REMOTE_DEV_SEED=true pnpm --filter @darts-platform/api exec vitest run src/development/seed-development.spec.ts`

Expected: FAIL because orchestration is not implemented.

- [ ] **Step 3: Bootstrap the demo owner safely**

Look up `demo@darts.local`. If absent, create a one-purpose bootstrap inviter user, the demo organization and a pending invitation row through the Database Layer; then register the demo owner through `createAuth(...).handler()` using the normal `/sign-up/email` request. Resolve the Better Auth user, create its active OWNER membership and remove the bootstrap inviter only after all foreign-key references have been reassigned to the demo owner. If the demo owner exists, reuse the account and organization by slug. The test profile follows the same flow with unique identifiers.

- [ ] **Step 4: Upsert players and boards**

Use the Players/Boards repositories or their owning services with the demo owner auth context. Resolve existing objects by organization-scoped display name; create only missing rows.

- [ ] **Step 5: Create and complete two compact tournaments**

Create fixed-name tournaments only if absent:

- „Musterstadt Herbst-Cup“: eight-player single elimination, seven played matches
- „Musterstadt Vereinsliga“: four-player round robin, six played matches

For each ready match, assign a free board and finish a best-of-one 501 match with alternating `180/60`, `180/60`, `141` on `D12`. Use deterministic command IDs derived from stable UUID constants stored in the seed module.

- [ ] **Step 6: Create the running 32-player tournament**

Create „Musterstadt Open“ with eight groups of four, two qualifiers per group and a 16-player knockout. Complete four group matches, assign a fifth to Board 1, submit one normal visit, and leave other matches `READY`. Do not complete the active match.

- [ ] **Step 7: Add commands and documentation**

Add API script `seed:dev: "tsx src/development/seed-development.ts"`, root script `db:seed:dev`, and Quick Start documentation including fixed demo email/password and the non-destructive/idempotent behavior.

- [ ] **Step 8: Verify GREEN and idempotency**

Run: `ALLOW_REMOTE_DEV_SEED=true pnpm --filter @darts-platform/api exec vitest run src/development/seed-development.spec.ts`

Expected: PASS twice without duplicate rows.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/development apps/api/package.json package.json README.md
git commit -m "feat: add local development demo seed"
```

### Task 3: Merge, migrate, seed and read back the local environment

**Files:**
- No source changes unless merged-result verification reveals an in-scope defect

**Interfaces:**
- Consumes: completed feature branch and `pnpm db:seed:dev`
- Produces: green `main` plus populated local PostgreSQL data

- [ ] **Step 1: Re-run branch verification**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e`

Expected: all commands pass before integration.

- [ ] **Step 2: Merge the named branch locally**

From the primary repository, merge `feature/simplify-scoreboard-checkout` into `main` without force or history rewriting.

- [ ] **Step 3: Verify the merged result**

Run the same full test matrix on `main`.

Expected: all commands pass; otherwise keep the worktree and branch while fixing the merged result.

- [ ] **Step 4: Start local infrastructure and apply migrations**

Run: `pnpm infra:up && pnpm db:migrate`

Expected: PostgreSQL and Redis healthy; migration 0010 applied once.

- [ ] **Step 5: Execute the local seed twice**

Run: `pnpm db:seed:dev && pnpm db:seed:dev`

Expected: both runs succeed with identical summary counts and no duplicates.

- [ ] **Step 6: Read back the seeded state**

Use the seed summary/readback helper to verify 32 demo players, eight boards, two completed tournaments, one running tournament, at least one active scoring match and at least one ready queue match.

- [ ] **Step 7: Report local access and preservation**

Report the demo login, tournament names, final test results, merged commit, and that pre-existing local data was preserved.
