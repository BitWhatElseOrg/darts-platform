# Tournament Concurrency and Walkover Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate tournament/scoring lock-order deadlocks and guarantee that every walkover outbox event identifies the actually withdrawn participant.

**Architecture:** Add one pure provenance helper and one database lock helper. All tournament-linked score mutations lock `Tournament → TournamentMatch → Scoring Match`; withdrawal takes the same row-lock order before aborting active scoring aggregates.

**Tech Stack:** TypeScript, NestJS repositories, Drizzle ORM, PostgreSQL row locks, Vitest

**Spec:** `docs/superpowers/specs/2026-08-31-production-bootstrap-release-hardening-design.md`

## Global Constraints

- Every tenant-owned query includes `organizationId`.
- Business state, commands, outbox events, and audits remain transactional.
- Existing migrations are immutable.
- No `any`; use the existing inferred Drizzle transaction type.
- Walkover ambiguity must roll back instead of emitting guessed provenance.
- Every implementation task follows red-green-refactor and ends in a focused commit.

---

### Task 1: Centralize walkover withdrawal provenance

**Files:**
- Create: `apps/api/src/tournaments/walkover-provenance.ts`
- Create: `apps/api/src/tournaments/walkover-provenance.spec.ts`
- Modify: `apps/api/src/tournaments/apply-withdrawal-propagation.ts`
- Modify: `apps/api/src/tournaments/tournaments.repository.ts`
- Test: `apps/api/src/tournaments/tournaments.integration.spec.ts`

**Interfaces:**
- Consumes: a decision with `participantOneId`, `participantTwoId`, `winnerPlayerId`, and a `ReadonlySet<string>` of withdrawn player IDs.
- Produces: `getWalkoverWithdrawnPlayerId(decision, withdrawnPlayerIds): string`, which returns exactly one non-winner withdrawn participant or throws `Walkover withdrawal invariant violated.`

- [ ] **Step 1: Write the failing unit tests**

```ts
import { describe, expect, it } from "vitest";
import { getWalkoverWithdrawnPlayerId } from "./walkover-provenance.js";

describe("walkover provenance", () => {
  it("returns the withdrawn loser rather than the current command player", () => {
    expect(getWalkoverWithdrawnPlayerId({
      participantOneId: "11111111-1111-4111-8111-111111111111",
      participantTwoId: "22222222-2222-4222-8222-222222222222",
      winnerPlayerId: "22222222-2222-4222-8222-222222222222",
    }, new Set(["11111111-1111-4111-8111-111111111111"]))).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it.each([
    new Set<string>(),
    new Set([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]),
  ])("rejects ambiguous withdrawal sets", (withdrawn) => {
    expect(() => getWalkoverWithdrawnPlayerId({
      participantOneId: "11111111-1111-4111-8111-111111111111",
      participantTwoId: "22222222-2222-4222-8222-222222222222",
      winnerPlayerId: "22222222-2222-4222-8222-222222222222",
    }, withdrawn)).toThrow("Walkover withdrawal invariant violated.");
  });
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `pnpm --filter @darts-platform/api test -- src/tournaments/walkover-provenance.spec.ts`

Expected: FAIL because `walkover-provenance.js` does not exist.

- [ ] **Step 3: Implement the minimal pure helper**

```ts
interface WalkoverDecisionParticipants {
  readonly participantOneId: string | null;
  readonly participantTwoId: string | null;
  readonly winnerPlayerId: string | null;
}

export function getWalkoverWithdrawnPlayerId(
  decision: WalkoverDecisionParticipants,
  withdrawnPlayerIds: ReadonlySet<string>,
): string {
  const candidates = [decision.participantOneId, decision.participantTwoId]
    .filter((playerId): playerId is string =>
      playerId !== null &&
      playerId !== decision.winnerPlayerId &&
      withdrawnPlayerIds.has(playerId),
    );
  if (candidates.length !== 1) {
    throw new Error("Walkover withdrawal invariant violated.");
  }
  return candidates[0];
}
```

- [ ] **Step 4: Replace both duplicated/incorrect event calculations**

In `apply-withdrawal-propagation.ts` and both decision passes inside `withdrawParticipant`, compute:

```ts
const withdrawnPlayerId = getWalkoverWithdrawnPlayerId(decision, withdrawnSet);
```

Use that value in `TOURNAMENT_MATCH_WALKOVER.payload.withdrawnPlayerId`. Remove every use of `input.data.playerId` for this payload.

- [ ] **Step 5: Add the delayed multi-withdrawal integration assertion**

Extend the existing delayed-final scenario in `tournaments.integration.spec.ts`. Query the final's walkover event and assert the earlier withdrawn semifinal winner is recorded:

```ts
const [walkoverEvent] = await databaseService.database
  .select({ payload: outboxEvents.payload })
  .from(outboxEvents)
  .where(and(
    eq(outboxEvents.organizationId, organizationId),
    eq(outboxEvents.aggregateId, created.id),
    eq(outboxEvents.eventType, "TOURNAMENT_MATCH_WALKOVER"),
  ))
  .orderBy(desc(outboxEvents.createdAt))
  .limit(1);

