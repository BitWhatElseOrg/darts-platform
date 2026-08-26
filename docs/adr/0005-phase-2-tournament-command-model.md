# ADR 0005: Phase 2 Tournament Engine and Command Model

- Status: Accepted
- Date: 2026-08-26

## Context

Phase 2 needs deterministic generation for round robin, groups and single
elimination while tournament operations remain tenant-safe, retryable and
auditable. A generated tournament match starts an existing scoring aggregate;
its result must then advance group qualification or a knockout dependency
without duplicating scoring rules in the tournament module.

## Decision

- `packages/tournament-engine` owns infrastructure-free group allocation,
  round-robin pairing, knockout generation, byes, qualification references and
  group ranking.
- `packages/scheduling-engine` owns the explainable readiness decision. The API
  projects its decision into the dashboard and the browser only renders it.
- The relational tournament graph is persisted in `tournaments`, stages,
  groups, participants, boards and tournament matches. Source-match references
  model knockout progression explicitly.
- Tournament creation, assignment and release are authorized and scoped by an
  explicit `organizationId`. Creation writes the complete generated graph,
  audit record and outbox event in one transaction.
- Assignment and release commands carry `commandId` and `expectedVersion`.
  Repeated commands are idempotent; stale versions return HTTP 409 with the
  current dashboard projection.
- Result Correction reopens the scoring aggregate by reverting its last
  match-winning visit through the scoring engine. It also rewinds group or
  knockout projections in the same transaction. A busy board or an already
  started dependent match blocks the correction.
- Assigning a tournament match creates the normal scoring match, participants
  and first leg in the same transaction. Completing that scoring match updates
  the tournament graph and tournament version in the scoring transaction.
- The web application uses the API as its only tournament data source. It polls
  the dashboard every five seconds until the realtime outbox publisher is
  implemented and keeps unsent assignment commands visible while offline.

## Consequences

- Tournament generation and ranking can be tested without NestJS, PostgreSQL or
  React.
- Score correctness remains solely in the scoring engine while tournament
  progression consumes the committed result.
- Audit and outbox records are committed with the corresponding business write.
- Polling gives live-enough Phase 2 operation but is intentionally replaced by
  outbox-backed broadcasts in Phase 3.
- The complete 32/8/2/16 reference tournament is covered by a persistent
  63-match integration test. The browser test covers creation, assignment,
  scoring completion and the audited result-correction path.
