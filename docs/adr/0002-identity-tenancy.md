# ADR 0002: Identity, Tenant Context and Authorization

- Status: Accepted
- Date: 2026-08-26

## Context

Phase 0 requires login/logout, organizations, invitations, role-based permissions,
player management and tested tenant isolation. Better Auth should own credentials
and sessions without becoming a second source of truth for the platform's
organization and player domains.

## Decision

- Better Auth owns users, credential accounts, sessions and verification records.
- The Better Auth handler is mounted below `/api/v1/auth/*` in NestJS/Fastify.
- Session cookies are HttpOnly and CORS is restricted to the configured web origin.
- Organization membership and invitations remain platform-owned domain data.
- Every tenant repository method receives `organizationId` explicitly.
- A global authentication guard protects all endpoints unless they are explicitly
  marked public.
- Organization permissions are defined in the infrastructure-free domain package.
- Critical organization, invitation and player mutations write an audit event in
  the same PostgreSQL transaction as the domain change.
- Deleting a player through the API archives it by setting `status = INACTIVE`,
  preserving future match history.

## Consequences

- Authentication can evolve independently from tournament and scoring logic.
- Tenant isolation and authorization are enforced server-side and can be tested
  without relying on UI visibility.
- Organization invitations are email-bound and expire after 48 hours. Email
  delivery is intentionally deferred; pending invitations are visible after the
  invited user signs in.
- Redis is not used as the source of truth for sessions or permissions.