expect(walkoverEvent?.payload).toMatchObject({
  tournamentMatchId: finalMatchId,
  withdrawnPlayerId: withdrawnWinnerId,
});
```

Import `desc` and retain the final match ID from the dashboard fixture. The assertion must fail against the current `input.data.playerId` implementation.

- [ ] **Step 6: Run focused and API tests and confirm GREEN**

Run:

```bash
pnpm --filter @darts-platform/api test -- src/tournaments/walkover-provenance.spec.ts
pnpm --filter @darts-platform/api test -- src/tournaments/tournaments.integration.spec.ts
```

Expected: both test files PASS.

- [ ] **Step 7: Commit the provenance fix**

```bash
git add apps/api/src/tournaments/walkover-provenance.ts apps/api/src/tournaments/walkover-provenance.spec.ts apps/api/src/tournaments/apply-withdrawal-propagation.ts apps/api/src/tournaments/tournaments.repository.ts apps/api/src/tournaments/tournaments.integration.spec.ts
git commit -m "fix: preserve walkover withdrawal provenance"
```

---

### Task 2: Introduce the tournament scoring lock context

**Files:**
- Create: `apps/api/src/matches/tournament-scoring-lock.ts`
- Create: `apps/api/src/matches/tournament-scoring-lock.integration.spec.ts`
- Modify: `apps/api/src/matches/matches.repository.ts`

**Interfaces:**
- Consumes: `DatabaseTransaction`, `organizationId`, and `scoringMatchId`.
- Produces: `lockTournamentScoringContext(transaction, organizationId, scoringMatchId): Promise<TournamentMatch | null>`; a non-null result guarantees that the tenant tournament row and returned tournament-match row are locked before the caller locks the scoring match.

- [ ] **Step 1: Write the failing lock-order integration test**

Create a tournament with an assigned scoring match. Use two independent database connections. Transaction A locks the tournament row. Start `lockTournamentScoringContext` in transaction B, then set a short `lock_timeout` in transaction C and lock the scoring match:

```ts
await transactionA.execute(sql`select id from tournaments where id = ${tournamentId} for update`);
const waitingContext = connectionB.database.transaction((transaction) =>
  lockTournamentScoringContext(transaction, organizationId, scoringMatchId),
);
await new Promise((resolve) => setTimeout(resolve, 100));
await expect(connectionC.database.transaction(async (transaction) => {
  await transaction.execute(sql`set local lock_timeout = '250ms'`);
  await transaction.execute(sql`select id from matches where id = ${scoringMatchId} for update`);
})).resolves.toBeUndefined();
```

The current repository has no helper, so the test initially fails to compile. Release transaction A, await transaction B, then close all test connections in `finally`.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `pnpm --filter @darts-platform/api test -- src/matches/tournament-scoring-lock.integration.spec.ts`

Expected: FAIL because `lockTournamentScoringContext` does not exist.

- [ ] **Step 3: Implement the lock helper**

```ts
import { and, eq } from "drizzle-orm";
import { tournamentMatches, tournaments, type Database, type TournamentMatch } from "@darts-platform/database";

