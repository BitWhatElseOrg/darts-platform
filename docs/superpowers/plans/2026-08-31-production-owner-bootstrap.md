# Production Owner Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create exactly one auditable Production OWNER invitation without a public bypass, stored password, or manual SQL mutation.

**Architecture:** A CLI-only operation validates explicit production inputs, takes a PostgreSQL advisory lock, verifies an empty or exact resumable state, and transactionally creates a non-login system principal, the first organization, an OWNER invitation, and an audit event. The public invitation write schema remains unable to grant OWNER.

**Tech Stack:** TypeScript, Zod, Drizzle ORM, PostgreSQL, Better Auth, Vitest, Railway SSH

**Spec:** `docs/superpowers/specs/2026-08-31-production-bootstrap-release-hardening-design.md`

## Global Constraints

- The bootstrap has no HTTP route and is never called by API startup.
- Execution requires `NODE_ENV=production` and `ALLOW_PRODUCTION_BOOTSTRAP=true` before database access.
- The system principal email is exactly `production-bootstrap@system.dartbase.invalid`.
- The system principal must have no account, session, or membership.
- Normal invitations continue to reject `OWNER` at the input boundary.
- Existing migrations are immutable; generate migration `0012_production_bootstrap_owner_invitation.sql`.
- No credential, `DATABASE_URL`, auth secret, or password may be logged.
- Every database mutation and audit row commits in one transaction.

---

### Task 1: Permit stored OWNER invitations while keeping public writes narrow

**Files:**
- Modify: `packages/database/src/schema.ts`
- Modify: `packages/database/src/client.integration.spec.ts`
- Modify: `packages/schemas/src/organization.ts`
- Create: `packages/schemas/src/organization.spec.ts`
- Create: `packages/database/drizzle/0012_production_bootstrap_owner_invitation.sql`
- Create: `packages/database/drizzle/meta/0012_snapshot.json`
- Modify: `packages/database/drizzle/meta/_journal.json`

**Interfaces:**
- Consumes: existing `organizationRoleSchema`, `invitableOrganizationRoleSchema`, and invitation table.
- Produces: invitation read models accepting all organization roles while `createInvitationSchema` still accepts only invitable non-owner roles.

- [ ] **Step 1: Write failing schema tests**

Add to `organization.spec.ts`:

```ts
import { createInvitationSchema, invitationSchema } from "./organization.js";

it("reads the internal owner bootstrap invitation", () => {
  expect(invitationSchema.parse({
    id: crypto.randomUUID(),
    organizationId: crypto.randomUUID(),
    email: "owner@example.ch",
    role: "OWNER",
    status: "PENDING",
    expiresAt: new Date(),
  }).role).toBe("OWNER");
});

it("does not let the regular invitation API grant owner", () => {
  expect(createInvitationSchema.safeParse({
    email: "owner@example.ch",
    role: "OWNER",
  }).success).toBe(false);
});
```

- [ ] **Step 2: Run the schema test and confirm RED**

Run: `pnpm --filter @darts-platform/schemas test -- src/organization.spec.ts`

Expected: the read-model test fails because `invitationSchema.role` uses `invitableOrganizationRoleSchema`.

- [ ] **Step 3: Widen only the invitation read model**

Keep this unchanged:

```ts
export const createInvitationSchema = z.object({
  email: z.email().trim().toLowerCase(),
  role: invitableOrganizationRoleSchema,
});
```

Change only the stored/read model:

```ts
export const invitationSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  organizationName: z.string().optional(),
  email: z.email(),
  role: organizationRoleSchema,
  status: z.enum(["PENDING", "ACCEPTED", "CANCELLED", "EXPIRED"]),
  expiresAt: z.coerce.date(),
});
```

- [ ] **Step 4: Change the Drizzle check definition**

In `schema.ts`, set:

```ts
check(
  "organization_invitations_role_check",
  sql`${table.role} in ('OWNER', 'ADMIN', 'TOURNAMENT_DIRECTOR', 'SCORER', 'MEMBER', 'VIEWER')`,
),
```

