# E-Mail-Versand (Einladung und Passwort-Reset) — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eingeladene Personen erhalten eine Mail mit einem Link, der die Registrierung mit vorbelegter Adresse und Code öffnet; wer sein Passwort vergisst, setzt es über einen Mail-Link zurück. Beides über einen einzigen, ausfallsicheren Versandweg.

**Architecture:** Die API schreibt einen Versandauftrag in die neue Tabelle `email_deliveries`, in derselben Transaktion wie die fachliche Änderung (Einladung) beziehungsweise im Better-Auth-Hook (Reset). Der Worker pollt die Tabelle im Sekundentakt, rendert das Template aus dem neuen infrastrukturfreien Paket `packages/notifications` und versendet über die Resend-HTTP-API mit der Zeilen-ID als `Idempotency-Key`. Retry, Backoff und Dead-Letter folgen dem bestehenden Outbox-Muster. Die Web-App erhält eine Einladungsseite, zwei Passwort-Seiten und den Zustellstatus in der Mitgliederliste.

**Tech Stack:** NestJS auf Fastify, Better Auth 1.7.1, Drizzle ORM auf PostgreSQL, Resend (HTTP, kein SDK), Next.js/React, TanStack Query, React Hook Form, Zod 4, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-20-email-versand-design.md`

## Global Constraints

- Tech-Stack-Vorgaben aus AGENTS.md: `strict: true`, kein `any`, `unknown` in `catch`, discriminated unions, exhaustive `switch`.
- `packages/notifications` importiert weder Drizzle noch NestJS noch Next.js noch `@darts-platform/config` oder `@darts-platform/database`; erlaubt sind `zod`, `@darts-platform/schemas` und das globale `fetch`.
- Neue Umgebungsvariablen: `EMAIL_PROVIDER` (`resend` | `log`, Vorgabe `log`), `RESEND_API_KEY` (Pflicht bei `resend`), `EMAIL_FROM` (Vorgabe `dartbase <noreply@dartbase.ch>`). Links entstehen aus `WEB_ORIGIN`.
- Resend: `POST https://api.resend.com/emails`, Header `Authorization: Bearer <key>`, `Content-Type: application/json`, `Idempotency-Key: <email_deliveries.id>`; Body-Felder `from`, `to` (Array), `subject`, `text`, `html`. Erfolg: `200 { "id": "..." }`. Timeout 10 Sekunden.
- Ergebnisabbildung des Adapters: 2xx → `sent`; 429, 409, 5xx, Netzwerkfehler, Timeout → `retryable`; jedes andere 4xx → `rejected`.
- Einladungslink: `{WEB_ORIGIN}/einladung/{invitationId}#code={claimToken}`. Der Code steht ausschliesslich im Fragment und im Request-Body, nie im Query-String.
- `email_deliveries.payload` wird nach erfolgreichem Versand und bei Dead-Letter auf `null` gesetzt. Check-Constraint: offen impliziert `payload is not null`.
- Retry-Konstanten wiederverwenden: `OUTBOX_MAX_ATTEMPTS` (8), `OUTBOX_BACKOFF_BASE_MS`, `OUTBOX_BACKOFF_CAP_MS` aus `packages/database/src/outbox.ts`. Stapelgrösse des Mail-Pollers 5.
- Erneut senden erzeugt einen neuen Code, ersetzt den Hash, setzt `expires_at` auf jetzt + 48 h. Nur für `status = 'PENDING'`.
- Fehlercodes: `INVITATION_NOT_FOUND` (404, Preview), `INVITATION_NOT_OPEN` (404, Resend). Öffentlicher Preview antwortet für alle Fehlerursachen identisch.
- Sensitives Rate-Limit für `POST /invitations/:id/preview`, `POST /organizations/:org/invitations/:id/resend` und `/api/v1/auth/request-password-reset` (Fastify-Stufe) sowie `/request-password-reset` in Better Auths `customRules`.
- Audit-Aktion `MEMBER_INVITATION_RESENT`.
- Worker-Log enthält keine Empfängeradressen und keine Links (Ausnahme: `LoggingEmailSender`, der als Provider `log` bewusst den Textkörper loggt).
- Deutsche Oberflächen- und Mailtexte, Schweizer Rechtschreibung, kein ß. Datumsformat TT.MM.JJJJ, Zeitzone Europe/Zurich.
- Migrationen ausschliesslich versioniert; `packages/database/drizzle/0034_email_deliveries.sql` plus Journal-Eintrag `idx: 34`.
- Kein `Co-Authored-By`-Trailer in Commits (CLAUDE.md).

## Dateistruktur

**Neu**

| Datei | Verantwortung |
|---|---|
| `packages/schemas/src/email-delivery.ts` | Zod-Schemas für `kind`, Payloads, Zustellstatus |
| `packages/notifications/package.json`, `tsconfig.json`, `tsconfig.build.json` | Paketgerüst |
| `packages/notifications/src/index.ts` | öffentliche Schnittstelle |
| `packages/notifications/src/email-message.ts` | `EmailMessage`, `RenderedEmail`, `EmailSendResult`, `EmailSender`, `EmailLogger` |
| `packages/notifications/src/html.ts` | `escapeHtml` |
| `packages/notifications/src/templates/invitation-email.ts` | `renderInvitationEmail` |
| `packages/notifications/src/templates/password-reset-email.ts` | `renderPasswordResetEmail` |
| `packages/notifications/src/templates/layout.ts` | gemeinsamer HTML-Rahmen und Fusszeile |
| `packages/notifications/src/render-email-delivery.ts` | `renderEmailDelivery(kind, payload)` |
| `packages/notifications/src/resend-email-sender.ts` | `ResendEmailSender` |
| `packages/notifications/src/logging-email-sender.ts` | `LoggingEmailSender` |
| `packages/notifications/src/create-email-sender.ts` | `createEmailSender` |
| `packages/database/src/email-deliveries.ts` | `enqueueEmailDelivery`, `emailDeliveryPending`, `markEmailDeliverySent`, `recordEmailDeliveryFailure` |
| `packages/database/drizzle/0034_email_deliveries.sql` | Migration |
| `apps/api/src/organizations/invitation-link.ts` | `buildInvitationUrl` |
| `apps/api/src/organizations/invitation-delivery.ts` | `describeInvitationDelivery` (Zeile → Status) |
| `apps/api/src/organizations/invitation-preview.controller.ts` | öffentlicher Preview-Endpunkt |
| `apps/worker/src/email/process-email-deliveries.ts` | Poller |
| `apps/worker/src/email/prune-email-deliveries.ts` | Aufräumregel |
| `apps/web/src/lib/invitation-link.ts` | `readInvitationCode`, `buildInvitationLink` |
| `apps/web/src/app/einladung/[invitationId]/page.tsx` | Route |
| `apps/web/src/components/invitation/invitation-route.tsx` | Einladungsseite |
| `apps/web/src/app/passwort/vergessen/page.tsx`, `apps/web/src/components/auth/forgot-password-route.tsx` | Passwort vergessen |
| `apps/web/src/app/passwort/neu/page.tsx`, `apps/web/src/components/auth/reset-password-route.tsx` | Neues Passwort |
| `apps/web/src/components/organization/invitation-delivery-badge.tsx` | Zustellstatus-Anzeige |
| `apps/web/tests/email-flows.spec.ts`, `apps/web/tests/password-reset-token.ts` | E2E |
| `docs/adr/0017-ausgehende-emails.md` | ADR |

**Geändert**

| Datei | Änderung |
|---|---|
| `packages/schemas/src/organization.ts`, `src/index.ts` | `lastDelivery`, Preview-Schemas, Exporte |
| `packages/config/src/environment.ts`, `environment.spec.ts` | drei Variablen, `superRefine` |
| `.env.example` | Variablen dokumentiert |
| `packages/database/src/schema.ts`, `src/index.ts`, `src/outbox.ts` | Tabelle, Exporte, `outboxBackoffMillisSql` exportieren |
| `packages/database/drizzle/meta/_journal.json` | Eintrag 34 |
| `DATABASE_SCHEMA.md` | Abschnitt `email_deliveries` |
| `apps/api/src/organizations/organizations.repository.ts` | Versandzeile beim Einladen, `resendInvitation`, `listInvitationsOfOrganization` mit Status, `previewInvitation` |
| `apps/api/src/organizations/organizations.service.ts`, `organizations.controller.ts`, `organizations.module.ts` | Resend, Preview |
| `apps/api/src/common/rate-limit.ts` | drei sensitive Muster |
| `apps/api/src/auth/auth.factory.ts` | `sendResetPassword`, `revokeSessionsOnPasswordReset`, `customRules` |
| `apps/worker/src/main.ts`, `package.json` | Poller und Prune verdrahten |
| `apps/web/src/components/players/invitation-form.tsx` | Text, Link anzeigen |
| `apps/web/src/components/organization/members-route.tsx` | Status, Erneut senden |
| `apps/web/src/components/auth-panel.tsx` | Link «Passwort vergessen?» |
| `apps/web/src/lib/api-client.ts` | zwei Fehlertexte |
| `package.json` (Root) | `test:e2e` baut `notifications` mit |
| `docs/adr/0010-invite-only-registration.md`, `infrastructure/railway.md` | Nachtrag, Betriebsabschnitt |

---

### Task 1: Schemas für Versandaufträge und Einladungsvorschau

**Files:**
- Create: `packages/schemas/src/email-delivery.ts`
- Modify: `packages/schemas/src/organization.ts`
- Modify: `packages/schemas/src/index.ts`
- Test: `packages/schemas/src/email-delivery.spec.ts`

**Interfaces:**
- Consumes: `organizationRoleSchema` aus `./organization`.
- Produces: `emailDeliveryKindSchema` (`"INVITATION" | "PASSWORD_RESET"`), `invitationEmailPayloadSchema`, `passwordResetEmailPayloadSchema`, Typen `EmailDeliveryKind`, `InvitationEmailPayload`, `PasswordResetEmailPayload`; in `organization.ts`: `invitationDeliveryStatusSchema`, `invitationSchema.lastDelivery` (nullable, optional), `invitationPreviewSchema`, `previewInvitationInputSchema`, Typen `InvitationDeliveryStatus`, `InvitationPreview`, `PreviewInvitationInput`.

- [ ] **Step 1: Write the failing test**

`packages/schemas/src/email-delivery.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  emailDeliveryKindSchema,
  invitationEmailPayloadSchema,
  passwordResetEmailPayloadSchema,
} from "./email-delivery";
import { invitationDeliveryStatusSchema, invitationSchema } from "./organization";

describe("emailDeliveryKindSchema", () => {
  it("kennt genau die beiden Auftragsarten", () => {
    expect(emailDeliveryKindSchema.options).toEqual(["INVITATION", "PASSWORD_RESET"]);
  });
});

describe("invitationEmailPayloadSchema", () => {
  it("nimmt den Ablauf als ISO-String entgegen und liefert ein Date", () => {
    const parsed = invitationEmailPayloadSchema.parse({
      organizationName: "Beispielverein",
      inviterName: "Alex Muster",
      role: "MEMBER",
      invitationUrl: "https://dartbase.example/einladung/abc#code=xyz",
      expiresAt: "2026-09-22T12:00:00.000Z",
    });
    expect(parsed.expiresAt).toBeInstanceOf(Date);
  });

  it("weist eine ungültige Rolle und eine Nicht-URL ab", () => {
    expect(
      invitationEmailPayloadSchema.safeParse({
        organizationName: "V",
        inviterName: "A",
        role: "KING",
        invitationUrl: "nicht-url",
        expiresAt: "2026-09-22T12:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("passwordResetEmailPayloadSchema", () => {
  it("verlangt eine Reset-URL", () => {
    expect(passwordResetEmailPayloadSchema.safeParse({ recipientName: "A" }).success).toBe(false);
    expect(
      passwordResetEmailPayloadSchema.parse({
        recipientName: "A",
        resetUrl: "https://api.dartbase.example/api/v1/auth/reset-password/t?callbackURL=x",
      }).resetUrl,
    ).toContain("reset-password");
  });
});

describe("invitationDeliveryStatusSchema", () => {
  it("unterscheidet ausstehend, versendet und fehlgeschlagen", () => {
    expect(invitationDeliveryStatusSchema.parse({ status: "pending" })).toEqual({ status: "pending" });
    expect(
      invitationDeliveryStatusSchema.parse({ status: "sent", sentAt: "2026-09-20T10:00:00.000Z" }).status,
    ).toBe("sent");
    expect(
      invitationDeliveryStatusSchema.parse({ status: "failed", failedAt: "2026-09-20T10:00:00.000Z" }).status,
    ).toBe("failed");
  });

  it("bleibt in invitationSchema optional, damit ältere Antworten weiter parsen", () => {
    const parsed = invitationSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      organizationId: "22222222-2222-4222-8222-222222222222",
      email: "gast@example.test",
      role: "MEMBER",
      status: "PENDING",
      expiresAt: "2026-09-22T12:00:00.000Z",
    });
    expect(parsed.lastDelivery).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/schemas && npx vitest run src/email-delivery.spec.ts`
Expected: FAIL — `Failed to resolve import "./email-delivery"`.

- [ ] **Step 3: Write minimal implementation**

`packages/schemas/src/email-delivery.ts`:

```ts
import { z } from "zod";

import { organizationRoleSchema } from "./organization";

/**
 * Arten von Versandaufträgen in `email_deliveries`. Der Worker wählt
 * anhand dieses Werts das Template; die Datenbank sichert ihn per
 * Check-Constraint (`email_deliveries_kind_check`).
 */
export const emailDeliveryKindSchema = z.enum(["INVITATION", "PASSWORD_RESET"]);

/**
 * Template-Eingaben der Einladungsmail. `invitationUrl` traegt den
 * Klartext-Code im Fragment; die Zeile wird nach dem Versand geleert.
 */
export const invitationEmailPayloadSchema = z.object({
  organizationName: z.string().min(1),
  inviterName: z.string(),
  role: organizationRoleSchema,
  invitationUrl: z.url(),
  expiresAt: z.coerce.date(),
});

/** Template-Eingaben der Reset-Mail; die URL stammt von Better Auth. */
export const passwordResetEmailPayloadSchema = z.object({
  recipientName: z.string(),
  resetUrl: z.url(),
});

export type EmailDeliveryKind = z.infer<typeof emailDeliveryKindSchema>;
export type InvitationEmailPayload = z.infer<typeof invitationEmailPayloadSchema>;
export type PasswordResetEmailPayload = z.infer<typeof passwordResetEmailPayloadSchema>;
```

In `packages/schemas/src/organization.ts` **vor** `invitationSchema` einfügen:

```ts
/**
 * Zustand der juengsten Zustellung einer Einladung. `pending`: Auftrag
 * liegt beim Worker; `sent`: Provider hat angenommen; `failed`: Dead-Letter
 * nach erschoepften Versuchen oder endgueltiger Ablehnung.
 */
export const invitationDeliveryStatusSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("sent"), sentAt: z.coerce.date() }),
  z.object({ status: z.literal("failed"), failedAt: z.coerce.date() }),
]);
```

`invitationSchema` um ein Feld ergänzen:

```ts
export const invitationSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  organizationName: z.string().optional(),
  email: z.email(),
  role: organizationRoleSchema,
  status: z.enum(["PENDING", "ACCEPTED", "CANCELLED", "EXPIRED"]),
  expiresAt: z.coerce.date(),
  /**
   * Juengste Zustellung, nur in der Organisationsliste gefuellt. `null`:
   * Einladung aus der Zeit vor dem Mailversand; fehlt: Antwort eines
   * Endpunkts, der den Status nicht liefert.
   */
  lastDelivery: invitationDeliveryStatusSchema.nullable().optional(),
});
```

**Nach** `acceptInvitationSchema` einfügen:

```ts
/** Body des oeffentlichen Vorschau-Endpunkts: nur der Code. */
export const previewInvitationInputSchema = z.object({
  claimToken: invitationClaimTokenSchema,
});

/**
 * Was die Einladungsseite vor der Registrierung anzeigen darf. Nur nach
 * erfolgreichem Hash-Vergleich; sonst antwortet der Server mit 404, ohne
 * die Ursache zu nennen.
 */
export const invitationPreviewSchema = z.object({
  organizationName: z.string(),
  role: organizationRoleSchema,
  email: z.email(),
  expiresAt: z.coerce.date(),
});
```

Typen am Dateiende ergänzen:

```ts
export type InvitationDeliveryStatus = z.infer<typeof invitationDeliveryStatusSchema>;
export type PreviewInvitationInput = z.infer<typeof previewInvitationInputSchema>;
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;
```

In `packages/schemas/src/index.ts` den Export-Block von `./organization` ergänzen um `invitationDeliveryStatusSchema`, `invitationPreviewSchema`, `previewInvitationInputSchema`, `type InvitationDeliveryStatus`, `type InvitationPreview`, `type PreviewInvitationInput`, und einen neuen Block anhängen:

```ts
export {
  emailDeliveryKindSchema,
  invitationEmailPayloadSchema,
  passwordResetEmailPayloadSchema,
  type EmailDeliveryKind,
  type InvitationEmailPayload,
  type PasswordResetEmailPayload,
} from "./email-delivery";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/schemas && npx vitest run src/email-delivery.spec.ts && pnpm typecheck`
Expected: PASS, Typecheck ohne Fehler.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/email-delivery.ts packages/schemas/src/email-delivery.spec.ts packages/schemas/src/organization.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): Schemas fuer Versandauftraege, Zustellstatus und Einladungsvorschau"
```

---

### Task 2: Umgebungsvariablen für den Mailversand

**Files:**
- Modify: `packages/config/src/environment.ts`
- Modify: `.env.example`
- Test: `packages/config/src/environment.spec.ts`

**Interfaces:**
- Produces: `ApplicationEnvironment.EMAIL_PROVIDER: "resend" | "log"`, `ApplicationEnvironment.RESEND_API_KEY: string | undefined`, `ApplicationEnvironment.EMAIL_FROM: string`.

- [ ] **Step 1: Write the failing test**

In `packages/config/src/environment.spec.ts` innerhalb `describe("parseApplicationEnvironment", ...)` anhängen:

```ts
  it("waehlt ohne Angabe den Log-Provider und den Standardabsender", () => {
    const environment = parseApplicationEnvironment(validEnvironment);
    expect(environment.EMAIL_PROVIDER).toBe("log");
    expect(environment.EMAIL_FROM).toBe("dartbase <noreply@dartbase.ch>");
    expect(environment.RESEND_API_KEY).toBeUndefined();
  });

  it("verlangt bei Provider resend einen API-Key", () => {
    expect(() =>
      parseApplicationEnvironment({ ...validEnvironment, EMAIL_PROVIDER: "resend" }),
    ).toThrow(/RESEND_API_KEY/u);

    const environment = parseApplicationEnvironment({
      ...validEnvironment,
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "re_test_123",
      EMAIL_FROM: "Verein <mail@verein.example>",
    });
    expect(environment.EMAIL_PROVIDER).toBe("resend");
    expect(environment.EMAIL_FROM).toBe("Verein <mail@verein.example>");
  });

  it("weist einen unbekannten Mail-Provider ab", () => {
    expect(() =>
      parseApplicationEnvironment({ ...validEnvironment, EMAIL_PROVIDER: "sendgrid" }),
    ).toThrow(EnvironmentValidationError);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/config && npx vitest run src/environment.spec.ts`
Expected: FAIL — `EMAIL_PROVIDER` ist `undefined`, `resend` wirft nicht.

- [ ] **Step 3: Write minimal implementation**

In `packages/config/src/environment.ts` im `z.object({...})` nach `LOG_CLIENT_ADDRESS` ergänzen:

```ts
  /**
   * Versandweg fuer ausgehende Mails (Spec 2026-09-20-email-versand).
   * `log` schreibt Empfaenger, Betreff und Text nur ins Log — Vorgabe fuer
   * Entwicklung, CI und E2E. `resend` verlangt `RESEND_API_KEY`, siehe
   * `superRefine`.
   */
  EMAIL_PROVIDER: z.enum(["resend", "log"]).default("log"),
  RESEND_API_KEY: z.string().min(1).optional(),
  /** Absender im Format `Anzeigename <adresse>`; die Domain ist bei Resend verifiziert. */
  EMAIL_FROM: z.string().min(3).default("dartbase <noreply@dartbase.ch>"),
```

Im bestehenden `superRefine((data, ctx) => { ... })` nach dem `TRUST_PROXY_HOPS`-Block ergänzen:

```ts
  if (data.EMAIL_PROVIDER === "resend" && data.RESEND_API_KEY === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["RESEND_API_KEY"],
      message: "RESEND_API_KEY muss gesetzt sein, wenn EMAIL_PROVIDER=resend ist.",
    });
  }
```

In `.env.example` vor `NEXT_PUBLIC_API_URL` einfügen:

```text
# Ausgehende Mails (Einladung, Passwort-Reset). Vorgabe log: nichts wird
# versendet, der Worker schreibt Empfaenger, Betreff und Text ins Log.
# Produktion/Staging: resend plus API-Key als Railway-Variable.
EMAIL_PROVIDER=log
# RESEND_API_KEY=re_...
EMAIL_FROM=dartbase <noreply@dartbase.ch>

```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/config && npx vitest run src/environment.spec.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/config/src/environment.ts packages/config/src/environment.spec.ts .env.example
git commit -m "feat(config): Umgebungsvariablen fuer den Mailversand"
```

---

### Task 3: Paket `notifications` — Typen, HTML-Escaping und Templates

**Files:**
- Create: `packages/notifications/package.json`, `packages/notifications/tsconfig.json`, `packages/notifications/tsconfig.build.json`
- Create: `packages/notifications/src/index.ts`, `src/email-message.ts`, `src/html.ts`, `src/templates/layout.ts`, `src/templates/invitation-email.ts`, `src/templates/password-reset-email.ts`
- Test: `packages/notifications/src/html.spec.ts`, `src/templates/invitation-email.spec.ts`, `src/templates/password-reset-email.spec.ts`

**Interfaces:**
- Consumes: `InvitationEmailPayload`, `PasswordResetEmailPayload` aus `@darts-platform/schemas`.
- Produces:
  - `interface RenderedEmail { readonly subject: string; readonly text: string; readonly html: string }`
  - `interface EmailMessage extends RenderedEmail { readonly to: string }`
  - `type EmailSendResult = { kind: "sent"; providerMessageId: string } | { kind: "retryable"; reason: string } | { kind: "rejected"; reason: string }`
  - `interface EmailSender { send(message: EmailMessage, idempotencyKey: string): Promise<EmailSendResult> }`
  - `interface EmailLogger { emit(level: "error" | "warn" | "log" | "debug", fields: Readonly<Record<string, unknown>>): void }`
  - `escapeHtml(value: string): string`
  - `renderInvitationEmail(input: InvitationEmailPayload): RenderedEmail`
  - `renderPasswordResetEmail(input: PasswordResetEmailPayload): RenderedEmail`

