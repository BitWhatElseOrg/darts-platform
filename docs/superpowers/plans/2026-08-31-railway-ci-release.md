# Railway CI-Gated v0.1.0 Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the reviewed release to Railway only after successful GitHub checks, bootstrap the first owner, complete production smoke tests, and publish immutable release `v0.1.0`.

**Architecture:** Railway IaC enables check-suite gating for web, API, and worker. The exact Production plan is separately approved before apply; after a fast-forward push, GitHub CI and all Railway deployments are polled to terminal success before a one-time SSH bootstrap and release tag.

**Tech Stack:** Railway IaC/CLI, GitHub Actions/CLI, Cloudflare DNS, Docker, curl, Git

**Spec:** `docs/superpowers/specs/2026-08-31-production-bootstrap-release-hardening-design.md`

## Global Constraints

- Do not apply a Railway plan containing changes until the user approves the exact plan.
- Do not report a detached or queued deployment as successful.
- Do not push if the worktree is dirty, local gates fail, or `origin/main` moved.
- Do not expose bootstrap email values beyond the operator command and safe bootstrap result.
- Remove the temporary Railway SSH key immediately after bootstrap.
- Do not create tag/release `v0.1.0` until CI, Railway, bootstrap, authenticated UI, health, domains, and certificates are verified.
- Railway production project is `b72b141e-1685-44d7-960e-06c6b3998b34`; environment is `94bb1675-f688-40e0-a403-e62807715120`.

---

### Task 1: Enable Railway check-suite gating in source

**Files:**
- Modify: `.railway/railway.ts`
- Modify: `infrastructure/railway.md`
- Modify: `.railway/README.md`

**Interfaces:**
- Consumes: existing GitHub source definition shared by web, API, and worker.
- Produces: all three services configured with `checkSuites: true`.

- [ ] **Step 1: Change the shared GitHub source**

```ts
const source = github(repository, {
  branch: "main",
  checkSuites: true,
});
```

If the current file defines the source inline for each service, update each occurrence instead; the desired graph must show `true` three times.

- [ ] **Step 2: Update the runbooks**

Remove language saying Railway deploys with checks disabled. Document that GitHub Free still lacks protected required-check rules for this private repository, but Railway itself waits for successful check suites before deploying the tracked commit.

- [ ] **Step 3: Run static verification**

```bash
pnpm lint
pnpm typecheck
git diff --check
rg -n "checkSuites" .railway/railway.ts infrastructure/railway.md .railway/README.md
```

Expected: commands PASS; code shows `checkSuites: true`; docs no longer claim automatic unchecked deployment.

- [ ] **Step 4: Commit the desired gate**

```bash
git add .railway/railway.ts infrastructure/railway.md .railway/README.md
git commit -m "chore: gate Railway deploys on CI"
```

---

### Task 2: Preview and separately approve the Production IaC change

**Files:**
- Read: `.railway/railway.ts`
- External read/write: Railway Production configuration

**Interfaces:**
- Consumes: committed desired graph from Task 1.
- Produces: approved staged Railway patch changing only three `checkSuites` values from `false` to `true`.

- [ ] **Step 1: Generate the exact plan**

```bash
RAILWAY_CALLER=skill:use-railway@1.3.7 \
RAILWAY_AGENT_SESSION=railway-skill-20260831-release \
railway config plan --json
```

Expected: exactly three non-destructive source changes, one each for `@darts-platform/web`, `@darts-platform/api`, and `@darts-platform/worker`; no resource deletion, domain change, volume change, variable change, or database replacement.

- [ ] **Step 2: Stop and obtain explicit user approval**

Show the service names, old/new `checkSuites` values, staged patch ID when present, and the explicit absence of destructive changes. Do not apply in the same step.

- [ ] **Step 3: Apply only the approved patch**

After approval, use the exact apply command returned by the plan. Do not regenerate and silently apply a different plan. If Railway requires a fresh plan, show it again whenever its semantic changes differ.

- [ ] **Step 4: Read back the provider graph**

```bash
RAILWAY_CALLER=skill:use-railway@1.3.7 \
RAILWAY_AGENT_SESSION=railway-skill-20260831-release \
railway config plan --json
```

Expected: `changeSet.changes` is empty, diff is `No changes.`, and current graph shows `checkSuites: true` for all three GitHub services.

---

### Task 3: Re-run release gates on the exact commit

**Files:**
- Review: complete `origin/main..HEAD` range

**Interfaces:**
- Consumes: completed concurrency, bootstrap, and Railway gate plans.
- Produces: a clean, immutable release candidate commit.

- [ ] **Step 1: Verify repository state**

```bash
git status --short
git diff --check
git fetch origin main
git rev-list --left-right --count origin/main...HEAD
```