Extend `client.integration.spec.ts` to query `organization_invitations_role_check` and assert its definition contains `OWNER`.

- [ ] **Step 5: Generate and inspect the immutable migration**

Run:

```bash
pnpm --filter @darts-platform/database exec drizzle-kit generate --config=drizzle.config.ts --name=production_bootstrap_owner_invitation
```

Expected generated file: `packages/database/drizzle/0012_production_bootstrap_owner_invitation.sql`.

The SQL must only drop and recreate `organization_invitations_role_check` with the expanded role set. Inspect the snapshot predecessor and journal entry; do not hand-edit older migrations or snapshots.

- [ ] **Step 6: Apply locally and run focused tests**

```bash
pnpm db:migrate
pnpm --filter @darts-platform/schemas test -- src/organization.spec.ts
pnpm --filter @darts-platform/database test -- src/client.integration.spec.ts
```

Expected: migration succeeds; both tests PASS.

- [ ] **Step 7: Commit schema and migration**

```bash
git add packages/database/src/schema.ts packages/database/src/client.integration.spec.ts packages/database/drizzle/0012_production_bootstrap_owner_invitation.sql packages/database/drizzle/meta/0012_snapshot.json packages/database/drizzle/meta/_journal.json packages/schemas/src/organization.ts packages/schemas/src/organization.spec.ts
git commit -m "feat: support owner bootstrap invitations"
```

---

### Task 2: Make database migration callable for isolated integration databases

**Files:**
- Modify: `packages/database/src/migrate.ts`
- Modify: `packages/database/src/index.ts`
- Create: `packages/database/src/migrate.spec.ts`

**Interfaces:**
- Produces: `migrateDatabase(databaseUrl: string, migrationsFolder?: string): Promise<void>`.
- Preserves: direct execution of `dist/migrate.js` for deployment startup.

- [ ] **Step 1: Write the failing export test**

```ts
import { describe, expect, it } from "vitest";
import { migrateDatabase } from "./index.js";

describe("database migration API", () => {
  it("exports the isolated migration runner", () => {
    expect(migrateDatabase).toBeTypeOf("function");
  });
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm --filter @darts-platform/database test -- src/migrate.spec.ts`

Expected: FAIL because `migrateDatabase` is not exported.

- [ ] **Step 3: Refactor without changing deployment semantics**

Implement:

```ts
export async function migrateDatabase(
  databaseUrl: string,
  migrationsFolder = "./drizzle",
): Promise<void> {
  const migrationClient = postgres(databaseUrl, { max: 1, onnotice: logNotice });
  try {
    await migrate(drizzle(migrationClient), { migrationsFolder });
  } finally {
    await migrationClient.end({ timeout: 5 });
  }
}
```

Keep the existing structured log events in the CLI wrapper. Guard direct execution with an `import.meta.url` comparison and call `migrateDatabase(requireDatabaseUrl())`; importing the function in tests must not read `process.env` or run migrations.

Export it from `packages/database/src/index.ts`.

- [ ] **Step 4: Run database build and tests**

```bash
pnpm --filter @darts-platform/database test
pnpm --filter @darts-platform/database typecheck
pnpm --filter @darts-platform/database build
```

Expected: all PASS, and `pnpm db:migrate` still exits 0 against the local database.

- [ ] **Step 5: Commit the migration API**

```bash
git add packages/database/src/migrate.ts packages/database/src/migrate.spec.ts packages/database/src/index.ts
git commit -m "refactor: expose isolated migration runner"
```

---

### Task 3: Implement the guarded bootstrap transaction

**Files:**
- Create: `apps/api/src/operations/production-bootstrap.ts`
- Create: `apps/api/src/operations/production-bootstrap.spec.ts`
- Create: `apps/api/src/testing/temporary-database.ts`