- [ ] **Step 1: Paketgerüst anlegen**

`packages/notifications/package.json`:

```json
{
  "name": "@darts-platform/notifications",
  "version": "0.0.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage --coverage.provider=v8 --coverage.reporter=text --coverage.reporter=json-summary"
  },
  "dependencies": {
    "@darts-platform/schemas": "workspace:*",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@vitest/coverage-v8": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

`packages/notifications/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "noEmit": true, "lib": ["ES2022", "DOM"] },
  "include": ["src/**/*.ts"]
}
```

(`DOM` liefert die Typen von `fetch`, `Response` und `AbortSignal.timeout`; das Paket läuft in Node 24, das dieselben Globals bereitstellt.)

`packages/notifications/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "declaration": true, "noEmit": false, "outDir": "dist", "sourceMap": false },
  "exclude": ["src/**/*.spec.ts"]
}
```

Run: `pnpm install`
Expected: Lockfile ergänzt, `packages/notifications` als Workspace erkannt.

- [ ] **Step 2: Write the failing tests**

`packages/notifications/src/html.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import { escapeHtml } from "./html.js";

describe("escapeHtml", () => {
  it("entschaerft die fuenf HTML-Sonderzeichen", () => {
    expect(escapeHtml(`<b>"Tom" & 'Jerry'</b>`)).toBe(
      "&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;",
    );
  });

  it("laesst normalen Text unveraendert", () => {
    expect(escapeHtml("Beispielverein Zürich")).toBe("Beispielverein Zürich");
  });
});
```

`packages/notifications/src/templates/invitation-email.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import { renderInvitationEmail } from "./invitation-email.js";

const input = {
  organizationName: "Beispielverein",
  inviterName: "Alex Muster",
  role: "SCORER" as const,
  invitationUrl: "https://dartbase.example/einladung/11111111-1111-4111-8111-111111111111#code=abc_DEF-123",
  expiresAt: new Date("2026-09-22T10:30:00.000Z"),
};

describe("renderInvitationEmail", () => {
  it("nennt Organisation, Rolle und Link im Betreff und im Text", () => {
    const email = renderInvitationEmail(input);
    expect(email.subject).toBe("Einladung zu Beispielverein auf DartBase");
    expect(email.text).toContain("Alex Muster");
    expect(email.text).toContain("Scorer");
    expect(email.text).toContain(input.invitationUrl);
    expect(email.html).toContain(`href="${input.invitationUrl}"`);
  });

  it("formatiert den Ablauf in Schweizer Schreibweise und Zeitzone Zürich", () => {
    const email = renderInvitationEmail(input);
    // 10:30 UTC ist im September 12:30 in Zürich (Sommerzeit).
    expect(email.text).toContain("22.09.2026, 12:30");
  });

  it("escaped Benutzereingaben im HTML", () => {
    const email = renderInvitationEmail({ ...input, organizationName: "<script>alert(1)</script>" });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });

  it("verzichtet auf den Namen der einladenden Person, wenn er leer ist", () => {
    const email = renderInvitationEmail({ ...input, inviterName: "" });
    expect(email.text).toContain("Du wurdest zu Beispielverein auf DartBase eingeladen");
    expect(email.text).not.toContain(" hat dich ");
  });

  it("traegt den Hinweis fuer unerwartete Mails", () => {
    expect(renderInvitationEmail(input).text).toContain("nicht erwartet");
  });
});
```

`packages/notifications/src/templates/password-reset-email.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import { renderPasswordResetEmail } from "./password-reset-email.js";

const input = {
  recipientName: "Alex Muster",
  resetUrl: "https://api.dartbase.example/api/v1/auth/reset-password/tok?callbackURL=https%3A%2F%2Fdartbase.example%2Fpasswort%2Fneu",
};

describe("renderPasswordResetEmail", () => {
  it("nennt den Link und die Gueltigkeit von einer Stunde", () => {
    const email = renderPasswordResetEmail(input);
    expect(email.subject).toBe("Passwort zurücksetzen auf DartBase");
    expect(email.text).toContain(input.resetUrl);
    expect(email.text).toContain("eine Stunde");
    expect(email.html).toContain(`href="${input.resetUrl}"`);
  });

  it("escaped den Namen im HTML", () => {
    const email = renderPasswordResetEmail({ ...input, recipientName: `Alex "Ace" <Muster>` });
    expect(email.html).toContain("Alex &quot;Ace&quot; &lt;Muster&gt;");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/notifications && npx vitest run`
Expected: FAIL — Module nicht gefunden.

- [ ] **Step 4: Write minimal implementation**

`packages/notifications/src/email-message.ts`:

```ts
/** Betreff, Text- und HTML-Variante einer Mail — ohne Empfaenger. */
export interface RenderedEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** Eine versandfertige Mail. `from` setzt der Adapter aus seiner Konfiguration. */
export interface EmailMessage extends RenderedEmail {
  readonly to: string;
}

/**
 * Ergebnis eines Versandversuchs. `retryable` heisst: spaeter noch einmal
 * (Provider ueberlastet, Netz weg); `rejected` heisst: nie wieder mit
 * diesem Inhalt (ungueltige Adresse, abgelehnter Absender).
 */
export type EmailSendResult =
  | { readonly kind: "sent"; readonly providerMessageId: string }
  | { readonly kind: "retryable"; readonly reason: string }
  | { readonly kind: "rejected"; readonly reason: string };

/** Port fuer den Versand; Adapter: Resend, Log. */
export interface EmailSender {
  send(message: EmailMessage, idempotencyKey: string): Promise<EmailSendResult>;
}

/** Schmale Log-Schnittstelle, damit das Paket ohne `@darts-platform/config` auskommt. */
export interface EmailLogger {
  emit(
    level: "error" | "warn" | "log" | "debug",
    fields: Readonly<Record<string, unknown>>,
  ): void;
}
```

`packages/notifications/src/html.ts`:

```ts
const replacements: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Entschaerft Benutzereingaben fuer die HTML-Variante einer Mail. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => replacements[character] ?? character);
}
```

`packages/notifications/src/templates/layout.ts`:

```ts
import { escapeHtml } from "../html.js";

export const IGNORE_HINT =
  "Wenn du diese Nachricht nicht erwartet hast, kannst du sie ignorieren.";

const SIGNATURE_TEXT = "DartBase · dartbase.ch";

/**
 * Datum und Uhrzeit fuer Mailtexte: TT.MM.JJJJ, HH:MM in Zuerich. Die
 * Zeitzone ist fest, weil Mails ohne Browser-Kontext gerendert werden.
 */
export function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat("de-CH", {
    timeZone: "Europe/Zurich",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

/** Textvariante: Absaetze, Link, Hinweis, Signatur. */
export function textLayout(paragraphs: readonly string[]): string {
  return [...paragraphs, IGNORE_HINT, SIGNATURE_TEXT].join("\n\n");
}

/**
 * HTML-Variante: eine schmale Spalte, Systemschrift, ein Button-Link.
 * Bewusst ohne Bilder, ohne externe Ressourcen, ohne Tracking. Alle
 * uebergebenen Absaetze muessen bereits escaped sein.
 */
export function htmlLayout(input: {
  readonly title: string;
  readonly paragraphsHtml: readonly string[];
  readonly action: { readonly label: string; readonly url: string };
}): string {
  const url = escapeHtml(input.action.url);
  return `<!doctype html>
<html lang="de">
<head><meta charset="utf-8"><title>${escapeHtml(input.title)}</title></head>
<body style="margin:0;padding:24px;background:#0f172a;color:#e2e8f0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;">
  <div style="max-width:560px;margin:0 auto;background:#1e293b;border-radius:16px;padding:32px;">
    <h1 style="margin:0 0 16px;font-size:22px;color:#ffffff;">${escapeHtml(input.title)}</h1>
    ${input.paragraphsHtml.map((paragraph) => `<p style="margin:0 0 16px;">${paragraph}</p>`).join("\n    ")}
    <p style="margin:24px 0;"><a href="${url}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#34d399;color:#052e16;font-weight:600;text-decoration:none;">${escapeHtml(input.action.label)}</a></p>
    <p style="margin:0 0 16px;font-size:14px;color:#94a3b8;">Falls der Button nicht funktioniert, kopiere diesen Link in den Browser:<br><span style="word-break:break-all;">${url}</span></p>
    <p style="margin:0 0 8px;font-size:14px;color:#94a3b8;">${escapeHtml(IGNORE_HINT)}</p>
    <p style="margin:0;font-size:14px;color:#94a3b8;">${escapeHtml(SIGNATURE_TEXT)}</p>
  </div>
</body>
</html>`;
}
```

`packages/notifications/src/templates/invitation-email.ts`:

```ts
import type { InvitationEmailPayload } from "@darts-platform/schemas";

import type { RenderedEmail } from "../email-message.js";
import { escapeHtml } from "../html.js";
import { formatDateTime, htmlLayout, textLayout } from "./layout.js";

const roleLabels: Readonly<Record<InvitationEmailPayload["role"], string>> = {
  OWNER: "Inhaber",
  ADMIN: "Administration",
  TOURNAMENT_DIRECTOR: "Turnierleitung",
  SCORER: "Scorer",
  MEMBER: "Mitglied",
  VIEWER: "Zuschauer",
};

/**
 * Einladungsmail. Der Link traegt den Code im Fragment; die Mail nennt den
 * Ablauf, damit niemand einem toten Link hinterherlaeuft.
 */
export function renderInvitationEmail(input: InvitationEmailPayload): RenderedEmail {
  const role = roleLabels[input.role];
  const inviter = input.inviterName.trim();
  const intro =
    inviter.length > 0
      ? `${inviter} hat dich zu ${input.organizationName} auf DartBase eingeladen, als ${role}.`
      : `Du wurdest zu ${input.organizationName} auf DartBase eingeladen, als ${role}.`;
  const expiry = `Die Einladung gilt bis ${formatDateTime(input.expiresAt)}.`;
  const instruction =
    "Öffne den folgenden Link, um dein Konto zu erstellen oder die Einladung mit deinem bestehenden Konto anzunehmen:";

  return {
    subject: `Einladung zu ${input.organizationName} auf DartBase`,
    text: textLayout([intro, instruction, input.invitationUrl, expiry]),
    html: htmlLayout({
      title: `Einladung zu ${input.organizationName}`,
      paragraphsHtml: [escapeHtml(intro), escapeHtml(instruction), escapeHtml(expiry)],
      action: { label: "Einladung öffnen", url: input.invitationUrl },
    }),
  };
}
```

`packages/notifications/src/templates/password-reset-email.ts`:

```ts
import type { PasswordResetEmailPayload } from "@darts-platform/schemas";

import type { RenderedEmail } from "../email-message.js";
import { escapeHtml } from "../html.js";
import { htmlLayout, textLayout } from "./layout.js";

/** Reset-Mail. Die Gueltigkeit von einer Stunde ist Better Auths Vorgabe. */
export function renderPasswordResetEmail(input: PasswordResetEmailPayload): RenderedEmail {
  const name = input.recipientName.trim();
  const greeting = name.length > 0 ? `Hallo ${name}` : "Hallo";
  const intro = `${greeting}, für dein DartBase-Konto wurde ein neues Passwort angefordert.`;
  const instruction = "Öffne den folgenden Link, um ein neues Passwort zu setzen. Er ist eine Stunde gültig:";

  return {
    subject: "Passwort zurücksetzen auf DartBase",
    text: textLayout([intro, instruction, input.resetUrl]),
    html: htmlLayout({
      title: "Passwort zurücksetzen",
      paragraphsHtml: [escapeHtml(intro), escapeHtml(instruction)],
      action: { label: "Neues Passwort setzen", url: input.resetUrl },
    }),
  };
}
```

`packages/notifications/src/index.ts` (wird in Task 4 erweitert):

```ts
export {
  type EmailLogger,
  type EmailMessage,
  type EmailSender,
  type EmailSendResult,
  type RenderedEmail,
} from "./email-message.js";
export { escapeHtml } from "./html.js";
export { renderInvitationEmail } from "./templates/invitation-email.js";
export { renderPasswordResetEmail } from "./templates/password-reset-email.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @darts-platform/schemas build && cd packages/notifications && npx vitest run && pnpm typecheck`
Expected: PASS. (Der Build von `schemas` ist nötig, weil das Paket über `dist/` aufgelöst wird.)

- [ ] **Step 6: Commit**

```bash
git add packages/notifications pnpm-lock.yaml
git commit -m "feat(notifications): Paket mit Mail-Typen, HTML-Escaping und Templates"
```

---

### Task 4: `notifications` — Resend-Adapter, Log-Adapter, Auswahl, Rendering nach Auftragsart

**Files:**
- Create: `packages/notifications/src/resend-email-sender.ts`, `src/logging-email-sender.ts`, `src/create-email-sender.ts`, `src/render-email-delivery.ts`
- Modify: `packages/notifications/src/index.ts`
- Test: `packages/notifications/src/resend-email-sender.spec.ts`, `src/logging-email-sender.spec.ts`, `src/create-email-sender.spec.ts`, `src/render-email-delivery.spec.ts`

**Interfaces:**
- Consumes: Task 3 (`EmailSender`, `EmailMessage`, `EmailSendResult`, `EmailLogger`, Templates), Task 1 (`emailDeliveryKindSchema`, Payload-Schemas).
- Produces:
  - `class ResendEmailSender implements EmailSender { constructor(options: { apiKey: string; from: string; fetch?: typeof fetch; timeoutMs?: number }) }`
  - `class LoggingEmailSender implements EmailSender { constructor(logger: EmailLogger) }`
  - `createEmailSender(options: { provider: "resend" | "log"; apiKey: string | undefined; from: string }, logger: EmailLogger): EmailSender`
  - `type RenderEmailDeliveryResult = { ok: true; email: RenderedEmail } | { ok: false; reason: string }`
  - `renderEmailDelivery(kind: string, payload: unknown): RenderEmailDeliveryResult`
  - `RESEND_EMAILS_ENDPOINT = "https://api.resend.com/emails"`

- [ ] **Step 1: Write the failing tests**

`packages/notifications/src/resend-email-sender.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { RESEND_EMAILS_ENDPOINT, ResendEmailSender } from "./resend-email-sender.js";

const message = {
  to: "gast@example.test",
  subject: "Betreff",
  text: "Text",
  html: "<p>Text</p>",
};

function senderWith(response: () => Promise<Response>) {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(response);
  const sender = new ResendEmailSender({
    apiKey: "re_test",
    from: "dartbase <noreply@dartbase.ch>",
    fetch: fetchMock,
    timeoutMs: 1_000,
  });
  return { sender, fetchMock };
}

describe("ResendEmailSender", () => {
  it("sendet an den Resend-Endpunkt mit Auth-, Idempotency- und Content-Type-Header", async () => {
    const { sender, fetchMock } = senderWith(async () =>
      new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }),
    );

    const result = await sender.send(message, "delivery-1");

    expect(result).toEqual({ kind: "sent", providerMessageId: "msg_1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(RESEND_EMAILS_ENDPOINT);
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer re_test");
    expect(headers.get("idempotency-key")).toBe("delivery-1");
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({
      from: "dartbase <noreply@dartbase.ch>",
      to: ["gast@example.test"],
      subject: "Betreff",
      text: "Text",
      html: "<p>Text</p>",
    });
  });

  it("behandelt 429, 409 und 5xx als wiederholbar", async () => {
    for (const status of [429, 409, 500, 503]) {
      const { sender } = senderWith(async () =>
        new Response(JSON.stringify({ name: "rate_limit_exceeded", message: "slow down" }), { status }),
      );
      const result = await sender.send(message, "d");
      expect(result.kind).toBe("retryable");
      if (result.kind === "retryable") expect(result.reason).toContain(String(status));
    }
  });

  it("behandelt andere 4xx als endgueltig abgelehnt und nennt den Grund", async () => {
    const { sender } = senderWith(async () =>
      new Response(JSON.stringify({ name: "validation_error", message: "Invalid `to` field" }), { status: 422 }),
    );
    const result = await sender.send(message, "d");
    expect(result).toEqual({ kind: "rejected", reason: "422 validation_error: Invalid `to` field" });
  });

  it("behandelt Netzwerkfehler als wiederholbar", async () => {
    const { sender } = senderWith(async () => {
      throw new TypeError("fetch failed");
    });
    const result = await sender.send(message, "d");
    expect(result).toEqual({ kind: "retryable", reason: "fetch failed" });
  });

  it("wertet einen Erfolg ohne ID als wiederholbar, statt eine leere ID zu buchen", async () => {
    const { sender } = senderWith(async () => new Response("{}", { status: 200 }));
    const result = await sender.send(message, "d");
    expect(result.kind).toBe("retryable");
  });
});
```

`packages/notifications/src/logging-email-sender.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { LoggingEmailSender } from "./logging-email-sender.js";

describe("LoggingEmailSender", () => {
  it("loggt Empfaenger, Betreff und Text und meldet Erfolg mit einer lokalen ID", async () => {
    const emit = vi.fn();
    const sender = new LoggingEmailSender({ emit });

    const result = await sender.send(
      { to: "gast@example.test", subject: "Hallo", text: "Inhalt", html: "<p>Inhalt</p>" },
      "delivery-7",
    );

    expect(result).toEqual({ kind: "sent", providerMessageId: "log:delivery-7" });
    expect(emit).toHaveBeenCalledWith("log", {
      event: "email.logged",
      to: "gast@example.test",
      subject: "Hallo",
      text: "Inhalt",
      idempotencyKey: "delivery-7",
    });
  });
});
```

`packages/notifications/src/create-email-sender.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { createEmailSender } from "./create-email-sender.js";
import { LoggingEmailSender } from "./logging-email-sender.js";
import { ResendEmailSender } from "./resend-email-sender.js";

const logger = { emit: vi.fn() };

describe("createEmailSender", () => {
  it("liefert fuer log den Log-Adapter", () => {
    expect(createEmailSender({ provider: "log", apiKey: undefined, from: "x <x@y.z>" }, logger)).toBeInstanceOf(
      LoggingEmailSender,
    );
  });

  it("liefert fuer resend den Resend-Adapter", () => {
    expect(createEmailSender({ provider: "resend", apiKey: "re_1", from: "x <x@y.z>" }, logger)).toBeInstanceOf(
      ResendEmailSender,
    );
  });

  it("wirft bei resend ohne Key, statt still zu loggen", () => {
    expect(() => createEmailSender({ provider: "resend", apiKey: undefined, from: "x <x@y.z>" }, logger)).toThrow(
      /RESEND_API_KEY/u,
    );
  });
});
```

`packages/notifications/src/render-email-delivery.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import { renderEmailDelivery } from "./render-email-delivery.js";

describe("renderEmailDelivery", () => {
  it("rendert eine Einladung aus Kind und Payload", () => {
    const result = renderEmailDelivery("INVITATION", {
      organizationName: "Beispielverein",
      inviterName: "Alex",
      role: "MEMBER",
      invitationUrl: "https://dartbase.example/einladung/x#code=y",
      expiresAt: "2026-09-22T10:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.email.subject).toContain("Beispielverein");
  });

  it("rendert einen Passwort-Reset", () => {
    const result = renderEmailDelivery("PASSWORD_RESET", {
      recipientName: "Alex",
      resetUrl: "https://api.dartbase.example/api/v1/auth/reset-password/t?callbackURL=c",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.email.subject).toBe("Passwort zurücksetzen auf DartBase");
  });

  it("meldet eine unbekannte Auftragsart als Fehler statt zu werfen", () => {
    const result = renderEmailDelivery("NEWSLETTER", {});
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("NEWSLETTER") });
  });

  it("meldet einen Payload, der nicht zum Schema passt", () => {
    const result = renderEmailDelivery("INVITATION", { organizationName: "V" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("invitationUrl");
  });

  it("meldet einen leeren Payload", () => {
    expect(renderEmailDelivery("INVITATION", null).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/notifications && npx vitest run`
Expected: FAIL — vier Module nicht gefunden.

- [ ] **Step 3: Write minimal implementation**

`packages/notifications/src/resend-email-sender.ts`:

```ts
import { z } from "zod";

import type { EmailMessage, EmailSender, EmailSendResult } from "./email-message.js";

export const RESEND_EMAILS_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_TIMEOUT_MS = 10_000;

const successSchema = z.object({ id: z.string().min(1) });
const errorSchema = z.object({ name: z.string().optional(), message: z.string().optional() });

export interface ResendEmailSenderOptions {
  readonly apiKey: string;
  readonly from: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/**
 * Versand ueber die Resend-HTTP-API ohne SDK: ein Endpunkt, ein Aufruf. Der
 * `Idempotency-Key` ist die ID der Versandzeile — ein zweiter Versuch nach
 * einem Absturz zwischen Versand und Buchung liefert dieselbe Mail nicht
 * erneut aus (Resend haelt den Schluessel 24 Stunden).
 *
 * Statusabbildung: 2xx `sent`; 429, 409 (nebenlaeufige idempotente
 * Anfrage / gesperrte Ressource) und 5xx `retryable`; jedes andere 4xx
 * `rejected` — eine ungueltige Adresse wird durch Wiederholen nicht besser.
 */
export class ResendEmailSender implements EmailSender {
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;

  public constructor(private readonly options: ResendEmailSenderOptions) {
    this.fetchImplementation = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  public async send(message: EmailMessage, idempotencyKey: string): Promise<EmailSendResult> {
    let response: Response;
    try {
      response = await this.fetchImplementation(RESEND_EMAILS_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          from: this.options.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error: unknown) {
      return { kind: "retryable", reason: describeError(error) };
    }

    const body: unknown = await response.json().catch(() => null);

    if (response.ok) {
      const parsed = successSchema.safeParse(body);
      if (!parsed.success) {
        return { kind: "retryable", reason: `${response.status} ohne Nachrichten-ID` };
      }
      return { kind: "sent", providerMessageId: parsed.data.id };
    }

    const details = errorSchema.safeParse(body);
    const name = details.success ? details.data.name ?? "unknown_error" : "unknown_error";
    const text = details.success ? details.data.message ?? "" : "";
    const reason = `${response.status} ${name}: ${text}`.trimEnd();

    if (response.status === 429 || response.status === 409 || response.status >= 500) {
      return { kind: "retryable", reason };
    }
    return { kind: "rejected", reason };
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

`packages/notifications/src/logging-email-sender.ts`:

```ts
import type { EmailLogger, EmailMessage, EmailSender, EmailSendResult } from "./email-message.js";

/**
 * Provider `log`: nichts verlaesst den Prozess. Empfaenger, Betreff und
 * Textvariante landen im strukturierten Log, damit Entwicklung und E2E den
 * Link nachlesen koennen. In Produktion nie aktiv.
 */
export class LoggingEmailSender implements EmailSender {
  public constructor(private readonly logger: EmailLogger) {}

  public async send(message: EmailMessage, idempotencyKey: string): Promise<EmailSendResult> {
    this.logger.emit("log", {
      event: "email.logged",
      to: message.to,
      subject: message.subject,
      text: message.text,
      idempotencyKey,
    });
    return { kind: "sent", providerMessageId: `log:${idempotencyKey}` };
  }
}
```

`packages/notifications/src/create-email-sender.ts`:

```ts
import type { EmailLogger, EmailSender } from "./email-message.js";
import { LoggingEmailSender } from "./logging-email-sender.js";
import { ResendEmailSender } from "./resend-email-sender.js";

export interface EmailSenderOptions {
  readonly provider: "resend" | "log";
  readonly apiKey: string | undefined;
  readonly from: string;
}

/** Waehlt den Adapter zur Umgebung. Die Felder entsprechen `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM`. */
export function createEmailSender(options: EmailSenderOptions, logger: EmailLogger): EmailSender {
  switch (options.provider) {
    case "log":
      return new LoggingEmailSender(logger);
    case "resend": {
      if (options.apiKey === undefined || options.apiKey.length === 0) {
        throw new Error("EMAIL_PROVIDER=resend verlangt RESEND_API_KEY.");
      }
      return new ResendEmailSender({ apiKey: options.apiKey, from: options.from });
    }
    default: {
      const exhaustive: never = options.provider;
      throw new Error(`Unbekannter Mail-Provider: ${String(exhaustive)}`);
    }
  }
}
```

`packages/notifications/src/render-email-delivery.ts`:

```ts
import {
  emailDeliveryKindSchema,
  invitationEmailPayloadSchema,
  passwordResetEmailPayloadSchema,
} from "@darts-platform/schemas";

import type { RenderedEmail } from "./email-message.js";
import { renderInvitationEmail } from "./templates/invitation-email.js";
import { renderPasswordResetEmail } from "./templates/password-reset-email.js";

export type RenderEmailDeliveryResult =
  | { readonly ok: true; readonly email: RenderedEmail }
  | { readonly ok: false; readonly reason: string };

/**
 * Waehlt Template und Payload-Schema anhand von `kind`. Ein unpassender
 * Payload ist ein Ergebnis, kein Wurf: der Poller bucht ihn als Dead-Letter
 * und laeuft weiter.
 */
export function renderEmailDelivery(kind: string, payload: unknown): RenderEmailDeliveryResult {
  const parsedKind = emailDeliveryKindSchema.safeParse(kind);
  if (!parsedKind.success) {
    return { ok: false, reason: `Unbekannte Auftragsart: ${kind}` };
  }

  switch (parsedKind.data) {
    case "INVITATION": {
      const parsed = invitationEmailPayloadSchema.safeParse(payload);
      if (!parsed.success) return { ok: false, reason: `Payload ungültig: ${describeIssues(parsed.error)}` };
      return { ok: true, email: renderInvitationEmail(parsed.data) };
    }
    case "PASSWORD_RESET": {
      const parsed = passwordResetEmailPayloadSchema.safeParse(payload);
      if (!parsed.success) return { ok: false, reason: `Payload ungültig: ${describeIssues(parsed.error)}` };
      return { ok: true, email: renderPasswordResetEmail(parsed.data) };
    }
    default: {
      const exhaustive: never = parsedKind.data;
      return { ok: false, reason: `Unbekannte Auftragsart: ${String(exhaustive)}` };
    }
  }
}

function describeIssues(error: { readonly issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[] }): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join(".") || "payload"}: ${issue.message}`)
    .join("; ");
}
```

`packages/notifications/src/index.ts` ergänzen:

```ts
export { createEmailSender, type EmailSenderOptions } from "./create-email-sender.js";
export { LoggingEmailSender } from "./logging-email-sender.js";
export { renderEmailDelivery, type RenderEmailDeliveryResult } from "./render-email-delivery.js";
export {
  RESEND_EMAILS_ENDPOINT,
  ResendEmailSender,
  type ResendEmailSenderOptions,
} from "./resend-email-sender.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/notifications && npx vitest run && pnpm typecheck && pnpm build`
Expected: PASS, `dist/` vorhanden.

- [ ] **Step 5: Commit**

```bash
git add packages/notifications
git commit -m "feat(notifications): Resend- und Log-Adapter, Auswahl und Rendering je Auftragsart"
```

---

### Task 5: Datenbank — Tabelle `email_deliveries`, Migration, Hilfsfunktionen

**Files:**
- Modify: `packages/database/src/schema.ts` (Tabelle nach `outboxEvents`)
- Modify: `packages/database/src/outbox.ts` (`backoffMillisSql` exportieren als `outboxBackoffMillisSql`)
- Create: `packages/database/src/email-deliveries.ts`
- Create: `packages/database/drizzle/0034_email_deliveries.sql`
- Modify: `packages/database/drizzle/meta/_journal.json`
- Modify: `packages/database/src/index.ts`
- Modify: `DATABASE_SCHEMA.md` (Abschnitt nach `outbox_events`)
- Test: `packages/database/src/email-deliveries.integration.spec.ts`

**Interfaces:**
- Consumes: `OUTBOX_MAX_ATTEMPTS`, `OUTBOX_BACKOFF_BASE_MS`, `OUTBOX_BACKOFF_CAP_MS`, `OutboxLogger`, `DatabaseExecutor`.
- Produces:
  - Tabelle `emailDeliveries` mit Typen `EmailDelivery`, `NewEmailDelivery`.
  - `enqueueEmailDelivery(executor, input: { kind: "INVITATION" | "PASSWORD_RESET"; recipient: string; payload: Record<string, unknown>; organizationId?: string | null; invitationId?: string | null }): Promise<{ id: string }>`
  - `emailDeliveryPending(now: Date): SQL | undefined`
  - `markEmailDeliverySent(executor, input: { id: string; providerMessageId: string; now: Date }): Promise<boolean>`
  - `recordEmailDeliveryFailure(input: { executor; id: string; reason: string; now: Date; maxAttempts: number; permanent: boolean; logger: OutboxLogger }): Promise<"retry" | "dead_letter" | "already_processed">`
  - `EMAIL_DELIVERY_BATCH_SIZE = 5`

- [ ] **Step 1: Write the failing test**

`packages/database/src/email-deliveries.integration.spec.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";

import { createDatabaseConnection } from "./client.js";
import {
  emailDeliveryPending,
  enqueueEmailDelivery,
  markEmailDeliverySent,
  recordEmailDeliveryFailure,
} from "./email-deliveries.js";
import { OUTBOX_MAX_ATTEMPTS } from "./outbox.js";
import { emailDeliveries, organizations } from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined) throw new Error("DATABASE_URL fehlt fuer den Integrationstest.");
const connection = createDatabaseConnection(databaseUrl);
const database = connection.database;
const organizationId = randomUUID();
const now = new Date("2026-09-20T12:00:00.000Z");
const logger = { emit: vi.fn() };

const payload = {
  organizationName: "Beispielverein",
  inviterName: "Alex",
  role: "MEMBER",
  invitationUrl: "https://dartbase.example/einladung/x#code=y",
  expiresAt: "2026-09-22T12:00:00.000Z",
};

beforeAll(async () => {
  await database.insert(organizations).values({
    id: organizationId,
    name: "Mail Club",
    slug: `mail-${organizationId}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });
});