type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function lockTournamentScoringContext(
  transaction: DatabaseTransaction,
  organizationId: string,
  scoringMatchId: string,
): Promise<TournamentMatch | null> {
  const [candidate] = await transaction
    .select({ id: tournamentMatches.id, tournamentId: tournamentMatches.tournamentId })
    .from(tournamentMatches)
    .where(and(
      eq(tournamentMatches.organizationId, organizationId),
      eq(tournamentMatches.scoringMatchId, scoringMatchId),
    ))
    .limit(1);
  if (candidate === undefined) return null;

  const [tournament] = await transaction
    .select({ id: tournaments.id })
    .from(tournaments)
    .where(and(
      eq(tournaments.organizationId, organizationId),
      eq(tournaments.id, candidate.tournamentId),
    ))
    .for("update")
    .limit(1);
  if (tournament === undefined) throw new Error("Tournament scoring lock invariant violated.");

  const [scheduled] = await transaction
    .select()
    .from(tournamentMatches)
    .where(and(
      eq(tournamentMatches.organizationId, organizationId),
      eq(tournamentMatches.id, candidate.id),
      eq(tournamentMatches.scoringMatchId, scoringMatchId),
    ))
    .for("update")
    .limit(1);
  if (scheduled === undefined) throw new Error("Tournament scoring lock invariant violated.");
  return scheduled;
}
```

- [ ] **Step 4: Call the helper before every tournament-linked scoring match lock**

In `submitVisit` and `undo`, call without retaining an unused value:

```ts
await lockTournamentScoringContext(
  transaction,
  input.organizationId,
  input.matchId,
);
```

Call it after duplicate-command handling and before `select().from(matches)...for("update")`. In `abort`, assign the same call to `tournamentContext` and reuse that row instead of querying the scheduled match after the scoring lock.

- [ ] **Step 5: Run focused repository tests and confirm GREEN**

Run:

```bash
pnpm --filter @darts-platform/api test -- src/matches/tournament-scoring-lock.integration.spec.ts
pnpm --filter @darts-platform/api test -- src/matches/matches.integration.spec.ts
```

Expected: both PASS, including free matches returning `null` without a tournament lock.

- [ ] **Step 6: Commit the shared lock context**

```bash
git add apps/api/src/matches/tournament-scoring-lock.ts apps/api/src/matches/tournament-scoring-lock.integration.spec.ts apps/api/src/matches/matches.repository.ts
git commit -m "fix: serialize tournament scoring mutations"
```

---

### Task 3: Reorder withdrawal locks and prove concurrent safety

**Files:**
- Modify: `apps/api/src/tournaments/tournaments.repository.ts`
- Modify: `apps/api/src/tournaments/tournaments.integration.spec.ts`

**Interfaces:**
- Consumes: the lock order established by `lockTournamentScoringContext`.
- Produces: withdrawal row acquisition in `Tournament → Participant → TournamentMatches → sorted Scoring Matches` order.

- [ ] **Step 1: Add a failing forced-interleaving test**

Add an integration test that assigns a tournament match, captures `expectedVersion`, and starts a withdrawal while a separate transaction temporarily holds the tournament-match row. Set `lock_timeout = '2s'` for both competing commands. Submit a valid visit concurrently and release the held row. Assert:

```ts
const results = await Promise.allSettled([withdrawalPromise, visitPromise]);
expect(results.some((result) => result.status === "rejected" &&
  String(result.reason).includes("deadlock detected"))).toBe(false);
expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
```

Read back the tournament and scoring match and assert the losing stale command did not create a second terminal outcome. The test must be deterministic through explicit held locks, not repeated timing loops.

- [ ] **Step 2: Run the test against the old order and confirm RED**

Run: `pnpm --filter @darts-platform/api test -- src/tournaments/tournaments.integration.spec.ts`

Expected: the forced ordering exposes a lock timeout/deadlock or the new readback assertions fail.

- [ ] **Step 3: Reorder withdrawal row locks**

Move the `tournamentMatches ... for("update")` query before collecting and locking scoring matches. Derive the scoring IDs from those already locked rows:

```ts
const matchRows = await transaction
  .select()
  .from(tournamentMatches)
  .where(and(
    eq(tournamentMatches.organizationId, input.organizationId),
    eq(tournamentMatches.tournamentId, input.tournamentId),
  ))
  .for("update");

const scoringMatchIds = [...new Set(matchRows.flatMap((match) =>
  match.status === "IN_PROGRESS" && match.scoringMatchId !== null
    ? [match.scoringMatchId]
    : [],
))].sort();
```

Then lock `matches` by `organizationId` and sorted IDs. Delete the incorrect comment claiming the previous order matched score submission, and document the actual global order in one concise comment.

- [ ] **Step 4: Run concurrency, API, type, and lint gates**

Run:

```bash
pnpm --filter @darts-platform/api test -- src/tournaments/tournaments.integration.spec.ts
pnpm --filter @darts-platform/api test -- src/matches/matches.integration.spec.ts
pnpm --filter @darts-platform/api typecheck
pnpm lint
```

Expected: all PASS and no deadlock text appears.

- [ ] **Step 5: Commit the withdrawal lock order**

```bash
git add apps/api/src/tournaments/tournaments.repository.ts apps/api/src/tournaments/tournaments.integration.spec.ts
git commit -m "fix: align tournament withdrawal locks"
```

---

### Task 4: Review and verify the completed integrity fix

**Files:**
- Review: all files changed by Tasks 1-3

**Interfaces:**
- Consumes: commits from Tasks 1-3.
- Produces: a reviewed, fully tested integrity fix ready for the bootstrap and release plans.

- [ ] **Step 1: Inspect the exact range**

Run `git diff 93742d8..HEAD -- apps/api/src/matches apps/api/src/tournaments` and verify tenant predicates, row-lock order, event payloads, and rollback behavior.

- [ ] **Step 2: Run the full repository gates**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Expected: every command exits 0; Playwright reports 4 passing tests or the updated intentional count.

- [ ] **Step 3: Request an independent code review**

Review base `93742d8` through `HEAD`. Critical or Important findings block the next plan; fix them test-first and rerun Step 2.