**Interfaces:**
- Produces: `parseProductionBootstrapInput(environment): ProductionBootstrapInput`.
- Produces: `assertProductionBootstrapAllowed({ nodeEnv, allowProduction }): void`.
- Produces: `bootstrapProductionOwner(database, input, now?): Promise<ProductionBootstrapResult>`.
- Result status is `created | pending | already-complete` and includes `organizationId`, `organizationSlug`, `ownerEmail`, and `expiresAt`.

- [ ] **Step 1: Write failing guard and parser tests**

```ts
describe("production bootstrap guard", () => {
  it.each([
    { nodeEnv: "development", allowProduction: true },
    { nodeEnv: "production", allowProduction: false },
  ])("rejects $nodeEnv / $allowProduction", (input) => {
    expect(() => assertProductionBootstrapAllowed(input)).toThrow();
  });

  it("normalizes the owner and organization inputs", () => {
    expect(parseProductionBootstrapInput({
      BOOTSTRAP_OWNER_EMAIL: " OWNER@EXAMPLE.CH ",
      BOOTSTRAP_ORGANIZATION_NAME: " Dart Club ",
      BOOTSTRAP_ORGANIZATION_SLUG: "dart-club",
    })).toMatchObject({
      ownerEmail: "owner@example.ch",
      organizationName: "Dart Club",
      organizationSlug: "dart-club",
      timezone: "Europe/Zurich",
      locale: "de-CH",
    });
  });
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm --filter @darts-platform/api test -- src/operations/production-bootstrap.spec.ts`

Expected: FAIL because the production-bootstrap module does not exist.

- [ ] **Step 3: Implement exact runtime validation and result types**

Use Zod with `createOrganizationSchema.shape` and define:

```ts
export const PRODUCTION_BOOTSTRAP_USER_EMAIL =
  "production-bootstrap@system.dartbase.invalid";

export interface ProductionBootstrapInput {
  readonly ownerEmail: string;
  readonly organizationName: string;
  readonly organizationSlug: string;
  readonly timezone: string;
  readonly locale: string;
}

export interface ProductionBootstrapResult {
  readonly status: "created" | "pending" | "already-complete";
  readonly organizationId: string;
  readonly organizationSlug: string;
  readonly ownerEmail: string;
  readonly expiresAt: Date | null;
}
```

The guard throws before the database function is called unless `nodeEnv === "production"` and `allowProduction === true`.

- [ ] **Step 4: Build a temporary migrated database helper for integration tests**

`temporary-database.ts` must:

1. derive an admin URL from the test `DATABASE_URL` with pathname `/postgres`;
2. create a validated database name `dartbase_bootstrap_<32 lowercase hex>`;
3. run `migrateDatabase(isolatedUrl, migrationsFolder)` against it;
4. return its `DatabaseConnection` and an async cleanup;
5. cleanup closes clients and executes `drop database <validated name> with (force)` in `finally`.

Construct `migrationsFolder` with:

```ts
fileURLToPath(new URL("../../../../packages/database/drizzle", import.meta.url))
```

Only interpolate the generated name after validating `/^dartbase_bootstrap_[a-f0-9]{32}$/u`.

- [ ] **Step 5: Write failing transaction integration tests**

Against a fresh temporary database, assert:

```ts
const first = await bootstrapProductionOwner(database, input, now);
const second = await bootstrapProductionOwner(database, input, now);
expect(first.status).toBe("created");
expect(second.status).toBe("pending");
expect(await database.select().from(organizations)).toHaveLength(1);
expect(await database.select().from(organizationInvitations)).toHaveLength(1);
expect(await database.select().from(auditEvents)).toHaveLength(1);
```

Also query the system user and assert zero matching rows in `accounts`, `sessions`, and `memberships`. Add tests for:

- a foreign active membership causing `BOOTSTRAP_ALREADY_INITIALIZED` with no new rows;
- a mismatched organization causing rollback;
- an expired exact invitation becoming `EXPIRED` and one new `PENDING` invitation being created;
- the exact owner membership returning `already-complete` without writes;
- two concurrent calls producing one effective pending invitation.