afterAll(async () => {
  await database.delete(organizations).where(eq(organizations.id, organizationId));
  await connection.close();
});

async function readRow(id: string) {
  const [row] = await database.select().from(emailDeliveries).where(eq(emailDeliveries.id, id));
  if (row === undefined) throw new Error("Zeile fehlt");
  return row;
}

describe("email_deliveries", () => {
  it("legt einen offenen Auftrag mit Payload an, der im Pending-Praedikat erscheint", async () => {
    const { id } = await enqueueEmailDelivery(database, {
      kind: "INVITATION",
      recipient: "gast@example.test",
      organizationId,
      payload,
    });
    const [pending] = await database
      .select({ id: emailDeliveries.id })
      .from(emailDeliveries)
      .where(and(eq(emailDeliveries.id, id), emailDeliveryPending(now)));
    expect(pending?.id).toBe(id);
    const row = await readRow(id);
    expect(row.attempts).toBe(0);
    expect(row.sentAt).toBeNull();
    expect(row.payload).toEqual(payload);
  });

  it("weist eine unbekannte Auftragsart per Check-Constraint ab", async () => {
    await expect(
      database.insert(emailDeliveries).values({
        kind: "NEWSLETTER",
        recipient: "gast@example.test",
        organizationId,
        payload: {},
      }),
    ).rejects.toThrow(/email_deliveries_kind_check/u);
  });

  it("weist einen offenen Auftrag ohne Payload ab", async () => {
    await expect(
      database.insert(emailDeliveries).values({
        kind: "INVITATION",
        recipient: "gast@example.test",
        organizationId,
        payload: null,
      }),
    ).rejects.toThrow(/email_deliveries_open_has_payload_check/u);
  });

  it("bucht den Erfolg und leert den Payload", async () => {
    const { id } = await enqueueEmailDelivery(database, {
      kind: "INVITATION",
      recipient: "gast@example.test",
      organizationId,
      payload,
    });
    const marked = await markEmailDeliverySent(database, { id, providerMessageId: "msg_1", now });
    expect(marked).toBe(true);
    const row = await readRow(id);
    expect(row.sentAt?.toISOString()).toBe(now.toISOString());
    expect(row.providerMessageId).toBe("msg_1");
    expect(row.payload).toBeNull();
    // Zweite Buchung trifft nichts mehr.
    expect(await markEmailDeliverySent(database, { id, providerMessageId: "msg_2", now })).toBe(false);
    const [stillPending] = await database
      .select({ id: emailDeliveries.id })
      .from(emailDeliveries)
      .where(and(eq(emailDeliveries.id, id), emailDeliveryPending(now)));
    expect(stillPending).toBeUndefined();
  });

  it("bucht einen wiederholbaren Fehler mit Backoff und behaelt den Payload", async () => {
    const { id } = await enqueueEmailDelivery(database, {
      kind: "INVITATION",
      recipient: "gast@example.test",
      organizationId,
      payload,
    });
    const outcome = await recordEmailDeliveryFailure({
      executor: database,
      id,
      reason: "503 service_unavailable",
      now,
      maxAttempts: OUTBOX_MAX_ATTEMPTS,
      permanent: false,
      logger,
    });
    expect(outcome).toBe("retry");
    const row = await readRow(id);
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe("503 service_unavailable");
    expect(row.notBefore?.getTime()).toBe(now.getTime() + 1_000);
    expect(row.payload).toEqual(payload);
    // Waehrend des Backoffs nicht pending, danach wieder.
    const [blocked] = await database
      .select({ id: emailDeliveries.id })
      .from(emailDeliveries)
      .where(and(eq(emailDeliveries.id, id), emailDeliveryPending(now)));
    expect(blocked).toBeUndefined();
    const [later] = await database
      .select({ id: emailDeliveries.id })
      .from(emailDeliveries)
      .where(and(eq(emailDeliveries.id, id), emailDeliveryPending(new Date(now.getTime() + 2_000))));
    expect(later?.id).toBe(id);
  });

  it("legt nach der Hoechstzahl Versuche ins Dead-Letter und leert den Payload", async () => {
    const { id } = await enqueueEmailDelivery(database, {
      kind: "INVITATION",
      recipient: "gast@example.test",
      organizationId,
      payload,
    });
    await database.update(emailDeliveries).set({ attempts: OUTBOX_MAX_ATTEMPTS - 1 }).where(eq(emailDeliveries.id, id));
    const outcome = await recordEmailDeliveryFailure({
      executor: database,
      id,
      reason: "500 application_error",
      now,
      maxAttempts: OUTBOX_MAX_ATTEMPTS,
      permanent: false,
      logger,
    });
    expect(outcome).toBe("dead_letter");
    const row = await readRow(id);
    expect(row.attempts).toBe(OUTBOX_MAX_ATTEMPTS);
    expect(row.deadLetteredAt?.toISOString()).toBe(now.toISOString());
    expect(row.notBefore).toBeNull();
    expect(row.payload).toBeNull();
    expect(logger.emit).toHaveBeenCalledWith("error", expect.objectContaining({ event: "email.dead_letter", deliveryId: id }));
  });

  it("legt einen endgueltig abgelehnten Auftrag sofort ins Dead-Letter", async () => {
    const { id } = await enqueueEmailDelivery(database, {
      kind: "PASSWORD_RESET",
      recipient: "gast@example.test",
      payload: { recipientName: "A", resetUrl: "https://api.example/r" },
    });
    const outcome = await recordEmailDeliveryFailure({
      executor: database,
      id,
      reason: "422 validation_error: Invalid `to` field",
      now,
      maxAttempts: OUTBOX_MAX_ATTEMPTS,
      permanent: true,
      logger,
    });
    expect(outcome).toBe("dead_letter");
    const row = await readRow(id);
    expect(row.attempts).toBe(1);
    expect(row.deadLetteredAt).not.toBeNull();
    expect(row.payload).toBeNull();
    expect(row.organizationId).toBeNull();
  });

  it("meldet already_processed fuer eine bereits versendete Zeile", async () => {
    const { id } = await enqueueEmailDelivery(database, {
      kind: "INVITATION",
      recipient: "gast@example.test",
      organizationId,
      payload,
    });
    await markEmailDeliverySent(database, { id, providerMessageId: "msg", now });
    const outcome = await recordEmailDeliveryFailure({
      executor: database,
      id,
      reason: "spaet",
      now,
      maxAttempts: OUTBOX_MAX_ATTEMPTS,
      permanent: false,
      logger,
    });
    expect(outcome).toBe("already_processed");
  });

  it("loescht Auftraege mit der Organisation", async () => {
    const orphanOrganizationId = randomUUID();
    await database.insert(organizations).values({
      id: orphanOrganizationId,
      name: "Weg",
      slug: `weg-${orphanOrganizationId}`,
      timezone: "Europe/Zurich",
      locale: "de-CH",
    });
    const { id } = await enqueueEmailDelivery(database, {
      kind: "INVITATION",
      recipient: "gast@example.test",
      organizationId: orphanOrganizationId,
      payload,
    });
    await database.delete(organizations).where(eq(organizations.id, orphanOrganizationId));
    const rows = await database.select({ id: emailDeliveries.id }).from(emailDeliveries).where(eq(emailDeliveries.id, id));
    expect(rows).toEqual([]);
  });

  it("zaehlt nur offene Zeilen ohne Backoff als pending", async () => {
    const rows = await database
      .select({ id: emailDeliveries.id })
      .from(emailDeliveries)
      .where(and(emailDeliveryPending(now), isNull(emailDeliveries.sentAt)));
    for (const row of rows) {
      const full = await readRow(row.id);
      expect(full.deadLetteredAt).toBeNull();
      expect(full.notBefore === null || full.notBefore <= now).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run migration test first to see the schema is missing**

Run: `pnpm db:migrate && cd packages/database && npx vitest run src/email-deliveries.integration.spec.ts`
Expected: FAIL — `email-deliveries.js` fehlt.

- [ ] **Step 3: Schema, Migration, Hilfsfunktionen schreiben**

In `packages/database/src/schema.ts` nach dem `outboxEvents`-Block (und dessen Typen) einfügen:

```ts
/**
 * Versandauftraege fuer ausgehende Mails (Spec 2026-09-20-email-versand,
 * ADR 0017). Eine Zeile je Mail; die API legt sie in derselben Transaktion
 * an wie die fachliche Aenderung, der Worker versendet und bucht.
 *
 * Bewusst KEIN dritter Konsument an `outbox_events`: ein Mailauftrag ist
 * kein Domaenenereignis, sondern ein Auftrag mit eigenem Empfaenger,
 * eigenem Inhalt und eigenem Lebenszyklus.
 *
 * `payload` traegt bis zum Versand den Klartext-Link (beim
 * Einladungscode: das einzige Vorkommen des Klartexts in der Datenbank) und
 * wird nach Erfolg oder Dead-Letter geleert. Der Check-Constraint sichert
 * die Gegenrichtung: eine offene Zeile hat immer Inhalt.
 */
export const emailDeliveries = pgTable(
  "email_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Nullable: der Passwort-Reset gehoert zu keiner Organisation.
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    // Verbindet die Zustellung mit der Einladung, auch nachdem der Payload
    // geleert ist; traegt den Zustellstatus in der Einladungsliste.
    invitationId: uuid("invitation_id").references(() => organizationInvitations.id, {
      onDelete: "cascade",
    }),
    kind: varchar("kind", { length: 30 }).notNull(),
    recipient: varchar("recipient", { length: 320 }).notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    providerMessageId: varchar("provider_message_id", { length: 200 }),
    attempts: integer("attempts").default(0).notNull(),
    notBefore: timestamp("not_before", { withTimezone: true }),
    deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),
    lastError: text("last_error"),
  },
  (table) => [
    // Der Poller liest nur offene Zeilen in Reihenfolge ihres Entstehens.
    index("email_deliveries_pending_idx")
      .on(table.createdAt)
      .where(sql`${table.sentAt} is null and ${table.deadLetteredAt} is null`),
    // Aufraeumregel.
    index("email_deliveries_sent_at_idx").on(table.sentAt),
    index("email_deliveries_dead_lettered_at_idx").on(table.deadLetteredAt),
    // Zustellstatus je Einladung (juengste Zeile).
    index("email_deliveries_invitation_created_idx").on(table.invitationId, table.createdAt),
    index("email_deliveries_organization_created_idx").on(table.organizationId, table.createdAt),
    check("email_deliveries_kind_check", sql`${table.kind} in ('INVITATION', 'PASSWORD_RESET')`),
    check(
      "email_deliveries_open_has_payload_check",
      sql`${table.payload} is not null or ${table.sentAt} is not null or ${table.deadLetteredAt} is not null`,
    ),
  ],
);

export type EmailDelivery = typeof emailDeliveries.$inferSelect;
export type NewEmailDelivery = typeof emailDeliveries.$inferInsert;
```

(Prüfen, dass `integer`, `jsonb`, `text`, `check`, `index`, `sql` bereits aus `drizzle-orm/pg-core` beziehungsweise `drizzle-orm` importiert sind — `outboxEvents` verwendet sie alle.)

`packages/database/drizzle/0034_email_deliveries.sql`:

```sql
-- Versandauftraege fuer ausgehende Mails (ADR 0017). Eine Zeile je Mail;
-- Payload bis zum Versand, danach geleert. Retry/Backoff/Dead-Letter nach
-- dem Muster von outbox_events, aber als eigene Tabelle: ein Mailauftrag
-- ist kein Domaenenereignis.
CREATE TABLE "email_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid,
  "invitation_id" uuid,
  "kind" varchar(30) NOT NULL,
  "recipient" varchar(320) NOT NULL,
  "payload" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_at" timestamp with time zone,
  "provider_message_id" varchar(200),
  "attempts" integer DEFAULT 0 NOT NULL,
  "not_before" timestamp with time zone,
  "dead_lettered_at" timestamp with time zone,
  "last_error" text
);--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_invitation_id_organization_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."organization_invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_deliveries_pending_idx" ON "email_deliveries" USING btree ("created_at") WHERE "email_deliveries"."sent_at" is null and "email_deliveries"."dead_lettered_at" is null;--> statement-breakpoint
CREATE INDEX "email_deliveries_sent_at_idx" ON "email_deliveries" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "email_deliveries_dead_lettered_at_idx" ON "email_deliveries" USING btree ("dead_lettered_at");--> statement-breakpoint
CREATE INDEX "email_deliveries_invitation_created_idx" ON "email_deliveries" USING btree ("invitation_id","created_at");--> statement-breakpoint
CREATE INDEX "email_deliveries_organization_created_idx" ON "email_deliveries" USING btree ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_kind_check" CHECK ("email_deliveries"."kind" in ('INVITATION', 'PASSWORD_RESET'));--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_open_has_payload_check" CHECK ("email_deliveries"."payload" is not null or "email_deliveries"."sent_at" is not null or "email_deliveries"."dead_lettered_at" is not null);
```

In `packages/database/drizzle/meta/_journal.json` nach dem Eintrag `idx: 33` anhängen (Komma nach dem vorherigen Eintrag nicht vergessen):

```json
    {
      "idx": 34,
      "version": "7",
      "when": 1789800000000,
      "tag": "0034_email_deliveries",
      "breakpoints": true
    }
```

In `packages/database/src/outbox.ts` die Funktion `backoffMillisSql` exportieren und umbenennen (alle drei Verwendungen in der Datei anpassen):

```ts
/**
 * Wartezeit bis zum naechsten Versuch als SQL-Ausdruck ... (bestehender Kommentar)
 * Exportiert, weil `email-deliveries.ts` dieselbe Kurve faehrt.
 */
export function outboxBackoffMillisSql(attemptsColumn: SQLWrapper) {
  return sql`least(${OUTBOX_BACKOFF_BASE_MS}::numeric * power(2, greatest(0, ${attemptsColumn})), ${OUTBOX_BACKOFF_CAP_MS}::numeric)`;
}
```

`packages/database/src/email-deliveries.ts`:

```ts
import { and, eq, isNull, lte, or, sql, type SQL } from "drizzle-orm";

import type { DatabaseExecutor } from "./client.js";
import { outboxBackoffMillisSql, type OutboxLogger } from "./outbox.js";
import { emailDeliveries } from "./schema.js";

/**
 * Stapelgroesse des Mail-Pollers. Klein, weil die Zeilensperre waehrend des
 * Provider-Aufrufs haelt (bis 10 s je Zeile): 5 Zeilen begrenzen die
 * Transaktion auf unter einer Minute im schlechtesten Fall.
 */
export const EMAIL_DELIVERY_BATCH_SIZE = 5;

const MAX_ERROR_LENGTH = 500;

export type EmailDeliveryKindValue = "INVITATION" | "PASSWORD_RESET";

export interface EnqueueEmailDeliveryInput {
  readonly kind: EmailDeliveryKindValue;
  readonly recipient: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly organizationId?: string | null;
  readonly invitationId?: string | null;
}

/**
 * Legt einen Versandauftrag an. Aufrufer uebergeben die offene Transaktion
 * der fachlichen Aenderung, damit Einladung und Mailauftrag gemeinsam
 * committen oder gemeinsam scheitern.
 */
export async function enqueueEmailDelivery(
  executor: DatabaseExecutor,
  input: EnqueueEmailDeliveryInput,
): Promise<{ readonly id: string }> {
  const [row] = await executor
    .insert(emailDeliveries)
    .values({
      kind: input.kind,
      recipient: input.recipient,
      payload: input.payload,
      organizationId: input.organizationId ?? null,
      invitationId: input.invitationId ?? null,
    })
    .returning({ id: emailDeliveries.id });
  if (row === undefined) throw new Error("email_deliveries insert did not return a row.");
  return row;
}

/** Offen, nicht dead-gelettet, Backoff abgelaufen. */
export function emailDeliveryPending(now: Date): SQL | undefined {
  return and(
    isNull(emailDeliveries.sentAt),
    isNull(emailDeliveries.deadLetteredAt),
    or(isNull(emailDeliveries.notBefore), lte(emailDeliveries.notBefore, now)),
  );
}

/** Bucht den Erfolg und leert den Payload. `false`: Zeile war schon erledigt. */
export async function markEmailDeliverySent(
  executor: DatabaseExecutor,
  input: { readonly id: string; readonly providerMessageId: string; readonly now: Date },
): Promise<boolean> {
  const rows = await executor
    .update(emailDeliveries)
    .set({ sentAt: input.now, providerMessageId: input.providerMessageId, payload: null, notBefore: null })
    .where(and(eq(emailDeliveries.id, input.id), isNull(emailDeliveries.sentAt), isNull(emailDeliveries.deadLetteredAt)))
    .returning({ id: emailDeliveries.id });
  return rows.length > 0;
}

export type EmailDeliveryFailureResult = "retry" | "dead_letter" | "already_processed";

export interface EmailDeliveryFailureInput {
  readonly executor: DatabaseExecutor;
  readonly id: string;
  readonly reason: string;
  readonly now: Date;
  readonly maxAttempts: number;
  /** `true`: sofort Dead-Letter (Provider hat endgueltig abgelehnt). */
  readonly permanent: boolean;
  readonly logger: OutboxLogger;
}

/**
 * Bucht einen Fehlversuch als eine atomare `UPDATE`-Anweisung, serverseitig
 * aus dem Zeilenzustand gerechnet — dasselbe Muster wie
 * `recordOutboxFailure`. Erreicht die Zeile die Obergrenze oder ist der
 * Fehler endgueltig, wird sie dead-gelettet und der Payload geleert; der
 * Klartext-Link liegt dann nicht mehr in der Datenbank.
 */
export async function recordEmailDeliveryFailure(
  input: EmailDeliveryFailureInput,
): Promise<EmailDeliveryFailureResult> {
  const lastError = input.reason.slice(0, MAX_ERROR_LENGTH);
  const nowIso = input.now.toISOString();
  const deadLetter = input.permanent
    ? sql`true`
    : sql`${emailDeliveries.attempts} + 1 >= ${input.maxAttempts}::integer`;

  const rows = await input.executor
    .update(emailDeliveries)
    .set({
      attempts: sql`${emailDeliveries.attempts} + 1`,
      lastError,
      notBefore: sql`case
        when ${deadLetter} then null
        else ${nowIso}::timestamptz + (${outboxBackoffMillisSql(emailDeliveries.attempts)} * interval '1 millisecond')
      end`,
      deadLetteredAt: sql`case
        when ${deadLetter} then coalesce(${emailDeliveries.deadLetteredAt}, ${nowIso}::timestamptz)
        else ${emailDeliveries.deadLetteredAt}
      end`,
      payload: sql`case when ${deadLetter} then null else ${emailDeliveries.payload} end`,
    })
    .where(and(eq(emailDeliveries.id, input.id), isNull(emailDeliveries.sentAt), isNull(emailDeliveries.deadLetteredAt)))
    .returning({
      attempts: emailDeliveries.attempts,
      deadLetteredAt: emailDeliveries.deadLetteredAt,
      kind: emailDeliveries.kind,
    });

  const row = rows[0];
  if (row === undefined) {
    input.logger.emit("log", { event: "email.failure_already_processed", deliveryId: input.id, lastError });
    return "already_processed";
  }

  const deadLettered = row.deadLetteredAt !== null;
  input.logger.emit(deadLettered ? "error" : "warn", {
    event: deadLettered ? "email.dead_letter" : "email.retry_scheduled",
    deliveryId: input.id,
    kind: row.kind,
    attempts: row.attempts,
    lastError,
  });
  return deadLettered ? "dead_letter" : "retry";
}
```

In `packages/database/src/index.ts` ergänzen:

```ts
export {
  EMAIL_DELIVERY_BATCH_SIZE,
  emailDeliveryPending,
  enqueueEmailDelivery,
  markEmailDeliverySent,
  recordEmailDeliveryFailure,
  type EmailDeliveryFailureInput,
  type EmailDeliveryFailureResult,
  type EmailDeliveryKindValue,
  type EnqueueEmailDeliveryInput,
} from "./email-deliveries.js";
```

und im Schema-Export-Block `emailDeliveries`, `type EmailDelivery`, `type NewEmailDelivery` sowie im Outbox-Block `outboxBackoffMillisSql` aufnehmen.

In `DATABASE_SCHEMA.md` nach dem Abschnitt `## outbox_events` (vor `## Dead Letter finden und erneut einreihen`) einfügen:

```markdown
## email_deliveries

```text
id uuid PK
organization_id uuid FK organizations NULL ON DELETE CASCADE
invitation_id uuid FK organization_invitations NULL ON DELETE CASCADE
kind varchar(30) NOT NULL            -- INVITATION | PASSWORD_RESET
recipient varchar(320) NOT NULL
payload jsonb NULL                   -- Template-Eingaben inkl. Klartext-Link; null nach Versand/Dead-Letter
created_at timestamptz NOT NULL DEFAULT now()
sent_at timestamptz
provider_message_id varchar(200)
attempts integer NOT NULL DEFAULT 0
not_before timestamptz
dead_lettered_at timestamptz
last_error text
```

Versandaufträge für ausgehende Mails (ADR 0017). Die API legt eine Zeile in
derselben Transaktion an wie die fachliche Änderung (Einladung) oder im
Better-Auth-Hook (Passwort-Reset). Der Worker pollt offene Zeilen
(`sent_at is null and dead_lettered_at is null and (not_before is null or
not_before <= now())`) mit `FOR UPDATE SKIP LOCKED`, Stapel 5, rendert das
Template aus `kind` und `payload` und ruft Resend mit `id` als
`Idempotency-Key` auf.

Retry-Kurve wie `outbox_events`: 1 s · 2^(attempts−1), gedeckelt bei 5 min,
Dead-Letter nach 8 Versuchen. Eine vom Provider endgültig abgelehnte Mail
(4xx ausser 429/409) geht sofort ins Dead-Letter. In beiden Fällen und nach
Erfolg wird `payload` geleert; der Klartext-Einladungscode liegt damit nur
bis zum Versand in der Datenbank. Der Check-Constraint
`email_deliveries_open_has_payload_check` sichert die Gegenrichtung.

Aufräumregel im Worker: versendete und dead-geletterte Zeilen älter als
30 Tage werden stündlich in Stapeln von 1000 gelöscht.

Dead-Letter finden:

```sql
select id, kind, recipient, attempts, last_error, dead_lettered_at
from email_deliveries
where dead_lettered_at is not null
order by dead_lettered_at desc;
```

Ein Dead-Letter lässt sich nicht erneut einreihen, weil der Payload geleert
ist; stattdessen die Einladung in der Oberfläche «Erneut senden» oder den
Passwort-Reset erneut anfordern.
```

- [ ] **Step 4: Migration anwenden, Tests ausführen**

Run: `pnpm db:migrate && cd packages/database && npx vitest run src/email-deliveries.integration.spec.ts src/outbox.spec.ts src/outbox.integration.spec.ts && pnpm typecheck && pnpm build`
Expected: Migration `0034_email_deliveries` angewendet, alle Tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/database DATABASE_SCHEMA.md
git commit -m "feat(database): Tabelle email_deliveries mit Migration, Pending-Praedikat und Fehlerbuchung"
```

---

### Task 6: API — Einladung erstellen legt den Versandauftrag an

**Files:**
- Create: `apps/api/src/organizations/invitation-link.ts`
- Modify: `apps/api/src/organizations/organizations.repository.ts` (`createInvitation`)
- Modify: `apps/api/src/organizations/organizations.service.ts` (`invite`)
- Test: `apps/api/src/organizations/invitation-link.spec.ts`, `apps/api/src/organizations/invitation-email.integration.spec.ts`

**Interfaces:**
- Consumes: `enqueueEmailDelivery` (Task 5), `ApplicationEnvironment.WEB_ORIGIN`.
- Produces: `buildInvitationUrl(webOrigin: string, invitationId: string, claimToken: string): string`; `createInvitation` nimmt zusätzlich `webOrigin: string`.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/organizations/invitation-link.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildInvitationUrl } from "./invitation-link.js";

describe("buildInvitationUrl", () => {
  it("setzt den Code ins Fragment, nicht in den Query-String", () => {
    const url = buildInvitationUrl(
      "https://dartbase.ch",
      "11111111-1111-4111-8111-111111111111",
      "abc_DEF-123",
    );
    expect(url).toBe("https://dartbase.ch/einladung/11111111-1111-4111-8111-111111111111#code=abc_DEF-123");
    expect(new URL(url).search).toBe("");
  });

  it("verwirft Pfad und Query des Ursprungs", () => {
    expect(buildInvitationUrl("http://localhost:3000/irgendwo?x=1", "id", "c")).toBe(
      "http://localhost:3000/einladung/id#code=c",
    );
  });
});
```

`apps/api/src/organizations/invitation-email.integration.spec.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { emailDeliveries, memberships, organizations, users } from "@darts-platform/database";
import { invitationEmailPayloadSchema } from "@darts-platform/schemas";

import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { OrganizationAccessService } from "./organization-access.service.js";
import { OrganizationsRepository } from "./organizations.repository.js";
import { OrganizationsService } from "./organizations.service.js";

const environment = parseApplicationEnvironment(process.env);
const databaseService = new DatabaseService(environment);
const repository = new OrganizationsRepository(databaseService);
const service = new OrganizationsService(repository, new OrganizationAccessService(repository), environment);

const organizationId = randomUUID();
const ownerUserId = randomUUID();
const ownerAuth: AuthContext = {
  user: { id: ownerUserId, email: `owner-${ownerUserId}@example.test`, name: "Alex Muster" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const audit = { correlationId: randomUUID(), ip: "127.0.0.1", userAgent: "vitest" };

beforeAll(async () => {
  await databaseService.database.insert(users).values({ id: ownerUserId, email: ownerAuth.user.email, displayName: "Alex Muster" });
  await databaseService.database.insert(organizations).values({
    id: organizationId, name: "Mailverein", slug: `mailverein-${organizationId}`, timezone: "Europe/Zurich", locale: "de-CH",
  });
  await databaseService.database.insert(memberships).values({ organizationId, userId: ownerUserId, role: "OWNER", status: "ACTIVE" });
});

afterAll(async () => {
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(users).where(eq(users.id, ownerUserId));
  await databaseService.onApplicationShutdown();
});

describe("Einladung erzeugt einen Versandauftrag", () => {
  it("legt genau eine INVITATION-Zeile mit Link, Namen und Ablauf an", async () => {
    const email = `gast-${randomUUID()}@example.test`;
    const created = await service.invite({
      organizationId,
      data: { email, role: "SCORER" },
      auth: ownerAuth,
      audit,
    });

    const rows = await databaseService.database
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.invitationId, created.id))
      .orderBy(desc(emailDeliveries.createdAt));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.kind).toBe("INVITATION");
    expect(row.recipient).toBe(email);
    expect(row.organizationId).toBe(organizationId);
    expect(row.sentAt).toBeNull();

    const payload = invitationEmailPayloadSchema.parse(row.payload);
    expect(payload.organizationName).toBe("Mailverein");
    expect(payload.inviterName).toBe("Alex Muster");
    expect(payload.role).toBe("SCORER");
    expect(payload.expiresAt.getTime()).toBe(created.expiresAt.getTime());
    expect(payload.invitationUrl).toBe(
      `${new URL(environment.WEB_ORIGIN).origin}/einladung/${created.id}#code=${created.claimToken}`,
    );
  });

  it("legt keine Zeile an, wenn die Einladung scheitert", async () => {
    const before = await databaseService.database
      .select({ id: emailDeliveries.id })
      .from(emailDeliveries)
      .where(eq(emailDeliveries.organizationId, organizationId));
    await expect(
      service.invite({
        organizationId,
        data: { email: `x-${randomUUID()}@example.test`, role: "MEMBER", playerId: randomUUID() },
        auth: ownerAuth,
        audit,
      }),
    ).rejects.toThrow();
    const after = await databaseService.database
      .select({ id: emailDeliveries.id })
      .from(emailDeliveries)
      .where(eq(emailDeliveries.organizationId, organizationId));
    expect(after.length).toBe(before.length);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/organizations/invitation-link.spec.ts src/organizations/invitation-email.integration.spec.ts`
Expected: FAIL — `invitation-link.js` fehlt; Integrationstest findet keine Zeile.

- [ ] **Step 3: Write minimal implementation**

`apps/api/src/organizations/invitation-link.ts`:

```ts
/**
 * Der Einladungslink traegt den Klartext-Code im URL-Fragment. Das Fragment
 * verlaesst den Browser nicht: es steht weder in Server-Logs noch im
 * Referer noch in Proxy-Protokollen. Die Einladungsseite liest es
 * clientseitig und sendet es nur im Request-Body an die API.
 */
export function buildInvitationUrl(webOrigin: string, invitationId: string, claimToken: string): string {
  const origin = new URL(webOrigin).origin;
  return `${origin}/einladung/${encodeURIComponent(invitationId)}#code=${encodeURIComponent(claimToken)}`;
}
```

In `organizations.repository.ts`:

Imports ergänzen: `enqueueEmailDelivery` aus `@darts-platform/database`, `buildInvitationUrl` aus `./invitation-link.js`.

Signatur von `createInvitation` erweitern:

```ts
  public async createInvitation(
    input: CreateInvitationInput &
      ActorInput & { readonly organizationId: string; readonly webOrigin: string },
  ): Promise<CreateInvitationResult> {
```

Nach dem bestehenden `transaction.insert(auditEvents)`-Aufruf in `createInvitation` und vor dem `return` einfügen:

```ts
      // Versandauftrag in derselben Transaktion: Einladung und Mail
      // entstehen gemeinsam oder gar nicht (Spec 2026-09-20-email-versand).
      // Organisationsname und Name der einladenden Person werden hier
      // gelesen, damit die Mail den Stand zum Zeitpunkt der Einladung traegt.
      await this.enqueueInvitationEmail(transaction, {
        organizationId: input.organizationId,
        invitationId: invitation.id,
        recipient: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        inviterUserId: input.userId,
        claimToken,
        webOrigin: input.webOrigin,
      });
```

Neue private Methode in der Klasse (wird in Task 8 von `resendInvitation` wiederverwendet):

```ts
  /**
   * Legt den Versandauftrag einer Einladung an. `inviterName` ist der
   * Anzeigename der handelnden Person; fehlt er, rendert das Template ohne
   * Namen.
   */
  private async enqueueInvitationEmail(
    transaction: DatabaseTransaction,
    input: {
      readonly organizationId: string;
      readonly invitationId: string;
      readonly recipient: string;
      readonly role: string;
      readonly expiresAt: Date;
      readonly inviterUserId: string;
      readonly claimToken: string;
      readonly webOrigin: string;
    },
  ): Promise<void> {
    const [organization] = await transaction
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, input.organizationId))
      .limit(1);
    const [inviter] = await transaction
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, input.inviterUserId))
      .limit(1);
    if (organization === undefined) {
      throw new Error("Organization vanished while creating the invitation email.");
    }

    await enqueueEmailDelivery(transaction, {
      kind: "INVITATION",
      recipient: input.recipient,
      organizationId: input.organizationId,
      invitationId: input.invitationId,
      payload: {
        organizationName: organization.name,
        inviterName: inviter?.displayName ?? "",
        role: input.role,
        invitationUrl: buildInvitationUrl(input.webOrigin, input.invitationId, input.claimToken),
        expiresAt: input.expiresAt.toISOString(),
      },
    });
  }
```

In `organizations.service.ts`, Methode `invite`, den Repository-Aufruf ergänzen:

```ts
    const result = await this.organizationsRepository.createInvitation({
      ...input.data,
      organizationId: input.organizationId,
      userId: input.auth.user.id,
      audit: input.audit,
      webOrigin: this.environment.WEB_ORIGIN,
    });
```

Weitere Aufrufer von `createInvitation` (`grep -rn "createInvitation(" apps/api/src`) — `production-bootstrap.ts`, `seed-development.ts`, `demo-organization-seed.ts` und Tests — erhalten ebenfalls `webOrigin`: aus dem dort vorhandenen `environment.WEB_ORIGIN`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/organizations/ && pnpm typecheck`
Expected: PASS, auch die bestehenden Organisations- und Bootstrap-Tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit -m "feat(api): Einladung legt Versandauftrag mit Einladungslink in derselben Transaktion an"
```

---

### Task 7: API — Einladungsliste mit Zustellstatus

**Files:**
- Create: `apps/api/src/organizations/invitation-delivery.ts`
- Modify: `apps/api/src/organizations/organizations.repository.ts` (`listInvitationsOfOrganization`)
- Test: `apps/api/src/organizations/invitation-delivery.spec.ts`, Ergänzung in `apps/api/src/organizations/invitation-email.integration.spec.ts`

**Interfaces:**
- Consumes: `emailDeliveries` (Task 5), `InvitationDeliveryStatus` (Task 1).
- Produces: `describeInvitationDelivery(row: { sentAt: Date | null; deadLetteredAt: Date | null } | undefined): InvitationDeliveryStatus | null`; `listInvitationsOfOrganization` liefert zusätzlich `lastDelivery`.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/organizations/invitation-delivery.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import { describeInvitationDelivery } from "./invitation-delivery.js";

const at = new Date("2026-09-20T10:00:00.000Z");

describe("describeInvitationDelivery", () => {
  it("liefert null ohne Zustellzeile (Einladung vor dem Mailversand)", () => {
    expect(describeInvitationDelivery(undefined)).toBeNull();
  });

  it("liefert pending fuer eine offene Zeile", () => {
    expect(describeInvitationDelivery({ sentAt: null, deadLetteredAt: null })).toEqual({ status: "pending" });
  });

  it("liefert sent mit Zeitpunkt", () => {
    expect(describeInvitationDelivery({ sentAt: at, deadLetteredAt: null })).toEqual({ status: "sent", sentAt: at });
  });

  it("liefert failed mit Zeitpunkt", () => {
    expect(describeInvitationDelivery({ sentAt: null, deadLetteredAt: at })).toEqual({ status: "failed", failedAt: at });
  });
});
```

In `invitation-email.integration.spec.ts` innerhalb des `describe` anhängen:

```ts
  it("liefert in der Einladungsliste den Zustand der juengsten Zustellung", async () => {
    const email = `status-${randomUUID()}@example.test`;
    const created = await service.invite({ organizationId, data: { email, role: "MEMBER" }, auth: ownerAuth, audit });

    let list = await service.listOrganizationInvitations({ organizationId, auth: ownerAuth });
    expect(list.find((entry) => entry.id === created.id)?.lastDelivery).toEqual({ status: "pending" });

    const sentAt = new Date("2026-09-20T10:00:00.000Z");
    await databaseService.database
      .update(emailDeliveries)
      .set({ sentAt, providerMessageId: "msg", payload: null })
      .where(eq(emailDeliveries.invitationId, created.id));
    list = await service.listOrganizationInvitations({ organizationId, auth: ownerAuth });
    expect(list.find((entry) => entry.id === created.id)?.lastDelivery).toEqual({ status: "sent", sentAt });

    // Eine zweite, juengere Zeile (wie nach «Erneut senden») bestimmt den Status.
    await databaseService.database.insert(emailDeliveries).values({
      kind: "INVITATION",
      recipient: email,
      organizationId,
      invitationId: created.id,
      payload: null,
      deadLetteredAt: new Date("2026-09-20T11:00:00.000Z"),
      attempts: 8,
      lastError: "test",
    });
    list = await service.listOrganizationInvitations({ organizationId, auth: ownerAuth });
    expect(list.find((entry) => entry.id === created.id)?.lastDelivery?.status).toBe("failed");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/organizations/invitation-delivery.spec.ts src/organizations/invitation-email.integration.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

`apps/api/src/organizations/invitation-delivery.ts`:

```ts
import type { InvitationDeliveryStatus } from "@darts-platform/schemas";

/** Bildet die juengste Zustellzeile einer Einladung auf den Status der Liste ab. */
export function describeInvitationDelivery(
  row: { readonly sentAt: Date | null; readonly deadLetteredAt: Date | null } | undefined,
): InvitationDeliveryStatus | null {
  if (row === undefined) return null;
  if (row.sentAt !== null) return { status: "sent", sentAt: row.sentAt };
  if (row.deadLetteredAt !== null) return { status: "failed", failedAt: row.deadLetteredAt };
  return { status: "pending" };
}
```

`listInvitationsOfOrganization` im Repository ersetzen (Imports: `desc`, `inArray` aus `drizzle-orm`; `emailDeliveries` aus `@darts-platform/database`; `describeInvitationDelivery`):

```ts
  /**
   * Offene Einladungen mit dem Zustand ihrer juengsten Zustellung. Zwei
   * Abfragen statt einer `DISTINCT ON`-CTE: die Liste ist kurz, und die
   * Reduktion auf die juengste Zeile je Einladung ist in TypeScript
   * lesbarer als in SQL.
   */
  public async listInvitationsOfOrganization(input: {
    readonly organizationId: string;
  }) {
    const invitations = await this.databaseService.database
      .select({
        id: organizationInvitations.id,
        organizationId: organizationInvitations.organizationId,
        email: organizationInvitations.email,
        role: organizationInvitations.role,
        status: organizationInvitations.status,
        expiresAt: organizationInvitations.expiresAt,
      })
      .from(organizationInvitations)
      .where(
        and(
          eq(organizationInvitations.organizationId, input.organizationId),
          eq(organizationInvitations.status, "PENDING"),
          gt(organizationInvitations.expiresAt, new Date()),
        ),
      )
      .orderBy(organizationInvitations.createdAt);

    if (invitations.length === 0) return [];

    const deliveries = await this.databaseService.database
      .select({
        invitationId: emailDeliveries.invitationId,
        sentAt: emailDeliveries.sentAt,
        deadLetteredAt: emailDeliveries.deadLetteredAt,
      })
      .from(emailDeliveries)
      .where(
        and(
          eq(emailDeliveries.organizationId, input.organizationId),
          inArray(emailDeliveries.invitationId, invitations.map((invitation) => invitation.id)),
        ),
      )
      .orderBy(desc(emailDeliveries.createdAt));

    const latest = new Map<string, { sentAt: Date | null; deadLetteredAt: Date | null }>();
    for (const delivery of deliveries) {
      if (delivery.invitationId !== null && !latest.has(delivery.invitationId)) {
        latest.set(delivery.invitationId, delivery);
      }
    }

    return invitations.map((invitation) => ({
      ...invitation,
      lastDelivery: describeInvitationDelivery(latest.get(invitation.id)),
    }));
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/organizations/ && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/organizations
git commit -m "feat(api): Einladungsliste traegt den Zustand der juengsten Zustellung"
```

---

### Task 8: API — Einladung erneut senden

**Files:**
- Modify: `apps/api/src/organizations/organizations.repository.ts` (`resendInvitation`)
- Modify: `apps/api/src/organizations/organizations.service.ts` (`resendInvitation`)
- Modify: `apps/api/src/organizations/organizations.controller.ts` (Route)
- Modify: `apps/api/src/common/rate-limit.ts` (Muster)
- Modify: `apps/web/src/lib/api-client.ts` (Fehlertext, siehe Step 3)
- Test: Ergänzung `apps/api/src/organizations/invitation-email.integration.spec.ts`, `apps/api/src/common/rate-limit.integration.spec.ts`

**Interfaces:**
- Consumes: `enqueueInvitationEmail` (Task 6), `generateInvitationClaimToken`, `hashInvitationClaimToken`.
- Produces: `POST /api/v1/organizations/:organizationId/invitations/:invitationId/resend` → `CreatedInvitation`; Repository `resendInvitation(input): Promise<ResendInvitationResult>` mit `type ResendInvitationResult = { outcome: "resent"; invitation: InvitationRow } | { outcome: "not-found" }`; Fehlercode `INVITATION_NOT_OPEN` (404); Audit `MEMBER_INVITATION_RESENT`.

- [ ] **Step 1: Write the failing tests**

In `invitation-email.integration.spec.ts` Imports ergänzen (`auditEvents`, `organizationInvitations`, `hashInvitationClaimToken` aus `../auth/invitation-claim.js`, `NotFoundException` aus `@nestjs/common`, `createApiTestApplication`) und anhängen:

```ts
describe("Einladung erneut senden", () => {
  it("rotiert den Code, verlaengert den Ablauf, legt eine zweite Zeile an und auditiert", async () => {
    const email = `resend-${randomUUID()}@example.test`;
    const created = await service.invite({ organizationId, data: { email, role: "MEMBER" }, auth: ownerAuth, audit });
    const resendAt = Date.now();

    const resent = await service.resendInvitation({ organizationId, invitationId: created.id, auth: ownerAuth, audit });

    expect(resent.id).toBe(created.id);
    expect(resent.claimToken).not.toBe(created.claimToken);
    expect(resent.expiresAt.getTime()).toBeGreaterThanOrEqual(resendAt + 47 * 60 * 60 * 1000);

    const [row] = await databaseService.database
      .select({ claimTokenHash: organizationInvitations.claimTokenHash, status: organizationInvitations.status })
      .from(organizationInvitations)
      .where(eq(organizationInvitations.id, created.id));
    expect(row?.status).toBe("PENDING");
    expect(row?.claimTokenHash).toBe(hashInvitationClaimToken(resent.claimToken));
    expect(row?.claimTokenHash).not.toBe(hashInvitationClaimToken(created.claimToken));

    const deliveries = await databaseService.database
      .select({ payload: emailDeliveries.payload })
      .from(emailDeliveries)
      .where(eq(emailDeliveries.invitationId, created.id))
      .orderBy(desc(emailDeliveries.createdAt));
    expect(deliveries).toHaveLength(2);
    expect(invitationEmailPayloadSchema.parse(deliveries[0]!.payload).invitationUrl).toContain(`#code=${resent.claimToken}`);

    const audits = await databaseService.database
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.entityId, created.id));
    expect(audits.map((entry) => entry.action)).toContain("MEMBER_INVITATION_RESENT");
  });

  it("weist eine zurueckgezogene Einladung mit 404 ab und legt keine Zeile an", async () => {
    const email = `closed-${randomUUID()}@example.test`;
    const created = await service.invite({ organizationId, data: { email, role: "MEMBER" }, auth: ownerAuth, audit });
    await service.cancelInvitation({ organizationId, invitationId: created.id, auth: ownerAuth, audit });

    await expect(
      service.resendInvitation({ organizationId, invitationId: created.id, auth: ownerAuth, audit }),
    ).rejects.toBeInstanceOf(NotFoundException);
    const deliveries = await databaseService.database
      .select({ id: emailDeliveries.id })
      .from(emailDeliveries)
      .where(eq(emailDeliveries.invitationId, created.id));
    expect(deliveries).toHaveLength(1);
  });

  it("findet eine Einladung einer fremden Organisation nicht", async () => {
    const email = `foreign-${randomUUID()}@example.test`;
    const created = await service.invite({ organizationId, data: { email, role: "MEMBER" }, auth: ownerAuth, audit });
    const foreignOrganizationId = randomUUID();
    await databaseService.database.insert(organizations).values({
      id: foreignOrganizationId, name: "Fremd", slug: `fremd-${foreignOrganizationId}`, timezone: "Europe/Zurich", locale: "de-CH",
    });
    await databaseService.database.insert(memberships).values({ organizationId: foreignOrganizationId, userId: ownerUserId, role: "OWNER", status: "ACTIVE" });
    try {
      await expect(
        service.resendInvitation({ organizationId: foreignOrganizationId, invitationId: created.id, auth: ownerAuth, audit }),
      ).rejects.toBeInstanceOf(NotFoundException);
    } finally {
      await databaseService.database.delete(organizations).where(eq(organizations.id, foreignOrganizationId));
    }
  });

  it("antwortet ueber HTTP mit dem neuen Code und liegt unter der sensiblen Stufe", async () => {
    const app = await createApiTestApplication({ RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: 1 });
    try {
      const url = `/api/v1/organizations/${organizationId}/invitations/${randomUUID()}/resend`;
      const first = await app.inject({ method: "POST", url });
      expect(first.statusCode).not.toBe(429);
      const second = await app.inject({ method: "POST", url });
      expect(second.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });
});
```

In `apps/api/src/common/rate-limit.integration.spec.ts` neben dem Fall «belaesst die Annahme einer Einladung auf der sensiblen Stufe» ergänzen (dieselbe Struktur wie dort, mit `RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: 1` und zwei Aufrufen):

```ts
  it("ordnet das erneute Senden und die Vorschau einer Einladung der sensiblen Stufe zu", async () => {
    const isolatedApp = await createApiTestApplication({ RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: 1 });
    try {
      for (const url of [
        `/api/v1/organizations/${randomUUID()}/invitations/${randomUUID()}/resend`,
        `/api/v1/invitations/${randomUUID()}/preview`,
      ]) {
        const first = await isolatedApp.inject({ method: "POST", url, payload: {} });
        expect(first.statusCode).not.toBe(429);
        const second = await isolatedApp.inject({ method: "POST", url, payload: {} });
        expect(second.statusCode).toBe(429);
      }
    } finally {
      await isolatedApp.close();
    }
  });
```

(Der Preview-Pfad wird in Task 9 gebaut; das Rate-Limit greift schon vorher, weil es vor dem Routing zaehlt — der Test laeuft daher bereits nach dieser Task gruen.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/organizations/invitation-email.integration.spec.ts src/common/rate-limit.integration.spec.ts`
Expected: FAIL — `resendInvitation` existiert nicht.

- [ ] **Step 3: Write minimal implementation**

Repository, neuer Ergebnistyp neben `CreateInvitationResult`:

```ts
export type ResendInvitationResult =
  | { readonly outcome: "resent"; readonly invitation: InvitationRow }
  | { readonly outcome: "not-found" };
```

Neue Methode nach `cancelInvitation`:

```ts
  /**
   * Erzeugt einen neuen Code fuer eine offene Einladung und legt einen
   * neuen Versandauftrag an. Weil nur der Hash gespeichert ist, laesst sich
   * der alte Code nicht erneut versenden — er wird hier ungueltig. Der
   * Ablauf beginnt neu bei 48 Stunden. Das `WHERE` verlangt `PENDING` und
   * die Organisation: eine angenommene, zurueckgezogene oder fremde
   * Einladung trifft keine Zeile.
   */
  public async resendInvitation(input: {
    readonly organizationId: string;
    readonly invitationId: string;
    readonly webOrigin: string;
  } & ActorInput): Promise<ResendInvitationResult> {
    const claimToken = generateInvitationClaimToken();
    const claimTokenHash = hashInvitationClaimToken(claimToken);

    return this.databaseService.database.transaction(async (transaction) => {
      const [invitation] = await transaction
        .update(organizationInvitations)
        .set({
          claimTokenHash,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 48),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(organizationInvitations.id, input.invitationId),
            eq(organizationInvitations.organizationId, input.organizationId),
            eq(organizationInvitations.status, "PENDING"),
          ),
        )
        .returning();

      if (invitation === undefined) return { outcome: "not-found" } as const;

      await this.enqueueInvitationEmail(transaction, {
        organizationId: input.organizationId,
        invitationId: invitation.id,
        recipient: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        inviterUserId: input.userId,
        claimToken,
        webOrigin: input.webOrigin,
      });

      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        actorUserId: input.userId,
        action: "MEMBER_INVITATION_RESENT",
        entityType: "OrganizationInvitation",
        entityId: invitation.id,
        newValue: { email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt.toISOString() },
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });

      return { outcome: "resent", invitation: { ...invitation, claimToken } } as const;
    });
  }
```

Service, nach `cancelInvitation`:

```ts
  /** Neuer Code und neue Mail fuer eine offene Einladung; der alte Code verfaellt. */
  public async resendInvitation(input: {
    readonly organizationId: string;
    readonly invitationId: string;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<CreatedInvitation> {
    await this.organizationAccessService.requirePermission({
      organizationId: input.organizationId,
      userId: input.auth.user.id,
      permission: "organization:manage_members",
    });

    const result = await this.organizationsRepository.resendInvitation({
      organizationId: input.organizationId,
      invitationId: input.invitationId,
      userId: input.auth.user.id,
      audit: input.audit,
      webOrigin: this.environment.WEB_ORIGIN,
    });

    if (result.outcome === "not-found") {
      throw new NotFoundException({
        code: "INVITATION_NOT_OPEN",
        message: "This invitation does not exist or is no longer open.",
      });
    }
    return createdInvitationSchema.parse(result.invitation);
  }
```

Controller, nach `cancelInvitation`:

```ts
  @Post(":organizationId/invitations/:invitationId/resend")
  public async resendInvitation(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("invitationId", ParseUUIDPipe) invitationId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<CreatedInvitation> {
    return this.organizationsService.resendInvitation({
      organizationId,
      invitationId,
      auth,
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
    });
  }
```

`apps/api/src/common/rate-limit.ts`, `SENSITIVE_PATH_PATTERNS` ergänzen und Kommentar erweitern:

```ts
const SENSITIVE_PATH_PATTERNS: readonly RegExp[] = [
  /^\/api\/v1\/invitations\/[^/]+\/accept$/u,
  // Vorschau prueft den Code, erneutes Senden erzeugt Mails an Dritte — beide
  // gehoeren hinter die enge Grenze (Spec 2026-09-20-email-versand).
  /^\/api\/v1\/invitations\/[^/]+\/preview$/u,
  /^\/api\/v1\/organizations\/[^/]+\/invitations\/[^/]+\/resend$/u,
  /^\/api\/v1\/auth\/sign-in\//u,
  /^\/api\/v1\/auth\/sign-up\//u,
  /^\/api\/v1\/auth\/request-password-reset$/u,
];
```

In `apps/web/src/lib/api-client.ts` in `messages` ergänzen:

```ts
    INVITATION_NOT_OPEN: "Diese Einladung ist nicht mehr offen. Erstelle bei Bedarf eine neue.",
    INVITATION_NOT_FOUND: "Diese Einladung ist ungültig oder abgelaufen.",
```

Falls `apps/api/src/security/tenant-isolation-matrix.integration.spec.ts` nach dieser Task meldet, dass für die neue Route ein Payload-Eintrag fehlt, in dessen Payload-Tabelle ergänzen:

```ts
  "POST /api/v1/organizations/:organizationId/invitations/:invitationId/resend": {},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/organizations/ src/common/rate-limit.integration.spec.ts src/security/ src/testing/ && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src apps/web/src/lib/api-client.ts
git commit -m "feat(api): Einladung erneut senden rotiert den Code und legt einen neuen Versandauftrag an"
```

---

### Task 9: API — öffentliche Einladungsvorschau

**Files:**
- Create: `apps/api/src/organizations/invitation-preview.controller.ts`
- Modify: `apps/api/src/organizations/organizations.repository.ts` (`previewInvitation`)
- Modify: `apps/api/src/organizations/organizations.service.ts` (`previewInvitation`)
- Modify: `apps/api/src/organizations/organizations.module.ts` (Controller registrieren)
- Test: Ergänzung `apps/api/src/organizations/invitation-email.integration.spec.ts`

**Interfaces:**
- Consumes: `invitationClaimMatches`, `previewInvitationInputSchema`, `invitationPreviewSchema` (Task 1), `@Public()` aus `../auth/public.decorator.js`.
- Produces: `POST /api/v1/invitations/:invitationId/preview` mit Body `{ claimToken }` → `InvitationPreview` oder 404 `INVITATION_NOT_FOUND`; Repository `previewInvitation({ invitationId, claimToken }): Promise<InvitationPreview | null>`.

- [ ] **Step 1: Write the failing tests**

An `invitation-email.integration.spec.ts` anhängen (Imports: `invitationPreviewSchema`, `apiErrorSchema` aus `@darts-platform/schemas`):

```ts
describe("Einladungsvorschau", () => {
  it("liefert Organisation, Rolle, E-Mail und Ablauf bei gueltigem Code — ohne Sitzung", async () => {
    const email = `preview-${randomUUID()}@example.test`;
    const created = await service.invite({ organizationId, data: { email, role: "SCORER" }, auth: ownerAuth, audit });
    const app = await createApiTestApplication();
    try {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/invitations/${created.id}/preview`,
        payload: { claimToken: created.claimToken },
      });
      expect(response.statusCode).toBe(201);
      const preview = invitationPreviewSchema.parse(response.json());
      expect(preview).toEqual({
        organizationName: "Mailverein",
        role: "SCORER",
        email,
        expiresAt: created.expiresAt,
      });
    } finally {
      await app.close();
    }
  });

  it("antwortet fuer falschen Code, fremde ID und abgelaufene Einladung identisch mit 404", async () => {
    const email = `preview-404-${randomUUID()}@example.test`;
    const created = await service.invite({ organizationId, data: { email, role: "MEMBER" }, auth: ownerAuth, audit });
    const wrongCode = created.claimToken.slice(0, -1) + (created.claimToken.endsWith("A") ? "B" : "A");
    const app = await createApiTestApplication();
    try {
      const wrong = await app.inject({ method: "POST", url: `/api/v1/invitations/${created.id}/preview`, payload: { claimToken: wrongCode } });
      const unknown = await app.inject({ method: "POST", url: `/api/v1/invitations/${randomUUID()}/preview`, payload: { claimToken: created.claimToken } });
      await databaseService.database
        .update(organizationInvitations)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(organizationInvitations.id, created.id));
      const expired = await app.inject({ method: "POST", url: `/api/v1/invitations/${created.id}/preview`, payload: { claimToken: created.claimToken } });

      for (const response of [wrong, unknown, expired]) {
        expect(response.statusCode).toBe(404);
        expect(apiErrorSchema.parse(response.json()).error.code).toBe("INVITATION_NOT_FOUND");
      }
      expect(wrong.json()).toMatchObject({ error: { code: "INVITATION_NOT_FOUND", message: expired.json().error.message } });
    } finally {
      await app.close();
    }
  });

  it("weist einen Body ohne gueltiges Code-Format mit 400 ab", async () => {
    const app = await createApiTestApplication();
    try {
      const response = await app.inject({ method: "POST", url: `/api/v1/invitations/${randomUUID()}/preview`, payload: { claimToken: "kurz" } });
      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/organizations/invitation-email.integration.spec.ts`
Expected: FAIL — 404 vom Router statt 201 (Route existiert nicht).

- [ ] **Step 3: Write minimal implementation**

Repository, nach `listPendingInvitations`:

```ts
  /**
   * Vorschau fuer die Einladungsseite. Erst wird die offene, nicht
   * abgelaufene Einladung geladen, dann der Code in konstanter Zeit gegen
   * den Hash geprueft. Jede Abweichung ergibt `null` — der Aufrufer
   * antwortet einheitlich, ohne die Ursache zu nennen.
   */
  public async previewInvitation(input: {
    readonly invitationId: string;
    readonly claimToken: string;
  }): Promise<{
    readonly organizationName: string;
    readonly role: string;
    readonly email: string;
    readonly expiresAt: Date;
  } | null> {
    const [row] = await this.databaseService.database
      .select({
        organizationName: organizations.name,
        role: organizationInvitations.role,
        email: organizationInvitations.email,
        expiresAt: organizationInvitations.expiresAt,
        claimTokenHash: organizationInvitations.claimTokenHash,
      })
      .from(organizationInvitations)
      .innerJoin(organizations, eq(organizationInvitations.organizationId, organizations.id))
      .where(
        and(
          eq(organizationInvitations.id, input.invitationId),
          eq(organizationInvitations.status, "PENDING"),
          gt(organizationInvitations.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (row === undefined || !invitationClaimMatches(input.claimToken, row.claimTokenHash)) {
      return null;
    }
    const { claimTokenHash: _hash, ...preview } = row;
    return preview;
  }
```

(Import `invitationClaimMatches` aus `../auth/invitation-claim.js` ergänzen.)

Service:

```ts
  /** Oeffentlich: keine Sitzung, keine Organisation im Pfad; die Antwort verraet nur bei passendem Code etwas. */
  public async previewInvitation(input: {
    readonly invitationId: string;
    readonly data: PreviewInvitationInput;
  }): Promise<InvitationPreview> {
    const preview = await this.organizationsRepository.previewInvitation({
      invitationId: input.invitationId,
      claimToken: input.data.claimToken,
    });
    if (preview === null) {
      throw new NotFoundException({
        code: "INVITATION_NOT_FOUND",
        message: "This invitation is invalid or has expired.",
      });
    }
    return invitationPreviewSchema.parse(preview);
  }
```

(Imports `invitationPreviewSchema`, `type InvitationPreview`, `type PreviewInvitationInput` aus `@darts-platform/schemas`.)

`apps/api/src/organizations/invitation-preview.controller.ts` — eigener Controller mit `@Public()` auf Klassenebene, damit die Freigabe unabhängig davon gilt, ob der Guard Methoden-Metadaten liest:

```ts
import { Body, Controller, Inject, Param, ParseUUIDPipe, Post } from "@nestjs/common";

import {
  previewInvitationInputSchema,
  type InvitationPreview,
  type PreviewInvitationInput,
} from "@darts-platform/schemas";

import { Public } from "../auth/public.decorator.js";
import { parseBody } from "../common/parse-body.js";
import { OrganizationsService } from "./organizations.service.js";

/**
 * Oeffentlicher Endpunkt der Einladungsseite: die eingeladene Person hat
 * noch kein Konto. Er gibt nur nach erfolgreichem Hash-Vergleich etwas
 * zurueck und liegt unter dem sensiblen Rate-Limit (`rate-limit.ts`).
 */
@Controller("invitations")
@Public()
export class InvitationPreviewController {
  public constructor(
    @Inject(OrganizationsService)
    private readonly organizationsService: OrganizationsService,
  ) {}

  @Post(":invitationId/preview")
  public async preview(
    @Param("invitationId", ParseUUIDPipe) invitationId: string,
    @Body() body: unknown,
  ): Promise<InvitationPreview> {
    const data: PreviewInvitationInput = parseBody(previewInvitationInputSchema, body);
    return this.organizationsService.previewInvitation({ invitationId, data });
  }
}
```

`organizations.module.ts`: `InvitationPreviewController` importieren und in `controllers` aufnehmen.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/organizations/ src/common/ src/security/ src/testing/ && pnpm typecheck`
Expected: PASS. Falls `http-boundary.integration.spec.ts` oder das Routeninventar öffentliche Routen explizit auflistet, den neuen Pfad dort ergänzen.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/organizations
git commit -m "feat(api): oeffentliche Einladungsvorschau nach Hash-Vergleich"
```

---

### Task 10: API — Passwort-Reset über Better Auth

**Files:**
- Modify: `apps/api/src/auth/auth.factory.ts`
- Test: `apps/api/src/auth/password-reset.integration.spec.ts`

**Interfaces:**
- Consumes: `enqueueEmailDelivery` (Task 5), Better Auth 1.7.1 `emailAndPassword.sendResetPassword({ user, url, token }, request)`, `revokeSessionsOnPasswordReset`, Route `/request-password-reset` (Body `{ email, redirectTo }`), Callback `/reset-password/:token?callbackURL=…` leitet auf `redirectTo?token=…` oder `redirectTo?error=INVALID_TOKEN`, `POST /reset-password` mit `{ newPassword, token }`.
- Produces: Reset-Anforderung legt eine `PASSWORD_RESET`-Zeile an; Sitzungen enden nach Reset.

- [ ] **Step 1: Write the failing test**

`apps/api/src/auth/password-reset.integration.spec.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { emailDeliveries, users } from "@darts-platform/database";
import { passwordResetEmailPayloadSchema } from "@darts-platform/schemas";

import { DatabaseService } from "../database/database.service.js";
import { createApiTestApplication } from "../testing/api-harness.js";

const environment = parseApplicationEnvironment(process.env);
const databaseService = new DatabaseService(environment);
const userId = randomUUID();
const email = `reset-${userId}@example.test`;
const redirectTo = `${environment.WEB_ORIGIN}/passwort/neu`;
let app: NestFastifyApplication;

beforeAll(async () => {
  app = await createApiTestApplication();
  await databaseService.database.insert(users).values({ id: userId, email, displayName: "Reset Person" });
}, 60_000);

afterAll(async () => {
  await databaseService.database.delete(users).where(eq(users.id, userId));
  await databaseService.onApplicationShutdown();
  await app.close();
});

async function resetDeliveriesFor(recipient: string) {
  return databaseService.database
    .select()
    .from(emailDeliveries)
    .where(and(eq(emailDeliveries.recipient, recipient), eq(emailDeliveries.kind, "PASSWORD_RESET")));
}

describe("Passwort-Reset", () => {
  it("legt fuer ein bekanntes Konto eine PASSWORD_RESET-Zeile mit der Better-Auth-URL an", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/request-password-reset",
      payload: { email, redirectTo },
      headers: { origin: environment.WEB_ORIGIN },
    });
    expect(response.statusCode).toBe(200);

    // Better Auth ruft den Hook ueber `runInBackgroundOrAwait`; kurz pollen.
    await expect.poll(async () => (await resetDeliveriesFor(email)).length, { timeout: 5_000 }).toBe(1);
    const [row] = await resetDeliveriesFor(email);
    expect(row?.organizationId).toBeNull();
    expect(row?.invitationId).toBeNull();
    const payload = passwordResetEmailPayloadSchema.parse(row?.payload);
    expect(payload.recipientName).toBe("Reset Person");
    expect(payload.resetUrl).toContain("/api/v1/auth/reset-password/");
    expect(payload.resetUrl).toContain(`callbackURL=${encodeURIComponent(redirectTo)}`);
  });

  it("antwortet fuer eine unbekannte Adresse gleich, legt aber keine Zeile an", async () => {
    const unknown = `nobody-${randomUUID()}@example.test`;
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/request-password-reset",
      payload: { email: unknown, redirectTo },
      headers: { origin: environment.WEB_ORIGIN },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: true });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await resetDeliveriesFor(unknown)).toEqual([]);
  });

  it("lehnt einen redirectTo ausserhalb der vertrauten Ursprünge ab", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/request-password-reset",
      payload: { email, redirectTo: "https://boese.example/phish" },
      headers: { origin: environment.WEB_ORIGIN },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/auth/password-reset.integration.spec.ts`
Expected: FAIL — Better Auth antwortet 400 `RESET_PASSWORD_DISABLED`.

- [ ] **Step 3: Write minimal implementation**

In `auth.factory.ts`: Import `enqueueEmailDelivery` aus `@darts-platform/database`. Den `emailAndPassword`-Block ersetzen:

```ts
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      // Nach einem Reset enden alle bestehenden Sitzungen: wer das Passwort
      // zurueckgesetzt hat, will fremde Sitzungen los sein.
      revokeSessionsOnPasswordReset: true,
      // Kein direkter Versand: der Hook legt nur den Versandauftrag an, der
      // Worker versendet (Spec 2026-09-20-email-versand). Better Auth hat
      // das Token an dieser Stelle bereits persistiert; scheitert der
      // Insert, antwortet Better Auth mit Fehler und die Person kann es
      // erneut versuchen — das Token verfaellt nach einer Stunde von selbst.
      sendResetPassword: async ({ user, url }) => {
        await enqueueEmailDelivery(database, {
          kind: "PASSWORD_RESET",
          recipient: user.email,
          payload: { recipientName: user.name, resetUrl: url },
        });
      },
    },
```

In `rateLimit.customRules` ergänzen:

```ts
        "/request-password-reset": {
          window: 60,
          max: environment.RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE,
        },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/auth/ && pnpm typecheck`
Expected: PASS, auch `auth.integration.spec.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth
git commit -m "feat(api): Passwort-Reset legt Versandauftrag an und beendet alte Sitzungen"
```

---

### Task 11: Worker — Mail-Poller und Aufräumregel

**Files:**
- Create: `apps/worker/src/email/process-email-deliveries.ts`, `apps/worker/src/email/prune-email-deliveries.ts`
- Modify: `apps/worker/src/main.ts`, `apps/worker/package.json` (Dependency `@darts-platform/notifications`)
- Test: `apps/worker/src/email/process-email-deliveries.integration.spec.ts`, `apps/worker/src/email/prune-email-deliveries.integration.spec.ts`

**Interfaces:**
- Consumes: `emailDeliveries`, `emailDeliveryPending`, `markEmailDeliverySent`, `recordEmailDeliveryFailure`, `EMAIL_DELIVERY_BATCH_SIZE`, `OUTBOX_MAX_ATTEMPTS`, `OutboxLogger` (Task 5); `renderEmailDelivery`, `createEmailSender`, `EmailSender` (Task 4).
- Produces: `processEmailDeliveries(options: { database: Database; sender: EmailSender; logger: OutboxLogger; limit?: number; maxAttempts?: number; now?: () => Date }): Promise<number>`; `pruneEmailDeliveries(database, now, retentionDays = 30, batchSize = 1000): Promise<number>`; `EMAIL_DELIVERY_RETENTION_DAYS = 30`.

- [ ] **Step 1: Write the failing tests**

`apps/worker/src/email/process-email-deliveries.integration.spec.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  createDatabaseConnection,
  emailDeliveries,
  enqueueEmailDelivery,
  OUTBOX_MAX_ATTEMPTS,
  organizations,
} from "@darts-platform/database";
import type { EmailMessage, EmailSender, EmailSendResult } from "@darts-platform/notifications";

import { processEmailDeliveries } from "./process-email-deliveries.js";

const environment = parseApplicationEnvironment(process.env);
const connection = createDatabaseConnection(environment.DATABASE_URL);
const database = connection.database;
const organizationId = randomUUID();
const now = new Date("2026-09-20T12:00:00.000Z");
const logger = { emit: vi.fn() };

const payload = {
  organizationName: "Beispielverein",
  inviterName: "Alex",
  role: "MEMBER",
  invitationUrl: "https://dartbase.example/einladung/x#code=y",
  expiresAt: "2026-09-22T12:00:00.000Z",
};

class FakeSender implements EmailSender {
  public readonly calls: { message: EmailMessage; key: string }[] = [];
  public constructor(private readonly result: (message: EmailMessage) => EmailSendResult | Promise<EmailSendResult>) {}
  public async send(message: EmailMessage, key: string): Promise<EmailSendResult> {
    this.calls.push({ message, key });
    return this.result(message);
  }
}

async function enqueue(recipient: string, overrides: Partial<Parameters<typeof enqueueEmailDelivery>[1]> = {}) {
  return enqueueEmailDelivery(database, { kind: "INVITATION", recipient, organizationId, payload, ...overrides });
}

async function readRow(id: string) {
  const [row] = await database.select().from(emailDeliveries).where(eq(emailDeliveries.id, id));
  if (row === undefined) throw new Error("Zeile fehlt");
  return row;
}

beforeAll(async () => {
  await database.insert(organizations).values({
    id: organizationId, name: "Worker Mail Club", slug: `worker-mail-${organizationId}`, timezone: "Europe/Zurich", locale: "de-CH",
  });
});

afterAll(async () => {
  await database.delete(organizations).where(eq(organizations.id, organizationId));
  await connection.close();
});

describe("processEmailDeliveries", () => {
  it("rendert, versendet mit der Zeilen-ID als Idempotency-Key und bucht den Erfolg", async () => {
    const recipient = `ok-${randomUUID()}@example.test`;
    const { id } = await enqueue(recipient);
    const sender = new FakeSender(() => ({ kind: "sent", providerMessageId: "msg_1" }));

    const processed = await processEmailDeliveries({ database, sender, logger, now: () => now });

    expect(processed).toBeGreaterThanOrEqual(1);
    const call = sender.calls.find((entry) => entry.key === id);
    expect(call?.message.to).toBe(recipient);
    expect(call?.message.subject).toBe("Einladung zu Beispielverein auf DartBase");
    const row = await readRow(id);
    expect(row.sentAt).not.toBeNull();
    expect(row.providerMessageId).toBe("msg_1");
    expect(row.payload).toBeNull();
  });

  it("bucht retryable mit Backoff und ueberspringt die Zeile im naechsten Lauf", async () => {
    const { id } = await enqueue(`retry-${randomUUID()}@example.test`);
    const sender = new FakeSender(() => ({ kind: "retryable", reason: "503 service_unavailable" }));

    await processEmailDeliveries({ database, sender, logger, now: () => now });
    const first = await readRow(id);
    expect(first.attempts).toBe(1);
    expect(first.notBefore?.getTime()).toBe(now.getTime() + 1_000);
    expect(first.payload).toEqual(payload);

    const second = new FakeSender(() => ({ kind: "sent", providerMessageId: "x" }));
    await processEmailDeliveries({ database, sender: second, logger, now: () => now });
    expect(second.calls.some((entry) => entry.key === id)).toBe(false);

    await processEmailDeliveries({ database, sender: second, logger, now: () => new Date(now.getTime() + 2_000) });
    expect(second.calls.some((entry) => entry.key === id)).toBe(true);
  });

  it("legt rejected sofort ins Dead-Letter und leert den Payload", async () => {
    const { id } = await enqueue(`rejected-${randomUUID()}@example.test`);
    const sender = new FakeSender(() => ({ kind: "rejected", reason: "422 validation_error: Invalid `to` field" }));

    await processEmailDeliveries({ database, sender, logger, now: () => now });
    const row = await readRow(id);
    expect(row.deadLetteredAt).not.toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.payload).toBeNull();
    expect(row.lastError).toContain("422");
    expect(logger.emit).toHaveBeenCalledWith("error", expect.objectContaining({ event: "email.dead_letter", deliveryId: id }));
  });

  it("legt nach der Hoechstzahl Versuche ins Dead-Letter", async () => {
    const { id } = await enqueue(`max-${randomUUID()}@example.test`);
    await database.update(emailDeliveries).set({ attempts: OUTBOX_MAX_ATTEMPTS - 1 }).where(eq(emailDeliveries.id, id));
    const sender = new FakeSender(() => ({ kind: "retryable", reason: "500" }));
    await processEmailDeliveries({ database, sender, logger, now: () => now });
    const row = await readRow(id);
    expect(row.deadLetteredAt).not.toBeNull();
    expect(row.payload).toBeNull();
  });

  it("legt einen Payload, der nicht zum Schema passt, ins Dead-Letter ohne zu senden", async () => {
    const { id } = await enqueue(`bad-${randomUUID()}@example.test`, { payload: { organizationName: "nur das" } });
    const sender = new FakeSender(() => ({ kind: "sent", providerMessageId: "x" }));
    await processEmailDeliveries({ database, sender, logger, now: () => now });
    expect(sender.calls.some((entry) => entry.key === id)).toBe(false);
    const row = await readRow(id);
    expect(row.deadLetteredAt).not.toBeNull();
    expect(row.lastError).toContain("invitationUrl");
  });

  it("behandelt einen werfenden Sender wie retryable", async () => {
    const { id } = await enqueue(`throw-${randomUUID()}@example.test`);
    const sender = new FakeSender(() => {
      throw new Error("kaputt");
    });
    await processEmailDeliveries({ database, sender, logger, now: () => now });
    const row = await readRow(id);
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe("kaputt");
    expect(row.deadLetteredAt).toBeNull();
  });

  it("verteilt einen Stapel auf zwei gleichzeitige Laeufe ohne Doppelversand", async () => {
    const ids = await Promise.all(Array.from({ length: 6 }, (_, index) => enqueue(`par-${index}-${randomUUID()}@example.test`)));
    const keys = new Set(ids.map((entry) => entry.id));
    const slow = new FakeSender(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return { kind: "sent", providerMessageId: "p" };
    });
    await Promise.all([
      processEmailDeliveries({ database, sender: slow, logger, now: () => now, limit: 3 }),
      processEmailDeliveries({ database, sender: slow, logger, now: () => now, limit: 3 }),
    ]);
    const ownCalls = slow.calls.filter((entry) => keys.has(entry.key)).map((entry) => entry.key);
    expect(new Set(ownCalls).size).toBe(ownCalls.length);
    const rows = await database.select({ sentAt: emailDeliveries.sentAt }).from(emailDeliveries).where(inArray(emailDeliveries.id, [...keys]));
    expect(rows.every((row) => row.sentAt !== null)).toBe(true);
  }, 20_000);
});
```

`apps/worker/src/email/prune-email-deliveries.integration.spec.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { createDatabaseConnection, emailDeliveries, organizations } from "@darts-platform/database";