Expected: clean status, no whitespace errors, and left count `0`.

- [ ] **Step 2: Run the mandatory gates**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Expected: all exit 0. Integration tests must reach local PostgreSQL and Redis; rerun outside the sandbox if local socket policy blocks them.

- [ ] **Step 3: Build deployment artifacts**

```bash
docker build -f Dockerfile.api -t darts-platform-api:v0.1.0-rc .
docker build -f Dockerfile.web -t darts-platform-web:v0.1.0-rc .
docker build -f Dockerfile.worker -t darts-platform-worker:v0.1.0-rc .
```

Expected: all exit 0.

- [ ] **Step 4: Complete UI, security, and code review**

Run the Impeccable audit for `apps/web`, a complete Codex Security diff scan for `origin/main..HEAD`, self-review the full diff, and request independent code review. Any UI P0/P1, reportable security finding, or Critical/Important code-review issue blocks the push.

---

### Task 4: Push and monitor GitHub CI

**Files:**
- External write: GitHub `main`

**Interfaces:**
- Consumes: exact reviewed HEAD from Task 3.
- Produces: fast-forwarded remote main with the `CI` workflow and both jobs successful.

- [ ] **Step 1: Capture and push the immutable candidate**

```bash
release_sha="$(git rev-parse HEAD)"
git push origin main
```

Record the full SHA as `release_sha`. If push is not a fast-forward, stop and inspect; do not force-push.

- [ ] **Step 2: Locate workflow runs for `release_sha`**

```bash
gh run list --commit "$release_sha" --json databaseId,name,status,conclusion,headSha,url
```

Expected: exactly the `CI` workflow tied to the exact SHA.

- [ ] **Step 3: Watch every run to terminal success**

For the returned `CI` database ID:

```bash
gh run watch "$run_id" --exit-status
```

Then read back the jobs:

```bash
gh run view "$run_id" --json status,conclusion,headSha,jobs,url
```

Expected successful jobs are `Phase 0 quality gate` and `Deployment artifacts`. On failure, inspect with `gh run view "$run_id" --log-failed`, fix in a new commit, rerun all relevant local gates, and repeat from Task 3. Do not proceed on canceled, skipped, neutral, or missing runs.

---

### Task 5: Monitor all Railway deployments to SUCCESS

**Files:**
- External read: Railway Production deployments and bounded logs

**Interfaces:**
- Consumes: successful GitHub checks for `release_sha`.
- Produces: web, API, and worker running the exact release commit.

- [ ] **Step 1: Poll each service explicitly**

```bash
railway deployment list --project b72b141e-1685-44d7-960e-06c6b3998b34 --environment 94bb1675-f688-40e0-a403-e62807715120 --service @darts-platform/web --limit 3 --json
railway deployment list --project b72b141e-1685-44d7-960e-06c6b3998b34 --environment 94bb1675-f688-40e0-a403-e62807715120 --service @darts-platform/api --limit 3 --json
railway deployment list --project b72b141e-1685-44d7-960e-06c6b3998b34 --environment 94bb1675-f688-40e0-a403-e62807715120 --service @darts-platform/worker --limit 3 --json
```

Poll every 10-15 seconds while status is `QUEUED`, `INITIALIZING`, `WAITING`, `BUILDING`, or `DEPLOYING`. `NEEDS_APPROVAL` requires explicit human approval. Only `SUCCESS` is accepted.

- [ ] **Step 2: Triage any failure before continuing**

Fetch at most 200 bounded build/runtime log lines for the exact failed service. Never stream unbounded logs. Fix the root cause, create a new commit, and restart from Task 3.

- [ ] **Step 3: Verify deployed commit metadata**

For each newest successful deployment, verify its source commit equals `release_sha`. A successful deployment of an older commit does not satisfy this gate.

---

### Task 6: Bootstrap the first Production OWNER

**Files:**
- External write: Railway account SSH key and Production application data

**Interfaces:**
- Consumes: user-supplied owner email, organization name, and organization slug; compiled `db:bootstrap:production` command.
- Produces: one pending 48-hour OWNER invitation and audit record.

- [ ] **Step 1: Obtain exact non-secret bootstrap values from the user**

Request the owner email, organization display name, and lowercase hyphenated slug. Confirm timezone `Europe/Zurich` and locale `de-CH` unless the user supplies different valid values. Do not invent these identity values.

- [ ] **Step 2: Create and register an ephemeral SSH key**

```bash
release_ssh_dir="$(mktemp -d)"
ssh-keygen -q -t ed25519 -N '' -f "$release_ssh_dir/id_ed25519"
railway ssh keys add --key "$release_ssh_dir/id_ed25519.pub" --name dartbase-v0.1.0-bootstrap
```