- [ ] **Step 6: Implement the transaction in the tested order**

Inside `database.transaction`:

```ts
await transaction.execute(sql`
  select pg_advisory_xact_lock(hashtextextended('dartbase:production-bootstrap', 0))
`);
```

Then read and validate the entire allowed state before inserting anything. The only allowed human user is `input.ownerEmail` without a membership. Insert or verify the system user, insert or verify the organization, reuse/renew the exact invitation, and insert:

```ts
await transaction.insert(auditEvents).values({
  organizationId: organization.id,
  actorUserId: bootstrapUser.id,
  action: "PRODUCTION_BOOTSTRAP_INVITATION_CREATED",
  entityType: "OrganizationInvitation",
  entityId: invitation.id,
  newValue: {
    email: input.ownerEmail,
    role: "OWNER",
    expiresAt: invitation.expiresAt,
  },
  ip: "127.0.0.1",
  userAgent: "production-bootstrap-cli",
  correlationId: randomUUID(),
});
```

Do not create Better Auth accounts, sessions, passwords, or memberships.

- [ ] **Step 7: Run focused tests and confirm GREEN**

```bash
pnpm --filter @darts-platform/api test -- src/operations/production-bootstrap.spec.ts
pnpm --filter @darts-platform/api typecheck
```

Expected: all guard and isolated-database tests PASS.

- [ ] **Step 8: Commit the transaction**

```bash
git add apps/api/src/operations/production-bootstrap.ts apps/api/src/operations/production-bootstrap.spec.ts apps/api/src/testing/temporary-database.ts
git commit -m "feat: add guarded production owner bootstrap"
```

---

### Task 4: Add the CLI entrypoint and onboarding acceptance test

**Files:**
- Create: `apps/api/src/operations/bootstrap-production.ts`
- Modify: `apps/api/package.json`
- Modify: `package.json`
- Modify: `apps/api/src/auth/auth.integration.spec.ts`

**Interfaces:**
- Consumes: the guard, parser, and bootstrap transaction from Task 3.
- Produces: API script `bootstrap:production` and root script `db:bootstrap:production`.

- [ ] **Step 1: Write the failing end-to-end auth integration case**

In an isolated database, run the bootstrap, create Better Auth against that database, register `input.ownerEmail`, list pending invitations through `OrganizationsService`, accept it, and assert:

```ts
expect(pending).toHaveLength(1);
expect(pending[0]).toMatchObject({ role: "OWNER", email: input.ownerEmail });
await organizationsService.acceptInvitation({
  invitationId: pending[0].id,
  auth,
  audit,
});
expect(await repository.getActiveMembership({
  organizationId: bootstrap.organizationId,
  userId: auth.user.id,
})).toEqual({ role: "OWNER" });
```

Also assert `createInvitationSchema.safeParse({ email: input.ownerEmail, role: "OWNER" }).success === false`.

- [ ] **Step 2: Add the CLI entrypoint**

The entrypoint must:

```ts
const environment = parseApplicationEnvironment(process.env);
assertProductionBootstrapAllowed({
  nodeEnv: environment.NODE_ENV,
  allowProduction: process.env.ALLOW_PRODUCTION_BOOTSTRAP === "true",
});
const input = parseProductionBootstrapInput(process.env);
const connection = createDatabaseConnection(environment.DATABASE_URL);
try {
  const result = await bootstrapProductionOwner(connection.database, input);
  process.stdout.write(`${JSON.stringify({
    event: "production_bootstrap_completed",
    ...result,
  })}\n`);
} finally {
  await connection.close();
}
```

On error, output only event name, safe error code/message, and no environment dump or stack in production.

- [ ] **Step 3: Add package scripts**

API:

```json
"bootstrap:production": "node dist/operations/bootstrap-production.js"
```

Root:

```json
"db:bootstrap:production": "pnpm --filter @darts-platform/api bootstrap:production"
```

The command intentionally requires a prior API build; Railway runs the compiled artifact.

- [ ] **Step 4: Run auth, bootstrap, build, and secret-output tests**

```bash
pnpm --filter @darts-platform/api test -- src/auth/auth.integration.spec.ts src/operations/production-bootstrap.spec.ts
pnpm build:api
NODE_ENV=development ALLOW_PRODUCTION_BOOTSTRAP=true pnpm db:bootstrap:production
```

Expected: tests/build PASS; the final command exits non-zero before DB access with a safe production-only message and prints no `DATABASE_URL`.

- [ ] **Step 5: Commit CLI and auth acceptance**

```bash
git add apps/api/src/operations/bootstrap-production.ts apps/api/package.json package.json apps/api/src/auth/auth.integration.spec.ts
git commit -m "feat: expose production bootstrap command"
```

---

### Task 5: Document the security decision and operator runbook

**Files:**
- Create: `docs/adr/0012-production-owner-bootstrap.md`
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`
- Modify: `infrastructure/railway.md`
- Modify: `.railway/README.md`

**Interfaces:**
- Consumes: exact command and guards from Tasks 3-4.
- Produces: one auditable operator procedure with no manual SQL fallback.

- [ ] **Step 1: Write ADR 0012**

Record context, selected system-principal invitation design, rejected temporary-password/public-endpoint/manual-SQL alternatives, security properties, persistence of the non-login principal, and the fact that normal API invitations still reject OWNER.

- [ ] **Step 2: Update command and Railway execution docs**

Document these exact required variables and no others:

```text
ALLOW_PRODUCTION_BOOTSTRAP=true
BOOTSTRAP_OWNER_EMAIL
BOOTSTRAP_ORGANIZATION_NAME
BOOTSTRAP_ORGANIZATION_SLUG
BOOTSTRAP_TIMEZONE (optional, Europe/Zurich)
BOOTSTRAP_LOCALE (optional, de-CH)
```

State that execution happens once through Railway SSH using the compiled API image, the key is removed immediately, and reruns return `pending` or `already-complete` only for the exact expected state.

- [ ] **Step 3: Remove the obsolete runbook blocker**

Replace the paragraph claiming no bootstrap exists with the CLI sequence and readback expectations. Keep the authenticated UI smoke-test list.

- [ ] **Step 4: Verify docs and commit**

Run:

```bash
rg -n "bootstrap|OWNER|checkSuites" README.md ARCHITECTURE.md infrastructure/railway.md .railway/README.md docs/adr/0012-production-owner-bootstrap.md
git diff --check
```

Then commit:

```bash
git add docs/adr/0012-production-owner-bootstrap.md README.md ARCHITECTURE.md infrastructure/railway.md .railway/README.md
git commit -m "docs: document production owner bootstrap"
```

---

### Task 6: Full bootstrap verification and review

**Files:**
- Review: every file changed by Tasks 1-5

**Interfaces:**
- Consumes: complete bootstrap implementation.
- Produces: a migration-safe, reviewed feature ready for the Railway rollout plan.

- [ ] **Step 1: Run the mandatory gates**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Expected: every command exits 0.

- [ ] **Step 2: Build all deployment images**

```bash
docker build -f Dockerfile.api -t darts-platform-api:v0.1.0-rc .
docker build -f Dockerfile.web -t darts-platform-web:v0.1.0-rc .
docker build -f Dockerfile.worker -t darts-platform-worker:v0.1.0-rc .
```

Expected: all image builds exit 0 and API image contains `apps/api/dist/operations/bootstrap-production.js`.

- [ ] **Step 3: Run security and independent code review**

The security diff must explicitly cover the widened DB role constraint, unchanged public input schema, bootstrap guards, invariant checks, system-principal non-login state, safe logging, and CLI-only reachability. Any reportable finding or Critical/Important code-review issue blocks rollout.