import { EMAIL_DELIVERY_RETENTION_DAYS, pruneEmailDeliveries } from "./prune-email-deliveries.js";

const environment = parseApplicationEnvironment(process.env);
const connection = createDatabaseConnection(environment.DATABASE_URL);
const organizationId = randomUUID();
const now = new Date("2026-09-20T12:00:00.000Z");
const old = new Date(now.getTime() - (EMAIL_DELIVERY_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000);
const recent = new Date(now.getTime() - 60 * 1000);

beforeAll(async () => {
  await connection.database.insert(organizations).values({
    id: organizationId, name: "Prune Mail", slug: `prune-mail-${organizationId}`, timezone: "Europe/Zurich", locale: "de-CH",
  });
});

afterAll(async () => {
  await connection.database.delete(organizations).where(eq(organizations.id, organizationId));
  await connection.close();
});

describe("pruneEmailDeliveries", () => {
  it("entfernt nur alte versendete oder dead-geletterte Zeilen", async () => {
    const base = { kind: "INVITATION", recipient: "x@example.test", organizationId, createdAt: old };
    const rows = await connection.database
      .insert(emailDeliveries)
      .values([
        // 0: alt, versendet -> weg
        { ...base, payload: null, sentAt: old },
        // 1: alt, dead-gelettet -> weg
        { ...base, payload: null, deadLetteredAt: old, attempts: 8 },
        // 2: alt, aber offen -> bleibt
        { ...base, payload: {} },
        // 3: frisch versendet -> bleibt
        { ...base, payload: null, sentAt: recent, createdAt: recent },
      ])
      .returning({ id: emailDeliveries.id });
    const ids = rows.map((row) => row.id);

    const removed = await pruneEmailDeliveries(connection.database, now);

    expect(removed).toBeGreaterThanOrEqual(2);
    const remaining = await connection.database
      .select({ id: emailDeliveries.id })
      .from(emailDeliveries)
      .where(inArray(emailDeliveries.id, ids));
    expect(new Set(remaining.map((row) => row.id))).toEqual(new Set([ids[2], ids[3]]));
  }, 30_000);

  it("begrenzt einen Lauf auf die Batchgroesse", async () => {
    const rows = await connection.database
      .insert(emailDeliveries)
      .values(Array.from({ length: 5 }, () => ({ kind: "INVITATION", recipient: "x@example.test", organizationId, payload: null, sentAt: old, createdAt: old })))
      .returning({ id: emailDeliveries.id });
    const ids = rows.map((row) => row.id);
    const removed = await pruneEmailDeliveries(connection.database, now, EMAIL_DELIVERY_RETENTION_DAYS, 2);
    expect(removed).toBeLessThanOrEqual(2);
    await connection.database.delete(emailDeliveries).where(inArray(emailDeliveries.id, ids));
  }, 30_000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @darts-platform/notifications build && cd apps/worker && npx dotenv -e ../../.env -- npx vitest run src/email/`
Expected: FAIL — Module nicht gefunden.

- [ ] **Step 3: Write minimal implementation**

`apps/worker/package.json`: in `dependencies` `"@darts-platform/notifications": "workspace:*"` ergänzen, dann `pnpm install`.

`apps/worker/src/email/process-email-deliveries.ts`:

```ts
import { asc } from "drizzle-orm";

import {
  EMAIL_DELIVERY_BATCH_SIZE,
  OUTBOX_MAX_ATTEMPTS,
  emailDeliveries,
  emailDeliveryPending,
  markEmailDeliverySent,
  recordEmailDeliveryFailure,
  type Database,
  type DatabaseTransaction,
  type OutboxLogger,
} from "@darts-platform/database";
import { renderEmailDelivery, type EmailSender, type EmailSendResult } from "@darts-platform/notifications";

export interface ProcessEmailDeliveriesOptions {
  readonly database: Database;
  readonly sender: EmailSender;
  readonly logger: OutboxLogger;
  readonly limit?: number;
  readonly maxAttempts?: number;
  readonly now?: () => Date;
}

/**
 * Eine Runde des Mail-Pollers. Beansprucht bis `limit` offene Zeilen mit
 * `FOR UPDATE SKIP LOCKED`, rendert je Zeile das Template, ruft den Sender
 * mit der Zeilen-ID als Idempotency-Key auf und bucht das Ergebnis — alles
 * unter der Zeilensperre, damit eine zweite Replik die Zeile nicht greift,
 * solange der Versand laeuft (dasselbe Muster wie
 * `process-statistics-outbox.ts`). Der Stapel ist deshalb klein.
 *
 * Stirbt der Prozess zwischen Versand und Buchung, rollt die Transaktion
 * zurueck, die Zeile bleibt offen, und der naechste Versuch traegt
 * denselben Idempotency-Key — der Provider liefert nicht doppelt aus.
 *
 * Fehler des Senders (Wurf) gelten als wiederholbar; ein Payload, der nicht
 * zum Schema passt, geht ohne Versand ins Dead-Letter. Jede Buchung laeuft
 * im eigenen Savepoint: ein Postgres-Fehler kostet nur diese Zeile.
 */
export async function processEmailDeliveries(options: ProcessEmailDeliveriesOptions): Promise<number> {
  const { database, sender, logger } = options;
  const currentTime = (options.now ?? (() => new Date()))();
  const maxAttempts = options.maxAttempts ?? OUTBOX_MAX_ATTEMPTS;

  return database.transaction(async (transaction) => {
    const rows = await transaction
      .select()
      .from(emailDeliveries)
      .where(emailDeliveryPending(currentTime))
      .orderBy(asc(emailDeliveries.createdAt))
      .limit(options.limit ?? EMAIL_DELIVERY_BATCH_SIZE)
      .for("update", { skipLocked: true });

    for (const row of rows) {
      const rendered = renderEmailDelivery(row.kind, row.payload);
      if (!rendered.ok) {
        await book(transaction, row.id, { kind: "rejected", reason: rendered.reason }, currentTime, maxAttempts, logger);
        continue;
      }

      let result: EmailSendResult;
      try {
        result = await sender.send({ to: row.recipient, ...rendered.email }, row.id);
      } catch (error: unknown) {
        result = { kind: "retryable", reason: error instanceof Error ? error.message : String(error) };
      }

      await book(transaction, row.id, result, currentTime, maxAttempts, logger);
    }

    return rows.length;
  });
}

async function book(
  transaction: DatabaseTransaction,
  id: string,
  result: EmailSendResult,
  now: Date,
  maxAttempts: number,
  logger: OutboxLogger,
): Promise<void> {
  try {
    await transaction.transaction(async (savepoint) => {
      switch (result.kind) {
        case "sent": {
          await markEmailDeliverySent(savepoint, { id, providerMessageId: result.providerMessageId, now });
          logger.emit("debug", { event: "email.sent", deliveryId: id, providerMessageId: result.providerMessageId });
          return;
        }
        case "retryable":
        case "rejected": {
          await recordEmailDeliveryFailure({
            executor: savepoint,
            id,
            reason: result.reason,
            now,
            maxAttempts,
            permanent: result.kind === "rejected",
            logger,
          });
          return;
        }
        default: {
          const exhaustive: never = result;
          throw new Error(`Unbekanntes Versandergebnis: ${String(exhaustive)}`);
        }
      }
    });
  } catch (bookingError: unknown) {
    logger.emit("error", {
      event: "email.booking_failed",
      deliveryId: id,
      error: bookingError instanceof Error ? bookingError.message : String(bookingError),
    });
  }
}
```

`apps/worker/src/email/prune-email-deliveries.ts`:

```ts
import { and, asc, inArray, isNotNull, lt, or } from "drizzle-orm";

import { emailDeliveries, type Database } from "@darts-platform/database";

export const EMAIL_DELIVERY_RETENTION_DAYS = 30;
export const EMAIL_DELIVERY_PRUNE_BATCH_SIZE = 1000;

/**
 * Entfernt versendete und dead-geletterte Auftraege nach der
 * Aufbewahrungsfrist, in Stapeln, damit ein grosser Rueckstand nicht in
 * einem einzigen langen DELETE gegen die Tabelle des Pollers laeuft.
 * Offene Zeilen bleiben immer stehen.
 */
export async function pruneEmailDeliveries(
  database: Database,
  now: Date,
  retentionDays: number = EMAIL_DELIVERY_RETENTION_DAYS,
  batchSize: number = EMAIL_DELIVERY_PRUNE_BATCH_SIZE,
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const batch = database
    .select({ id: emailDeliveries.id })
    .from(emailDeliveries)
    .where(
      or(
        and(isNotNull(emailDeliveries.sentAt), lt(emailDeliveries.sentAt, cutoff)),
        and(isNotNull(emailDeliveries.deadLetteredAt), lt(emailDeliveries.deadLetteredAt, cutoff)),
      ),
    )
    .orderBy(asc(emailDeliveries.createdAt))
    .limit(batchSize);
  const result = await database.delete(emailDeliveries).where(inArray(emailDeliveries.id, batch));
  return result.count;
}
```

`apps/worker/src/main.ts` ergänzen — Imports:

```ts
import { createEmailSender } from "@darts-platform/notifications";

import { processEmailDeliveries } from "./email/process-email-deliveries.js";
import { pruneEmailDeliveries } from "./email/prune-email-deliveries.js";
```

Nach `logger.emit("log", { event: "worker_started" });`:

```ts
const emailSender = createEmailSender(
  {
    provider: environment.EMAIL_PROVIDER,
    apiKey: environment.RESEND_API_KEY,
    from: environment.EMAIL_FROM,
  },
  outboxLogger,
);
logger.emit("log", { event: "email_sender_ready", provider: environment.EMAIL_PROVIDER });

let deliveringEmails = false;

async function deliverEmails(): Promise<void> {
  if (deliveringEmails) return;
  deliveringEmails = true;
  try {
    await processEmailDeliveries({ database: connection.database, sender: emailSender, logger: outboxLogger });
  } catch (error) {
    logger.emit("error", {
      event: "email.tick_failed",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    deliveringEmails = false;
  }
}
```

In `prune()` nach dem Outbox-Prune:

```ts
    const removedEmails = await pruneEmailDeliveries(connection.database, new Date());
    if (removedEmails > 0) {
      logger.emit("log", { event: "email.pruned", removed: removedEmails });
    }
```

Bei den Intervallen:

```ts
setInterval(() => void deliverEmails(), 1_000);
void deliverEmails();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/worker && npx dotenv -e ../../.env -- npx vitest run && pnpm typecheck && pnpm build`
Expected: PASS, inklusive bestehender Worker-Tests.

- [ ] **Step 5: Smoke: Worker lokal starten**

Run: `cd apps/worker && timeout 5 npx dotenv -e ../../.env -- npx tsx src/main.ts; true`
Expected: Log enthält `worker_started` und `email_sender_ready` mit `provider: "log"`, kein `"level":"error"`.

- [ ] **Step 6: Commit**

```bash
git add apps/worker pnpm-lock.yaml
git commit -m "feat(worker): Mail-Poller mit Idempotency-Key, Backoff, Dead-Letter und Aufraeumregel"
```

---

### Task 12: Web — Einladungsseite `/einladung/[invitationId]`

**Files:**
- Create: `apps/web/src/lib/invitation-link.ts`
- Create: `apps/web/src/app/einladung/[invitationId]/page.tsx`
- Create: `apps/web/src/components/invitation/invitation-route.tsx`
- Test: `apps/web/src/lib/invitation-link.spec.ts`

**Interfaces:**
- Consumes: `invitationPreviewSchema` (Task 1), `POST /invitations/:id/preview` (Task 9), `POST /invitations/:id/accept`, `authClient.signUp.email`, `authClient.useSession`, `apiRequest`, `userFacingErrorMessage`.
- Produces: `readInvitationCode(hash: string): string | null`; `buildInvitationLink(origin: string, invitationId: string, claimToken: string): string` (Web-Gegenstück zu `buildInvitationUrl`, für die Anzeige in Task 14).

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/invitation-link.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildInvitationLink, readInvitationCode } from "./invitation-link";

describe("readInvitationCode", () => {
  it("liest den Code aus dem Fragment", () => {
    expect(readInvitationCode("#code=abc_DEF-123")).toBe("abc_DEF-123");
  });

  it("liefert null ohne Fragment oder ohne code-Parameter", () => {
    expect(readInvitationCode("")).toBeNull();
    expect(readInvitationCode("#")).toBeNull();
    expect(readInvitationCode("#foo=bar")).toBeNull();
  });

  it("liefert null fuer einen leeren Code", () => {
    expect(readInvitationCode("#code=")).toBeNull();
  });
});

describe("buildInvitationLink", () => {
  it("baut denselben Link wie der Server", () => {
    expect(buildInvitationLink("https://dartbase.ch", "11111111-1111-4111-8111-111111111111", "abc")).toBe(
      "https://dartbase.ch/einladung/11111111-1111-4111-8111-111111111111#code=abc",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/lib/invitation-link.spec.ts`
Expected: FAIL — Modul fehlt.

- [ ] **Step 3: Write minimal implementation**

`apps/web/src/lib/invitation-link.ts`:

```ts
/**
 * Der Einladungscode steht im URL-Fragment (`#code=…`), damit er den
 * Browser nicht verlaesst. Diese Regeln sind rein, damit die Seite sie ohne
 * Browser pruefen kann.
 */
export function readInvitationCode(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw.length === 0) return null;
  const code = new URLSearchParams(raw).get("code");
  return code === null || code.length === 0 ? null : code;
}

/** Gegenstueck zu `buildInvitationUrl` in der API — fuer die Anzeige des Fallback-Links. */
export function buildInvitationLink(origin: string, invitationId: string, claimToken: string): string {
  return `${new URL(origin).origin}/einladung/${encodeURIComponent(invitationId)}#code=${encodeURIComponent(claimToken)}`;
}
```

`apps/web/src/app/einladung/[invitationId]/page.tsx`:

```tsx
import type { Metadata } from "next";

import { InvitationRoute } from "@/components/invitation/invitation-route";

export const metadata: Metadata = {
  title: "Einladung",
  description: "Einladung zu einer Organisation auf DartBase annehmen.",
};

interface PageProps {
  readonly params: Promise<{ readonly invitationId: string }>;
}

export default async function InvitationPage({ params }: PageProps) {
  const { invitationId } = await params;
  return (
    <main className="flex min-h-screen justify-center px-4 py-10 sm:px-6">
      <div className="w-full max-w-xl">
        <InvitationRoute invitationId={invitationId} />
      </div>
    </main>
  );
}
```

`apps/web/src/components/invitation/invitation-route.tsx`:

```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { invitationPreviewSchema, type InvitationPreview } from "@darts-platform/schemas";
import { Button } from "@darts-platform/ui";

import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";
import { authClient } from "@/lib/auth-client";
import { readInvitationCode } from "@/lib/invitation-link";
import { roleLabel } from "@/lib/roles";

const acceptedSchema = z.object({ accepted: z.literal(true) });
const registrationSchema = z.object({
  name: z.string().trim().min(1, "Bitte gib deinen Namen an.").max(255),
  password: z.string().min(10, "Mindestens 10 Zeichen.").max(128),
});
type RegistrationData = z.infer<typeof registrationSchema>;

const inputClassName =
  "min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-body text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30 disabled:text-slate-400";
const dateFormat = new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeStyle: "short" });

/**
 * Landeseite des Einladungslinks. Der Code kommt aus dem Fragment und geht
 * nur im Body an die API. Drei Faelle nach der Vorschau: keine Sitzung
 * (registrieren und annehmen), passende Sitzung (annehmen), fremde Sitzung
 * (abmelden). Das manuelle Code-Feld auf der Startseite bleibt der Fallback.
 */
export function InvitationRoute({ invitationId }: { readonly invitationId: string }) {
  // Das Fragment gibt es nur im Browser; beim Server-Render ist es leer.
  const [code, setCode] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setCode(readInvitationCode(window.location.hash));
  }, []);

  const preview = useQuery({
    queryKey: ["invitation-preview", invitationId, code],
    enabled: typeof code === "string",
    retry: false,
    queryFn: ({ signal }) =>
      apiRequest({
        path: `/invitations/${invitationId}/preview`,
        method: "POST",
        body: { claimToken: code },
        schema: invitationPreviewSchema,
        signal,
      }),
  });

  if (code === undefined || (code !== null && preview.isPending)) {
    return <Card title="Einladung"><p className="text-body text-slate-400" role="status">Einladung wird geprüft …</p></Card>;
  }

  if (code === null) {
    return (
      <Card title="Link unvollständig">
        <p className="text-body text-slate-300">
          Dieser Einladungslink enthält keinen Code. Öffne den Link aus der E-Mail vollständig, oder gib den
          Einladungscode auf der <Link className="text-emerald-300 underline" href="/">Startseite</Link> von Hand ein.
        </p>
      </Card>
    );
  }

  if (preview.isError || preview.data === undefined) {
    return (
      <Card title="Einladung ungültig">
        <p className="text-body text-slate-300" role="alert">
          Diese Einladung ist ungültig oder abgelaufen. Bitte die einladende Person um eine neue Einladung.
        </p>
        <Link className="mt-4 inline-block text-body text-emerald-300 underline" href="/">Zur Startseite</Link>
      </Card>
    );
  }

  return <InvitationActions code={code} invitationId={invitationId} preview={preview.data} />;
}

function InvitationActions({ code, invitationId, preview }: {
  readonly code: string;
  readonly invitationId: string;
  readonly preview: InvitationPreview;
}) {
  const router = useRouter();
  const session = authClient.useSession();
  const [error, setError] = useState<string | null>(null);

  const accept = useMutation({
    mutationFn: () =>
      apiRequest({
        path: `/invitations/${invitationId}/accept`,
        method: "POST",
        body: { claimToken: code },
        schema: acceptedSchema,
      }),
    onSuccess: () => router.push("/"),
    onError: (mutationError) => setError(userFacingErrorMessage(mutationError)),
  });

  const form = useForm<RegistrationData>({
    resolver: zodResolver(registrationSchema),
    defaultValues: { name: "", password: "" },
  });

  const register = form.handleSubmit(async (data) => {
    setError(null);
    const result = await authClient.signUp.email({
      name: data.name,
      email: preview.email,
      password: data.password,
      fetchOptions: { headers: { "x-dartbase-invitation-claim": code } },
    });
    if (result.error !== null) {
      setError("Das Konto konnte nicht erstellt werden. Vielleicht existiert es bereits – melde dich dann zuerst an.");
      return;
    }
    await session.refetch();
    accept.mutate();
  });

  const title = `Einladung zu ${preview.organizationName}`;
  const summary = (
    <p className="text-body text-slate-300">
      Du bist zu <span className="font-semibold text-white">{preview.organizationName}</span> als{" "}
      <span className="font-semibold text-white">{roleLabel(preview.role)}</span> eingeladen. Die Einladung gilt für{" "}
      <span className="font-mono text-white">{preview.email}</span> bis {dateFormat.format(preview.expiresAt)}.
    </p>
  );

  if (session.isPending) {
    return <Card title={title}>{summary}<p className="mt-4 text-body text-slate-400" role="status">Sitzung wird geladen …</p></Card>;
  }

  if (session.data !== null && session.data.user.email.toLowerCase() !== preview.email.toLowerCase()) {
    return (
      <Card title={title}>
        {summary}
        <p className="mt-4 text-body text-amber-200" role="alert">
          Du bist als {session.data.user.email} angemeldet. Melde dich ab, um die Einladung mit der eingeladenen Adresse anzunehmen.
        </p>
        <Button className="mt-4" onClick={() => void authClient.signOut().then(() => session.refetch())} type="button" variant="outline">
          Abmelden
        </Button>
      </Card>
    );
  }

  if (session.data !== null) {
    return (
      <Card title={title}>
        {summary}
        {error !== null ? <p className="mt-4 rounded-lg bg-rose-400/10 p-3 text-body text-rose-200" role="alert">{error}</p> : null}
        <Button className="mt-4 w-full" disabled={accept.isPending} onClick={() => accept.mutate()} type="button">
          Einladung annehmen
        </Button>
      </Card>
    );
  }

  return (
    <Card title={title}>
      {summary}
      <form autoComplete="on" className="mt-6 space-y-4" onSubmit={(event) => void register(event)}>
        <label className="block space-y-2 text-body text-slate-300">
          <span>Name</span>
          <input className={inputClassName} autoComplete="name" {...form.register("name")} />
          {form.formState.errors.name ? <span className="block text-caption text-rose-300">{form.formState.errors.name.message}</span> : null}
        </label>
        <label className="block space-y-2 text-body text-slate-300">
          <span>E-Mail</span>
          <input className={inputClassName} autoComplete="username" disabled readOnly type="email" value={preview.email} />
        </label>
        <label className="block space-y-2 text-body text-slate-300">
          <span>Passwort</span>
          <input className={inputClassName} autoComplete="new-password" type="password" {...form.register("password")} />
          {form.formState.errors.password ? <span className="block text-caption text-rose-300">{form.formState.errors.password.message}</span> : null}
        </label>
        {error !== null ? <p className="rounded-lg bg-rose-400/10 p-3 text-body text-rose-200" role="alert">{error}</p> : null}
        <Button className="w-full" disabled={form.formState.isSubmitting || accept.isPending} type="submit">
          {form.formState.isSubmitting || accept.isPending ? "Bitte warten …" : "Konto erstellen und Einladung annehmen"}
        </Button>
      </form>
      <p className="mt-5 text-body text-slate-400">
        Du hast schon ein Konto mit dieser Adresse?{" "}
        <Link className="text-emerald-300 underline" href="/">Melde dich an</Link> und öffne den Link danach erneut.
      </p>
    </Card>
  );
}

function Card({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-2xl shadow-black/20 sm:p-8">
      <h1 className="font-numerals text-title font-bold text-white">{title}</h1>
      <div className="mt-4">{children}</div>
    </section>
  );
}
```

- [ ] **Step 4: Run test and typecheck**

Run: `cd apps/web && npx vitest run src/lib/invitation-link.spec.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Browser-Test von Hand**

Run: `pnpm dev` (API, Web, Worker), dann in der Oberfläche eine Einladung erstellen, den Link aus dem Worker-Log (`email.logged`, Feld `text`) in einem privaten Fenster öffnen.
Expected: Vorschau mit Organisation und Rolle; nach Name und Passwort landet man auf `/` mit der Organisation in der Liste. Link ohne `#code=` zeigt «Link unvollständig»; ein manipulierter Code zeigt «Einladung ungültig».

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/invitation-link.ts apps/web/src/lib/invitation-link.spec.ts apps/web/src/app/einladung apps/web/src/components/invitation
git commit -m "feat(web): Einladungsseite mit Vorschau, Registrierung und Annahme ueber den Mail-Link"
```

---

### Task 13: Web — Passwort vergessen und neues Passwort

**Files:**
- Create: `apps/web/src/app/passwort/vergessen/page.tsx`, `apps/web/src/components/auth/forgot-password-route.tsx`
- Create: `apps/web/src/app/passwort/neu/page.tsx`, `apps/web/src/components/auth/reset-password-route.tsx`
- Modify: `apps/web/src/components/auth-panel.tsx` (Link)

**Interfaces:**
- Consumes: `authClient.requestPasswordReset({ email, redirectTo })`, `authClient.resetPassword({ newPassword, token })`; Better Auth leitet nach dem Mail-Klick auf `/passwort/neu?token=…` oder `/passwort/neu?error=INVALID_TOKEN`.
- Produces: zwei Seiten und den Link «Passwort vergessen?».

- [ ] **Step 1: Seiten anlegen**

`apps/web/src/app/passwort/vergessen/page.tsx`:

```tsx
import type { Metadata } from "next";

import { ForgotPasswordRoute } from "@/components/auth/forgot-password-route";

export const metadata: Metadata = {
  title: "Passwort vergessen",
  description: "Einen Link zum Zurücksetzen des Passworts anfordern.",
};

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen justify-center px-4 py-10 sm:px-6">
      <div className="w-full max-w-xl">
        <ForgotPasswordRoute />
      </div>
    </main>
  );
}
```

`apps/web/src/components/auth/forgot-password-route.tsx`:

```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@darts-platform/ui";