Read back `railway ssh keys list` and record the exact temporary key ID.

- [ ] **Step 3: Run the compiled bootstrap inside the API container**

Use the user-supplied values exactly:

```bash
railway ssh \
  --project b72b141e-1685-44d7-960e-06c6b3998b34 \
  --environment 94bb1675-f688-40e0-a403-e62807715120 \
  --service @darts-platform/api \
  --identity-file "$release_ssh_dir/id_ed25519" \
  env \
  ALLOW_PRODUCTION_BOOTSTRAP=true \
  BOOTSTRAP_OWNER_EMAIL="$bootstrap_owner_email" \
  BOOTSTRAP_INVITATION_CLAIM_TOKEN="$bootstrap_invitation_claim_token" \
  BOOTSTRAP_ORGANIZATION_NAME="$bootstrap_organization_name" \
  BOOTSTRAP_ORGANIZATION_SLUG="$bootstrap_organization_slug" \
  BOOTSTRAP_TIMEZONE=Europe/Zurich \
  BOOTSTRAP_LOCALE=de-CH \
  pnpm db:bootstrap:production
```

Expected JSON event: `production_bootstrap_completed`, status `created` or exact idempotent `pending`, requested slug/email, and a non-null expiry. No password, invitation token, or database URL may appear. The owner uses the token during registration and invitation acceptance.

- [ ] **Step 4: Remove the temporary access immediately**

```bash
railway ssh keys remove "$temporary_key_id"
shred -u "$release_ssh_dir/id_ed25519" "$release_ssh_dir/id_ed25519.pub"
rmdir "$release_ssh_dir"
```

Read back the Railway key list and verify the temporary key ID is absent.

- [ ] **Step 5: Have the owner complete normal onboarding**

The owner registers at `https://dartbase.ch` with the exact invited email and a private password, signs in, opens pending invitations, and accepts the OWNER invitation. Do not request or handle the password.

---

### Task 7: Complete Production smoke tests

**Files:**
- External read/write: public web/API through normal user actions

**Interfaces:**
- Consumes: accepted OWNER membership.
- Produces: evidence that the first Production version is operational and tenant-safe.

- [ ] **Step 1: Verify unauthenticated health and domains**

```bash
curl --fail --show-error https://api.dartbase.ch/api/v1/health
curl --fail --show-error --head https://dartbase.ch/
```

Expected: HTTP 200; API JSON reports PostgreSQL and Redis `ok`.

Check Railway domain status for `dartbase.ch`, `*.dartbase.ch`, and `api.dartbase.ch`; every certificate must be valid.

- [ ] **Step 2: Execute the authenticated UI smoke test**

Using the owner's browser session:

1. verify organization and OWNER role;
2. create, edit, and archive a disposable player;
3. invite a second controlled email as VIEWER and accept it;
4. verify VIEWER cannot see tournament administration;
5. verify a tenant-foreign resource request returns 403/404 without data;
6. verify an unknown wildcard subdomain does not select another tenant or expose internal data.

Delete or archive only the explicitly created disposable smoke data through normal product actions; do not mutate Production with SQL.

- [ ] **Step 3: Inspect bounded error logs and health metrics**

Query the last 30 minutes for API/web/worker error-level logs and inspect CPU/memory summaries. Expected: no new unhandled exception, migration error, deadlock, or crash associated with the release.

---

### Task 8: Tag and publish v0.1.0

**Files:**
- External write: Git tag and GitHub Release

**Interfaces:**
- Consumes: all prior gates and exact `release_sha`.
- Produces: immutable annotated tag and published GitHub release.

- [ ] **Step 1: Reconfirm exact production revision and clean repository**

```bash
git status --short
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

Expected: clean worktree; local HEAD, remote main, and deployed source revision all equal `release_sha`.

- [ ] **Step 2: Create and push the annotated tag**

```bash
git tag -a v0.1.0 "$release_sha" -m "Dartbase v0.1.0"
git push origin v0.1.0
```

If the tag already exists, compare its object/revision and stop on any mismatch; never overwrite it.

- [ ] **Step 3: Create the GitHub Release**

```bash
gh release create v0.1.0 \
  --verify-tag \
  --title "Dartbase v0.1.0" \
  --notes-from-tag
```

Read back `gh release view v0.1.0 --json tagName,isDraft,isPrerelease,url,targetCommitish` and verify it is published, not draft/prerelease, and points to the release tag.

- [ ] **Step 4: Final release readback**

Repeat API health, web root, Railway service status, and newest deployment revision checks. Report the live URLs, release URL, commit SHA, migration success, bootstrap status, CI conclusions, Railway statuses, and any explicitly deferred external integration such as Sentry.
