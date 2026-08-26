# ADR 0004: Phase 1 X01 Match and Command Model

- Status: Accepted
- Date: 2026-08-26

## Context

Phase 1 must support a complete 501 Double-Out match without moving scoring
rules into the API or browser. Score entry can be retried by a client and two
clients can operate the same board concurrently. Match history must remain
auditable, reversible and suitable for later realtime delivery.

## Decision

- `packages/scoring-engine` owns deterministic, infrastructure-free X01 rules.
- The engine receives immutable commands and derives the complete match state by
  replaying all commands except explicitly reverted visits.
- The API accepts one aggregate visit with score, dart count and optional final
  checkout double. It rejects totals that cannot be achieved with that dart
  count.
- Every score or undo command carries a globally unique `commandId` and is
  persisted in `score_commands`. Repeating it returns the current state without
  applying a second mutation.
- Every client mutation carries `expectedVersion`. The match row is locked in a
  database transaction and a stale version returns HTTP 409 with the current
  server state.
- Match, participant, leg, visit, board, audit and outbox changes commit in one
  PostgreSQL transaction.
- Undo marks the latest visit as reverted and reprojects the aggregate. Historical
  visits are retained.
- Phase 1 supports 501, Double Out and Best of Legs. The engine already models
  set transitions, but configurable sets remain outside the Phase 1 API.

## Consequences

- Scoring rules can be tested exhaustively without PostgreSQL, NestJS or React.
- Retry and concurrent-client behavior are explicit API semantics.
- Rebuilding a match from its command history provides an integrity check for
  denormalized match, leg and participant state.
- Aggregate score entry cannot provide per-dart statistics. Optional individual
  dart capture can be added later without changing the command boundary.
- Outbox records are ready for Phase 3 realtime publication; Phase 1 does not
  publish them yet.