import { authClient } from "@/lib/auth-client";

const schema = z.object({ email: z.email("Bitte gib eine gültige E-Mail-Adresse an.").trim().toLowerCase() });
type FormData = z.infer<typeof schema>;

const inputClassName =
  "min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-body text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30";

/**
 * Fordert den Reset-Link an. Die Bestaetigung ist immer dieselbe — ob ein
 * Konto existiert, verraet die Seite nicht (Better Auth antwortet gleich).
 */
export function ForgotPasswordRoute() {
  const [state, setState] = useState<"form" | "sent" | "error">("form");
  const form = useForm<FormData>({ resolver: zodResolver(schema), defaultValues: { email: "" } });

  const submit = form.handleSubmit(async (data) => {
    const result = await authClient.requestPasswordReset({
      email: data.email,
      redirectTo: `${window.location.origin}/passwort/neu`,
    });
    setState(result.error === null ? "sent" : "error");
  });

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-2xl shadow-black/20 sm:p-8">
      <h1 className="font-numerals text-title font-bold text-white">Passwort vergessen</h1>
      {state === "sent" ? (
        <p className="mt-4 text-body text-slate-300" role="status">
          Wenn ein Konto mit dieser Adresse existiert, ist eine E-Mail mit einem Link unterwegs. Der Link ist eine Stunde gültig.
        </p>
      ) : (
        <form className="mt-4 space-y-4" onSubmit={(event) => void submit(event)}>
          <p className="text-body text-slate-400">Gib die E-Mail-Adresse deines Kontos an. Du erhältst einen Link, um ein neues Passwort zu setzen.</p>
          <label className="block space-y-2 text-body text-slate-300">
            <span>E-Mail</span>
            <input className={inputClassName} autoComplete="username" type="email" {...form.register("email")} />
            {form.formState.errors.email ? <span className="block text-caption text-rose-300">{form.formState.errors.email.message}</span> : null}
          </label>
          {state === "error" ? (
            <p className="rounded-lg bg-rose-400/10 p-3 text-body text-rose-200" role="alert">
              Die Anfrage ist fehlgeschlagen. Versuche es in einer Minute erneut.
            </p>
          ) : null}
          <Button className="w-full" disabled={form.formState.isSubmitting} type="submit">
            {form.formState.isSubmitting ? "Bitte warten …" : "Link anfordern"}
          </Button>
        </form>
      )}
      <Link className="mt-5 inline-block text-body text-emerald-300 underline" href="/">Zur Anmeldung</Link>
    </section>
  );
}
```

`apps/web/src/app/passwort/neu/page.tsx`:

```tsx
import type { Metadata } from "next";

