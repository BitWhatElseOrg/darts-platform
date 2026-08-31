# ADR 0003: Phase 0 Production Operations

- Status: Accepted
- Date: 2026-08-26

## Context

Phase 0 requires a reproducible production deployment, automated database
migrations, health checks, actionable logging and a mandatory green CI gate.
The platform is a shared pnpm monorepo with separate Web and API processes.

Railway's former per-service Config as Code format is deprecated for new
services. The current project-level Infrastructure as Code format is therefore
the appropriate source of truth.

## Decision

- Railway resources are declared together in `.railway/railway.ts`.
- PostgreSQL and Redis are Railway-managed resources referenced explicitly by
  the API service.
- Web and API use separate multi-stage Dockerfiles built from the monorepo root.
- The API deployment entrypoint applies versioned Drizzle migrations before it
  starts accepting requests.
- Phase 0 runs exactly one API replica to prevent concurrent migration runners.
- The readiness endpoint returns HTTP 503 when PostgreSQL or Redis is unavailable.
- Production API logs are newline-delimited JSON on stdout/stderr and include a
  stable correlation ID for every request.
- The CI workflow validates source quality, integration and browser behavior,
  production builds, and all three deployment images.
- The two stable CI job names are intended as required checks in the GitHub
  ruleset for `main`. GitHub Free does not permit rulesets for this private
  repository, so releases verify both checks manually until the plan changes.

## Consequences

- A failed migration prevents a broken API deployment from becoming ready.
- Railway can index log fields without a vendor-specific logging SDK.
- Deployment artifacts are locally and continuously reproducible.
- Horizontal API scaling requires replacing the startup migration with a
  dedicated Railway pre-deploy or migration job.
- Railway project linking, domains, secrets and GitHub ruleset activation remain
  controlled account operations documented in the deployment runbook.

## Implementation Status (2026-08-31)

- Railway Hobby is active and the account-side Production project is named
  `dartbase` in the `BitWhatElse Projects` workspace.
- Its `production` environment contains successfully deployed Web, API, Worker,
  PostgreSQL and Redis services.
- Cyon remains the registrar for `dartbase.ch`; the authoritative DNS zone is
  active on Cloudflare.
- Cloudflare reports the zone as active. The apex and wildcard certificates are
  valid. The API custom domain is attached to the API service through an exact
  Cloudflare CNAME and its dedicated verification TXT record. Its Railway
  certificate is valid, and the public Web and API smoke tests pass.
- The checked-in IaC mirrors the account-side project, including the Worker,
  domains, persistent volumes and preserved variables. The controlled
  Production plan reports no changes; the verification procedure is tracked in
  the [Railway runbook](../../infrastructure/railway.md).