import { ResetPasswordRoute } from "@/components/auth/reset-password-route";

export const metadata: Metadata = {
  title: "Neues Passwort",
  description: "Ein neues Passwort für das DartBase-Konto setzen.",
};

interface PageProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

export default async function ResetPasswordPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const token = typeof query.token === "string" && query.token.length > 0 ? query.token : null;
  const invalid = query.error === "INVALID_TOKEN";
  return (
    <main className="flex min-h-screen justify-center px-4 py-10 sm:px-6">
      <div className="w-full max-w-xl">
        <ResetPasswordRoute invalid={invalid} token={token} />
      </div>
    </main>
  );
}
```

`apps/web/src/components/auth/reset-password-route.tsx`:

```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@darts-platform/ui";

import { authClient } from "@/lib/auth-client";

const schema = z
  .object({
    password: z.string().min(10, "Mindestens 10 Zeichen.").max(128),
    confirmation: z.string(),
  })
  .refine((value) => value.password === value.confirmation, {
    message: "Die Passwörter stimmen nicht überein.",
    path: ["confirmation"],
  });
type FormData = z.infer<typeof schema>;

const inputClassName =
  "min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-body text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30";

/**
 * Setzt das Passwort mit dem Token aus dem Query-String, das Better Auth
 * nach dem Klick auf den Mail-Link dorthin schreibt. Ohne Token oder mit
 * `error=INVALID_TOKEN` fuehrt die Seite zurueck zur Anforderung.
 */
export function ResetPasswordRoute({ token, invalid }: { readonly token: string | null; readonly invalid: boolean }) {
  const [state, setState] = useState<"form" | "done" | "error">("form");
  const form = useForm<FormData>({ resolver: zodResolver(schema), defaultValues: { password: "", confirmation: "" } });

  const submit = form.handleSubmit(async (data) => {
    if (token === null) return;
    const result = await authClient.resetPassword({ newPassword: data.password, token });
    setState(result.error === null ? "done" : "error");
  });

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-2xl shadow-black/20 sm:p-8">
      <h1 className="font-numerals text-title font-bold text-white">Neues Passwort</h1>
      {token === null || invalid || state === "error" ? (
        <div className="mt-4 space-y-4">
          <p className="text-body text-slate-300" role="alert">
            Dieser Link ist ungültig oder abgelaufen. Fordere einen neuen Link an.
          </p>
          <Link className="inline-block text-body text-emerald-300 underline" href="/passwort/vergessen">Passwort vergessen</Link>
        </div>
      ) : state === "done" ? (
        <div className="mt-4 space-y-4">
          <p className="text-body text-slate-300" role="status">
            Dein Passwort ist gesetzt. Alle bisherigen Sitzungen wurden beendet.
          </p>
          <Link className="inline-block text-body text-emerald-300 underline" href="/">Zur Anmeldung</Link>
        </div>
      ) : (
        <form className="mt-4 space-y-4" onSubmit={(event) => void submit(event)}>
          <label className="block space-y-2 text-body text-slate-300">
            <span>Neues Passwort</span>
            <input className={inputClassName} autoComplete="new-password" type="password" {...form.register("password")} />
            {form.formState.errors.password ? <span className="block text-caption text-rose-300">{form.formState.errors.password.message}</span> : null}
          </label>
          <label className="block space-y-2 text-body text-slate-300">
            <span>Passwort wiederholen</span>
            <input className={inputClassName} autoComplete="new-password" type="password" {...form.register("confirmation")} />
            {form.formState.errors.confirmation ? <span className="block text-caption text-rose-300">{form.formState.errors.confirmation.message}</span> : null}
          </label>
          <Button className="w-full" disabled={form.formState.isSubmitting} type="submit">
            {form.formState.isSubmitting ? "Bitte warten …" : "Passwort setzen"}
          </Button>
        </form>
      )}
    </section>
  );
}
```

In `apps/web/src/components/auth-panel.tsx`: `import Link from "next/link";` ergänzen und **nach** dem `<form>` (vor dem Umschalt-Button), nur im Modus `sign-in`:

```tsx
      {mode === "sign-in" ? (
        <p className="mt-4 text-center">
          <Link className="text-body text-slate-400 underline hover:text-slate-200" href="/passwort/vergessen">
            Passwort vergessen?
          </Link>
        </p>
      ) : null}
```

- [ ] **Step 2: Typecheck, Lint, Browser-Test**

Run: `cd apps/web && pnpm typecheck && pnpm lint`
Expected: keine Fehler. Falls `authClient.requestPasswordReset` oder `resetPassword` im Typ fehlen, die Methodennamen in `node_modules/.pnpm/better-auth@1.7.1*/node_modules/better-auth/dist/client/` prüfen; in 1.7.1 heissen sie so.

Browser: `pnpm dev`, `/passwort/vergessen` mit bekannter Adresse absenden, Link aus dem Worker-Log öffnen, neues Passwort setzen, mit dem neuen Passwort anmelden. Danach `/passwort/neu` ohne Token öffnen → Hinweis mit Link zur Anforderung.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/passwort apps/web/src/components/auth apps/web/src/components/auth-panel.tsx
git commit -m "feat(web): Passwort vergessen und neues Passwort setzen"
```

---

### Task 14: Web — Zustellstatus, «Erneut senden» und Einladungslink

**Files:**
- Create: `apps/web/src/components/organization/invitation-delivery-badge.tsx`
- Modify: `apps/web/src/components/organization/members-route.tsx`
- Modify: `apps/web/src/components/players/invitation-form.tsx`

**Interfaces:**
- Consumes: `Invitation.lastDelivery` (Task 1), `POST /organizations/:org/invitations/:id/resend` (Task 8), `buildInvitationLink` (Task 12), `createdInvitationSchema`.
- Produces: `InvitationDeliveryBadge({ delivery })`.

- [ ] **Step 1: Badge-Komponente**

`apps/web/src/components/organization/invitation-delivery-badge.tsx`:

```tsx
import type { InvitationDeliveryStatus } from "@darts-platform/schemas";

const dateFormat = new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeStyle: "short" });

/**
 * Zustand der juengsten Mail einer Einladung als Text, nicht nur als
 * Farbe. `null` steht fuer Einladungen aus der Zeit vor dem Mailversand.
 */
export function InvitationDeliveryBadge({ delivery }: { readonly delivery: InvitationDeliveryStatus | null | undefined }) {
  if (delivery === null || delivery === undefined) {
    return <span className="text-caption text-slate-500">Mail: ohne Versand (Code von Hand weitergegeben)</span>;
  }
  switch (delivery.status) {
    case "pending":
      return <span className="text-caption text-slate-400">Mail: ausstehend</span>;
    case "sent":
      return <span className="text-caption text-emerald-300">Mail: versendet am {dateFormat.format(delivery.sentAt)}</span>;
    case "failed":
      return (
        <span className="text-caption text-rose-300" role="alert">
          Mail: fehlgeschlagen am {dateFormat.format(delivery.failedAt)} – erneut senden oder Code weitergeben
        </span>
      );
    default: {
      const exhaustive: never = delivery;
      return <span className="text-caption text-slate-500">{String(exhaustive)}</span>;
    }
  }
}
```

- [ ] **Step 2: Mitgliederseite**

In `members-route.tsx`:

Imports ergänzen: `createdInvitationSchema`, `type CreatedInvitation` aus `@darts-platform/schemas`; `buildInvitationLink` aus `@/lib/invitation-link`; `InvitationDeliveryBadge` aus `./invitation-delivery-badge`. `inputClassName` neben `selectClassName` definieren (gleicher String wie `selectClassName`, plus `font-mono` an der Verwendungsstelle).

Nach `cancelInvitation` in `Members`:

```tsx
  // Der neue Code wird genau einmal gezeigt — wie beim Erstellen. Er ist
  // der Fallback, falls auch die zweite Mail nicht ankommt.
  const [resent, setResent] = useState<CreatedInvitation | null>(null);
  const resendInvitation = useMutation({
    mutationFn: (invitationId: string) =>
      apiRequest({
        path: `/organizations/${organization.id}/invitations/${invitationId}/resend`,
        method: "POST",
        schema: createdInvitationSchema,
      }),
    onSuccess: async (invitation) => {
      setResent(invitation);
      await queryClient.invalidateQueries({ queryKey: ["organization-invitations", organization.id] });
    },
  });
```

Die Fehleranzeige oberhalb der Einladungsliste erweitern:

```tsx
        {resendInvitation.error !== null ? (
          <p className="text-body text-rose-300" role="alert">{messageFrom(resendInvitation.error)}</p>
        ) : null}
```

Das `<li>` je Einladung ersetzen:

```tsx
              <li
                className="grid gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-4"
                key={invitation.id}
              >
                <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-body font-semibold text-white">{invitation.email}</p>
                    <p className="text-caption text-slate-400">
                      {roleLabel(invitation.role)} · gültig bis {dateFormat.format(invitation.expiresAt)}
                    </p>
                    <p className="mt-1"><InvitationDeliveryBadge delivery={invitation.lastDelivery} /></p>
                  </div>
                  <div className="grid gap-2 sm:w-64">
                    <Button
                      disabled={resendInvitation.isPending && resendInvitation.variables === invitation.id}
                      onClick={() => resendInvitation.mutate(invitation.id)}
                      type="button"
                    >
                      Erneut senden
                    </Button>
                    <Button
                      disabled={cancelInvitation.isPending && cancelInvitation.variables === invitation.id}
                      onClick={() => cancelInvitation.mutate(invitation.id)}
                      type="button"
                      variant="outline"
                    >
                      Einladung zurückziehen
                    </Button>
                  </div>
                </div>
                {resent?.id === invitation.id ? (
                  <div className="space-y-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4">
                    <p className="text-body text-emerald-100">
                      Neue Mail an {resent.email} ist unterwegs. Der bisherige Code ist damit ungültig. Falls die Mail
                      nicht ankommt, kannst du diesen Link oder Code weitergeben.
                    </p>
                    <label className="block text-caption font-semibold tracking-[0.14em] text-slate-400 uppercase" htmlFor={`resent-link-${invitation.id}`}>
                      Neuer Einladungslink
                    </label>
                    <input
                      id={`resent-link-${invitation.id}`}
                      className={`${inputClassName} font-mono`}
                      readOnly
                      value={buildInvitationLink(window.location.origin, resent.id, resent.claimToken)}
                    />
                    <label className="block text-caption font-semibold tracking-[0.14em] text-slate-400 uppercase" htmlFor={`resent-code-${invitation.id}`}>
                      Neuer Einladungscode
                    </label>
                    <input id={`resent-code-${invitation.id}`} className={`${inputClassName} font-mono`} readOnly value={resent.claimToken} />
                  </div>
                ) : null}
              </li>
```

(`window.location.origin` ist hier sicher, weil der Block nur nach einer Mutation im Browser rendert. Wer es sauberer will, hält `origin` in einem `useState`, das im `useEffect` gesetzt wird.)

- [ ] **Step 3: Einladungsformular**

In `invitation-form.tsx` `import { buildInvitationLink } from "@/lib/invitation-link";` ergänzen und den Erfolgsblock ersetzen:

```tsx
      {inviteMember.isSuccess ? (
        <div className="space-y-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4 sm:col-span-3">
          <p className="text-body text-emerald-100">
            Einladung erstellt, eine E-Mail an {inviteMember.data.email} ist unterwegs. Falls sie nicht ankommt,
            kannst du diesen Link oder Code auf einem anderen Weg weitergeben. Beides wird nur einmal angezeigt.
          </p>
          <label className={labelClassName} htmlFor="created-invitation-link">Einladungslink</label>
          <input
            id="created-invitation-link"
            className={`${inputClassName} font-mono`}
            readOnly
            value={buildInvitationLink(window.location.origin, inviteMember.data.id, inviteMember.data.claimToken)}
          />
          <label className={labelClassName} htmlFor="created-invitation-claim">Einladungscode</label>
          <input
            id="created-invitation-claim"
            className={`${inputClassName} font-mono`}
            readOnly
            value={inviteMember.data.claimToken}
          />
        </div>
      ) : null}
```

- [ ] **Step 4: Typecheck, Lint, bestehende E2E**

Run: `cd apps/web && pnpm typecheck && pnpm lint && cd ../.. && pnpm test:e2e -- tests/members.spec.ts`
Expected: grün; `members.spec.ts` erwartet weiterhin `getByLabel("Einladungscode")` auf der Spielerseite und den Button «Einladung zurückziehen».

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/organization apps/web/src/components/players/invitation-form.tsx
git commit -m "feat(web): Zustellstatus und Erneut senden in der Mitgliederliste, Einladungslink als Fallback"
```

---

### Task 15: E2E — Einladungslink, erneut senden, Passwort-Reset

**Files:**
- Create: `apps/web/tests/password-reset-token.ts`
- Create: `apps/web/tests/email-flows.spec.ts`
- Modify: `package.json` (Root, `test:e2e` und `test:e2e:prod` bauen `@darts-platform/notifications` mit)

**Interfaces:**
- Consumes: `createRegistrationInvitation`, `signUpWithOrganization` (bestehende Helfer), Tabellen `users`, `verifications`.
- Produces: `readLatestPasswordResetToken(email: string): Promise<string>`.

Die Tests lesen den Einladungslink aus der Oberfläche (Fallback-Feld) und das Reset-Token aus `verifications` — beides unabhängig davon, ob ein Worker gegen dieselbe Datenbank läuft und Payloads leert.

- [ ] **Step 1: Root-Skripte**

In `package.json` bei `test:e2e` und `test:e2e:prod` nach `--filter=@darts-platform/statistics` ergänzen: `--filter=@darts-platform/notifications`.

- [ ] **Step 2: Helfer**

`apps/web/tests/password-reset-token.ts`:

```ts
import { and, desc, eq, like } from "drizzle-orm";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { createDatabaseConnection, users, verifications } from "@darts-platform/database";

/**
 * Liest das juengste Reset-Token eines Kontos direkt aus Better Auths
 * `verifications`-Tabelle (`identifier = reset-password:<token>`, `value =
 * userId`). Unabhaengig vom Mailversand: der Link in der Mail traegt genau
 * dieses Token.
 */
export async function readLatestPasswordResetToken(email: string): Promise<string> {
  const environment = parseApplicationEnvironment(process.env);
  const connection = createDatabaseConnection(environment.DATABASE_URL);
  try {
    const [user] = await connection.database
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email.trim().toLowerCase()));
    if (user === undefined) throw new Error(`Kein Konto fuer ${email}.`);
    const [row] = await connection.database
      .select({ identifier: verifications.identifier })
      .from(verifications)
      .where(and(eq(verifications.value, user.id), like(verifications.identifier, "reset-password:%")))
      .orderBy(desc(verifications.createdAt))
      .limit(1);
    if (row === undefined) throw new Error(`Kein Reset-Token fuer ${email}.`);
    return row.identifier.slice("reset-password:".length);
  } finally {
    await connection.close();
  }
}
```

- [ ] **Step 3: Spezifikation**

`apps/web/tests/email-flows.spec.ts`:

```ts
import { randomUUID } from "node:crypto";

import { expect, test } from "./fixtures";
import { readLatestPasswordResetToken } from "./password-reset-token";
import {
  createRegistrationInvitation,
  type RegistrationInvitationSeed,
} from "./registration-invitation";
import { signUpWithOrganization } from "./sign-up";

/**
 * Der Mail-Weg ohne Mail: Einladungslink aus dem Fallback-Feld, Reset-Token
 * aus der Datenbank. Damit laufen die Faelle mit EMAIL_PROVIDER=log und
 * unabhaengig davon, ob ein Worker die Versandzeilen bereits geleert hat.
 */
const seeds: RegistrationInvitationSeed[] = [];

test.afterEach(async () => {
  await Promise.all(seeds.splice(0).map((seed) => seed.cleanup()));
});

test("eine eingeladene Person registriert sich ueber den (erneut gesendeten) Link", async ({ page, browser }) => {
  const suffix = randomUUID();
  const short = suffix.slice(0, 8);
  const ownerEmail = `e2e-mail-owner-${suffix}@example.test`;
  const guestEmail = `e2e-mail-guest-${suffix}@example.test`;
  const organizationName = `E2E Mail Club ${short}`;

  const seed = await createRegistrationInvitation(ownerEmail);
  seeds.push(seed);
  const { organizationId } = await signUpWithOrganization(page, {
    claimToken: seed.claimToken,
    email: ownerEmail,
    organizationName,
    organizationSlug: `e2e-mail-club-${suffix}`,
    ownerName: `E2E Mail Owner ${short}`,
  });

  // Einladen: Link und Code erscheinen einmalig als Fallback.
  await page.goto(`/spieler?organisation=${organizationId}`);
  await page.getByLabel("E-Mail-Adresse für Einladung").fill(guestEmail);
  await page.getByRole("button", { name: "Einladen" }).click();
  const firstLink = await page.getByLabel("Einladungslink").inputValue();
  expect(firstLink).toContain(`/einladung/`);
  expect(firstLink).toContain("#code=");

  // Mitgliederliste: Zustellstatus sichtbar, erneut senden rotiert den Code.
  await page.goto(`/mitglieder?organisation=${organizationId}`);
  const row = page.getByRole("listitem").filter({ hasText: guestEmail });
  await expect(row).toContainText(/Mail: (ausstehend|versendet)/u);
  await row.getByRole("button", { name: "Erneut senden" }).click();
  const secondLink = await row.getByLabel("Neuer Einladungslink").inputValue();
  expect(secondLink).not.toBe(firstLink);

  // Gastkontext: der alte Link ist ungueltig, der neue fuehrt zur Vorschau.
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  try {
    await guest.goto(firstLink);
    await expect(guest.getByRole("alert")).toContainText("ungültig oder abgelaufen");

    await guest.goto(secondLink);
    await expect(guest.getByRole("heading", { name: `Einladung zu ${organizationName}` })).toBeVisible();
    await expect(guest.getByLabel("E-Mail")).toHaveValue(guestEmail);
    await guest.getByLabel("Name").fill(`E2E Gast ${short}`);
    await guest.getByLabel("Passwort").fill("E2eGastPasswort123!");
    await guest.getByRole("button", { name: "Konto erstellen und Einladung annehmen" }).click();

    await expect(guest).toHaveURL(/\/$/u);
    await expect(guest.getByText(guestEmail)).toBeVisible();
    await expect(guest.getByText(organizationName).first()).toBeVisible();
  } finally {
    await guestContext.close();
  }

  // Die Einladung ist angenommen und verschwindet aus der offenen Liste.
  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: guestEmail }).getByRole("button", { name: "Erneut senden" })).toHaveCount(0);
});

test("ein Konto setzt sein Passwort ueber den Reset-Link neu", async ({ page }) => {
  const suffix = randomUUID();
  const short = suffix.slice(0, 8);
  const email = `e2e-reset-${suffix}@example.test`;

  const seed = await createRegistrationInvitation(email);
  seeds.push(seed);
  await signUpWithOrganization(page, {
    claimToken: seed.claimToken,
    email,
    organizationName: `E2E Reset Club ${short}`,
    organizationSlug: `e2e-reset-club-${suffix}`,
    ownerName: `E2E Reset ${short}`,
  });
  await page.getByRole("button", { name: "Abmelden" }).click();

  await page.goto("/");
  await page.getByRole("link", { name: "Passwort vergessen?" }).click();
  await expect(page).toHaveURL(/\/passwort\/vergessen$/u);
  await page.getByLabel("E-Mail").fill(email);
  await page.getByRole("button", { name: "Link anfordern" }).click();
  await expect(page.getByRole("status")).toContainText("ist eine E-Mail mit einem Link unterwegs");

  const token = await readLatestPasswordResetToken(email);
  await page.goto(`/passwort/neu?token=${encodeURIComponent(token)}`);
  await page.getByLabel("Neues Passwort").fill("E2eNeuesPasswort456!");
  await page.getByLabel("Passwort wiederholen").fill("E2eNeuesPasswort456!");
  await page.getByRole("button", { name: "Passwort setzen" }).click();
  await expect(page.getByRole("status")).toContainText("Dein Passwort ist gesetzt");

  await page.getByRole("link", { name: "Zur Anmeldung" }).click();
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort").fill("E2eNeuesPasswort456!");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByText(email)).toBeVisible();

  // Ohne Token fuehrt die Seite zurueck zur Anforderung.
  await page.goto("/passwort/neu");
  await expect(page.getByRole("alert")).toContainText("ungültig oder abgelaufen");
});
```

- [ ] **Step 4: Run E2E**

Run: `pnpm test:e2e -- tests/email-flows.spec.ts tests/members.spec.ts tests/foundation.spec.ts`
Expected: grün. Bei sporadischem Rot zuerst mit einem Worker (`--workers=1`) wiederholen, siehe Memory «E2E auf einem Worker».

- [ ] **Step 5: Commit**

```bash
git add apps/web/tests/email-flows.spec.ts apps/web/tests/password-reset-token.ts package.json
git commit -m "test(web): E2E fuer Einladungslink, erneutes Senden und Passwort-Reset"
```

---

### Task 16: Dokumentation, Betriebsanleitung, Gesamtlauf

**Files:**
- Create: `docs/adr/0017-ausgehende-emails.md`
- Modify: `docs/adr/0010-invite-only-registration.md` (Nachtrag)
- Modify: `infrastructure/railway.md` (Abschnitt E-Mail)

- [ ] **Step 1: ADR 0017**

`docs/adr/0017-ausgehende-emails.md`:

```markdown
# ADR 0017: Ausgehende E-Mails über eine Versandtabelle und den Worker

**Status:** Accepted
**Datum:** 20. September 2026

## Kontext

Bis hierher kannte die Plattform keinen Mailversand. Einladungscodes
wurden von Hand weitergegeben, ein vergessenes Passwort liess sich nur in
der Datenbank zurücksetzen. Die Spec
`docs/superpowers/specs/2026-09-20-email-versand-design.md` führt beide
Fälle ein.

Zu entscheiden war, wie Mails den Prozess verlassen: synchron aus dem
API-Request, über eine Redis-Queue (BullMQ) oder über eine Tabelle, die der
bestehende Worker pollt.

## Entscheidung

- Versandaufträge liegen in `email_deliveries`, angelegt in derselben
  Transaktion wie die fachliche Änderung (Einladung) beziehungsweise im
  Better-Auth-Hook (Passwort-Reset). Kein dritter Konsument an
  `outbox_events`: ein Mailauftrag ist kein Domänenereignis.
- Der Worker pollt im Sekundentakt mit `FOR UPDATE SKIP LOCKED`, Stapel 5,
  rendert das Template aus `packages/notifications` und ruft die
  Resend-HTTP-API mit der Zeilen-ID als `Idempotency-Key` auf. Retry-Kurve
  und Dead-Letter wie bei `outbox_events`; endgültig abgelehnte Mails gehen
  sofort ins Dead-Letter.
- `payload` trägt bis zum Versand die Template-Eingaben inklusive
  Klartext-Link und wird danach geleert. Der Klartext-Einladungscode liegt
  damit nur bis zum Versand in der Datenbank.
- Der Einladungslink trägt den Code im URL-Fragment. «Erneut senden»
  rotiert den Code; eine Einladung hat zu jedem Zeitpunkt genau einen
  gültigen Code.
- Provider: Resend, Region eu-west-1, Domain `dartbase.ch` mit SPF, DKIM
  und DMARC bei Cloudflare. Adapter ohne SDK. Provider `log` für
  Entwicklung, CI und E2E.

## Verworfen

- **Synchroner Versand**: bei Provider-Störung scheitert die Einladung oder
  die Mail geht still verloren.
- **BullMQ**: erstmalige Redis-Abhängigkeit des Workers; der Auftrag läge bis
  zum Versand nur in Redis.
- **Lease-Spalte statt gehaltener Sperre**: braucht eine Verfallslogik für
  abgestürzte Worker; bei einem Worker ohne Nutzen.

## Folgen

- Neue Umgebungsvariablen `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM`;
  Rollout erst mit `log`, dann Umschalten auf `resend`.
- Empfängeradressen und Anzeigenamen gehen an Resend (EU). Datenschutz-
  erklärung, Auftragsverarbeitungsvertrag und Verarbeitungsverzeichnis sind
  ausserhalb des Codes nachzuführen.
- Dead-Letter erscheinen als `error` im Worker-Log und in der
  Einladungsliste als «fehlgeschlagen».
```

- [ ] **Step 2: Nachtrag ADR 0010**

An `docs/adr/0010-invite-only-registration.md` anhängen:

```markdown

## Nachtrag 20.09.2026

Der Einladungscode wird seit ADR 0017 per Mail zugestellt: Link
`{WEB_ORIGIN}/einladung/{id}#code={claimToken}`, Code im Fragment. Die
Oberfläche zeigt Link und Code weiterhin einmalig als Fallback. «Erneut
senden» erzeugt einen neuen Code und ersetzt den Hash; der alte Code wird
ungültig. Der Klartext liegt bis zum Versand im `payload` der Versandzeile
und wird danach geleert. Ein öffentlicher Vorschau-Endpunkt liefert
Organisation, Rolle und Adresse nur nach erfolgreichem Hash-Vergleich.
```

- [ ] **Step 3: Betriebsdoku**

In `infrastructure/railway.md` einen Abschnitt `## E-Mail-Versand` ergänzen:

```markdown
## E-Mail-Versand

| Punkt | Wert |
|---|---|
| Provider | Resend, Region `eu-west-1` (Irland) |
| Absenderdomain | `dartbase.ch`, verifiziert 20.09.2026 (SPF, DKIM, DMARC bei Cloudflare) |
| Absender | `dartbase <noreply@dartbase.ch>` (`EMAIL_FROM`) |
| Tracking | Öffnungs- und Klick-Tracking in Resend deaktiviert lassen |

Variablen je Environment auf **API und Worker** (der Worker versendet, die
API validiert dieselbe Umgebung):

| Variable | production | staging |
|---|---|---|
| `EMAIL_PROVIDER` | `resend` | `resend` |
| `RESEND_API_KEY` | eigener Key «production» | eigener Key «staging» |
| `EMAIL_FROM` | Vorgabe | Vorgabe |

Rollout: zuerst Migration 0034 und Deploy mit `EMAIL_PROVIDER=log`
(Worker-Log zeigt `email.logged`), dann `EMAIL_PROVIDER=resend` plus Key
setzen und den Worker neu starten. Startet API oder Worker mit
`EMAIL_PROVIDER=resend` ohne Key, scheitert der Start mit einer klaren
Meldung. Die Variablen setzt der Betreiber; für Agenten sind Produktions-
Variablen gesperrt.

Betrieb: Dead-Letter erscheinen im Worker-Log als `email.dead_letter` auf
Level `error`; offene und gescheiterte Aufträge siehe `DATABASE_SCHEMA.md`,
Abschnitt `email_deliveries`.
```

- [ ] **Step 4: Gesamtlauf**

Run (aus dem Repo-Wurzelverzeichnis):

```bash
pnpm lint && pnpm typecheck && pnpm test && NODE_ENV=production pnpm build && pnpm test:e2e
```

Expected: alles grün. Fehlschläge nicht ignorieren (AGENTS.md §20).

- [ ] **Step 5: Commit**

```bash
git add docs/adr/0017-ausgehende-emails.md docs/adr/0010-invite-only-registration.md infrastructure/railway.md
git commit -m "docs: ADR 0017 ausgehende E-Mails, Nachtrag ADR 0010, Betriebsabschnitt E-Mail"
```

- [ ] **Step 6: Staging-Abnahme (manuell, nach Merge auf develop)**

1. Staging-Variablen `EMAIL_PROVIDER=resend`, `RESEND_API_KEY=<staging-key>` auf API und Worker setzen (Betreiber).
2. Im Staging als Owner das Testkonto einladen; Mail kommt an, Link öffnet die Vorschau, Registrierung und Annahme laufen durch.
3. «Passwort vergessen» für das Testkonto; Mail kommt an, Reset setzt das Passwort, alte Sitzung ist beendet.
4. In der Mitgliederliste «Erneut senden»: zweite Mail kommt an, erster Link ist ungültig.
5. Ergebnis mit Datum im Spec-Abschnitt «Tests → Staging» oder im PR festhalten.

---

## Selbstprüfung gegen den Spec

- Versandweg Tabelle + Worker: Tasks 5, 11. Provider Resend ohne SDK, Idempotency-Key, Statusabbildung: Task 4. Templates im Worker gerendert, Payload nach Versand geleert: Tasks 4, 5, 11.
- Code im Fragment, Link-Aufbau: Tasks 6, 12. Erneut senden mit Rotation und Audit: Task 8. Fallback Link/Code in der UI: Task 14.
- Konfiguration und Startabbruch ohne Key: Task 2. `.env.example`: Task 2. Railway-Doku: Task 16.
- Schemas inkl. `lastDelivery`, Preview: Task 1. Einladungsliste mit Status: Task 7. Preview-Endpunkt öffentlich, identische 404: Task 9. Sensitive Rate-Limits (Preview, Resend, Reset): Tasks 8, 10.
- Better Auth Hook, `revokeSessionsOnPasswordReset`, `customRules`: Task 10. Web-Seiten Passwort und Link im Panel: Task 13. Einladungsseite mit drei Sitzungsfällen: Task 12.
- Worker-Poller, Stapel 5, SKIP LOCKED, Dead-Letter-Log ohne Empfänger, Prune 30 Tage: Task 11.
- Tests: Unit Templates/Adapter (Tasks 3, 4), Config (2), DB-Constraints (5), API (6–10), Worker (11), E2E (15), Staging (16).
- ADR 0017, Nachtrag 0010, DATABASE_SCHEMA: Tasks 5, 16.
- Datenschutz-Hinweis: ADR 0017 (Task 16); Compliance-Aufgabe liegt ausserhalb des Codes.
