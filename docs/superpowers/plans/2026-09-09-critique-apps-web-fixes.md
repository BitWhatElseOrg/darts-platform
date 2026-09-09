# Critique-Fixes apps/web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 6 priority issues from the `/impeccable critique` of `apps/web` (2026-09-09), in the user-approved order: P0 Oche-Rule violation, P1 design-token reconciliation (detector-flagged instances), P1 amber "third accent hue" removal, P1 command-centre alarm-banner ordering, P2 entry-page health panel, P2 cognitive-load chunking, P3 orphaned help link.

**Architecture:** Every task is a surgical token/markup swap or reorder inside existing components — no new abstractions, no restructuring of state or data flow. Two tasks (1 and 3) additionally add the `.sektorenring` class to a component root that currently renders outside the design-system scope; without it, the Sektorenring CSS custom-property overrides in `apps/web/src/app/globals.css` (`.sektorenring { --color-ring-green: …; --color-chalk: …; … }`) do not apply, and token classes like `bg-ring-green`/`text-chalk` would silently resolve to the wrong (light-theme, unscoped) values. This was verified by reading `globals.css` and confirming which existing top-level route components already carry `.sektorenring` (`command-centre.tsx`, `player-profile.tsx`, `encounter-command-centre.tsx`, `workspace-shell.tsx`, …) and which do not (`match-scoreboard.tsx`, `apps/web/src/app/offline/page.tsx`, `health-dashboard.tsx`/`application-dashboard.tsx`, `live-tournament.tsx`).

**Tech Stack:** Next.js 16 (App Router), React, Tailwind v4 (`@theme` tokens in `apps/web/src/app/globals.css`), `@darts-platform/ui` (Sektorenring primitives: `Score`, `Name`, `Wedge`, `StateTag`, `Control`, `SheetLabel`, `Rule`), Vitest + `@testing-library/react` (`happy-dom`) for component tests, Playwright for `apps/web/tests/scoreboard.spec.ts`.

**Spec:** `.impeccable/critique/2026-09-09T09-53-06Z__apps-web.md` (the persisted `/impeccable critique` report this plan implements). Also binding: `DESIGN.md` (Sektorenring rules cited per task) and `AGENTS.md` (§4 Architekturregeln, §19 Accessibility, §26 "keine Abkürzung darf … Turnierintegrität … gefährden").

## Global Constraints

- No raw Tailwind palette color (`emerald-*`, `amber-*`, `rose-*`) may be introduced or left in any file this plan touches once that file's task is done — only Sektorenring tokens (`ring-green`, `ring-red`, `chalk`, `spider`, `sisal-*`, `wedge-*`) or the two-signal design-system components.
- Every file gaining `bg-ring-*`/`text-chalk`/`text-ring-*` classes for the first time must sit inside a `.sektorenring`-classed ancestor (either add the class to its own root, or confirm an existing ancestor already carries it — check with `grep -rn "sektorenring" <path-up-to-root>` before assuming).
- No change in this plan may alter the *behavior* of match scoring (idempotency, version checks, offline queue, focus management) — only presentation classes, JSX structure for layout/order, and additive markup (headings, links). If a step would require touching scoring logic, stop and flag it instead of proceeding.
- German UI copy, Swiss spelling, no ß (per AGENTS.md, CLAUDE.md).
- Run `pnpm --filter @darts-platform/web typecheck` and the relevant `pnpm --filter @darts-platform/web test` after every task; do not proceed to the next task on a red run.
- Branch name: `fix/apps-web-critique-2026-09-09`, created from `develop` (not `main`) — this repo's Liga/feature work integrates through `develop` (see `develop-integration-branch` memory).

---

### Task 1: P0 — Oche Rule in `ScoreboardSides`

**Files:**
- Modify: `apps/web/src/components/match/scoreboard-sides.tsx`
- Test: `apps/web/src/components/match/scoreboard-sides.render.spec.tsx` (new)

**Interfaces:**
- Consumes: `Score` from `@darts-platform/ui` (`size: "display" | "lead" | "quiet"`, `tone: "chalk" | "ink" | "dim" | "finish"` — see `packages/ui/src/sektorenring/typography.tsx`).
- Produces: no exported API changes; `ScoreboardSides` keeps its existing prop shape (`match`, `pendingDarts`, `showDartBand`).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/match/scoreboard-sides.render.spec.tsx`:

```tsx
// @vitest-environment happy-dom
//
// Haelt die Oche-Regel (DESIGN.md, "The Oche Rule") fest: die aktive Seite
// zeigt ihren Reststand in `display` (3.5rem), die inaktive in `lead` (2rem)
// -- der Groessenunterschied ist der Zugindikator und darf nie verschwinden.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { MatchStateResponse } from "@darts-platform/schemas";

import { ScoreboardSides } from "./scoreboard-sides";

/** Nur die Felder, die die Komponente liest. */
const match = {
  status: "IN_PROGRESS",
  currentLegNumber: 1,
  legsToWin: 3,
  setsToWin: 1,
  visits: [],
  participants: [
    {
      playerId: "11111111-1111-4111-8111-111111111111",
      isActive: true,
      remaining: 341,
      legsWonInSet: 1,
      setsWon: 0,
      players: [{ playerId: "11111111-1111-4111-8111-111111111111", displayName: "Alex Muster", isThrowing: true }],
    },
    {
      playerId: "22222222-2222-4222-8222-222222222222",
      isActive: false,
      remaining: 501,
      legsWonInSet: 0,
      setsWon: 0,
      players: [{ playerId: "22222222-2222-4222-8222-222222222222", displayName: "Jordan Beispiel", isThrowing: false }],
    },
  ],
} as unknown as MatchStateResponse;

afterEach(() => {
  cleanup();
});

describe("ScoreboardSides", () => {
  it("zeigt die aktive Seite im Display-Schritt und die inaktive im Lead-Schritt", () => {
    render(<ScoreboardSides match={match} pendingDarts={[]} showDartBand={false} />);
    const active = screen.getByLabelText("Alex Muster, Restscore");
    const inactive = screen.getByLabelText("Jordan Beispiel, Restscore");
    expect(active.className).toContain("text-display");
    expect(inactive.className).toContain("text-data");
    expect(inactive.className).not.toContain("text-display");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @darts-platform/web exec vitest run src/components/match/scoreboard-sides.render.spec.tsx`
Expected: FAIL — both labels currently resolve to elements carrying `text-display` (the hand-rolled `<p className="... text-display ...">` is unconditional), so `inactive.className).not.toContain("text-display")` fails.

- [ ] **Step 3: Implement the fix**

In `apps/web/src/components/match/scoreboard-sides.tsx`:

```tsx
"use client";

import type { Dart, MatchStateResponse } from "@darts-platform/schemas";
import { cn, Score } from "@darts-platform/ui";
import { dartLabel, threeDartAverage } from "@/lib/scoreboard-view";
```

Replace the remaining-score paragraph (currently):

```tsx
              <p
                aria-label={`${sideNames(participant)}, Restscore`}
                className="font-numerals font-bold text-display tabular"
              >
                {participant.remaining}
              </p>
```

with:

```tsx
              <Score
                aria-label={`${sideNames(participant)}, Restscore`}
                size={isActive ? "display" : "lead"}
                tone={isActive ? "chalk" : "dim"}
              >
                {participant.remaining}
              </Score>
```

`Score` renders a `<span>`; `aria-label` and `aria-*`/data attributes pass through via `ComponentProps<"span">` (see `packages/ui/src/sektorenring/typography.tsx:24-29`), so the accessible name is unchanged. `Score`'s own class list already includes `font-numerals font-bold tabular` (see `scoreVariants` base classes), so nothing is lost by dropping the hand-rolled classes.

This file does not yet sit inside a `.sektorenring`-scoped ancestor (`match-scoreboard.tsx`'s root `<section>` has no such class). `Score`'s `tone="chalk"` resolves to `text-chalk`, and `tone="dim"` to `text-spider-dim` — both custom properties are defined unconditionally at the top-level `@theme` block in `globals.css` (`--color-chalk`, `--color-spider-dim`), not only inside `.sektorenring`, so they resolve correctly even without the wrapper. Verify this by reading `globals.css` lines 9–35 before proceeding — if a future edit moves these into the `.sektorenring`-scoped block, this step's correctness assumption breaks and the wrapper from Task 2 Step 1 must move here instead.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @darts-platform/web exec vitest run src/components/match/scoreboard-sides.render.spec.tsx`
Expected: PASS

- [ ] **Step 5: Typecheck and existing e2e sanity check**

Run: `pnpm --filter @darts-platform/web typecheck`
Run: `pnpm --filter @darts-platform/web exec vitest run src/components/match` (full match-component suite, guards against an unrelated regression in sibling files)
Expected: both green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/match/scoreboard-sides.tsx apps/web/src/components/match/scoreboard-sides.render.spec.tsx
git commit -m "fix(web): restore Oche-Rule size gap in ScoreboardSides

Both participants' remaining score rendered at text-display regardless of
who was active, leaving only colour/tint as the turn indicator. Use the
Score primitive with size=display/lead by isActive, matching the pattern
already correct in board-wedge.tsx."
```

---

### Task 2: P1a — Reconcile detector-flagged raw-color instances to Sektorenring tokens

**Files:**
- Modify: `apps/web/src/components/match/match-scoreboard.tsx` (add `.sektorenring` to root `<section>`)
- Modify: `apps/web/src/components/match/checkout-dialog.tsx`
- Modify: `apps/web/src/components/match/dart-keypad.tsx`
- Modify: `apps/web/src/components/match/round-keypad.tsx`
- Modify: `apps/web/src/components/match/scoreboard-settings-dialog.tsx`
- Modify: `apps/web/src/components/match/scoreboard-sides.tsx` (the "am Wurf" pill only; `Score` already done in Task 1)
- Modify: `apps/web/src/components/match/visit-confirmation.tsx`
- Modify: `apps/web/src/components/organization/members-route.tsx`
- Test: `pnpm --filter @darts-platform/web exec vitest run src/components/match` plus the existing `apps/web/tests/scoreboard.spec.ts` Playwright suite (manual step, no new file)

**Interfaces:**
- Consumes: the `.sektorenring`-scoped CSS overrides in `globals.css` (`bg-ring-green` → `#047857`, `bg-ring-red` → `#be123c` — the "filled" renditions; unscoped `text-chalk` → `#f8fafc`).
- Produces: no prop/API changes anywhere in this task — pure class-attribute edits.

This task converts the "dark text on a bright, unscoped `bg-emerald-500`/`bg-amber-500`" convention (self-consistent within `components/match/*` today, but off-token per DESIGN.md's Filled-Pair Rule: "a signal colour … as a ground under chalk text — putting ring-green behind white text is a contrast failure, not putting dark text on it is fine, but it is still the WRONG token") to the Sektorenring filled pair: `bg-ring-green`/`bg-ring-red` (which resolve to the deep `#047857`/`#be123c` filled shades once `.sektorenring` is in scope) with `text-chalk` (near-white), per DESIGN.md's "Filled-Pair Rule" and "pick the filled signal token … whenever a signal sits behind chalk text."

Cross-check against the detector's 11 `gray-on-color` findings before editing: 10 of them are genuine same-branch pairings of `text-slate-950` (or a static `text-slate-950`) with `bg-emerald-500`/`bg-amber-500` — real off-token usage, fixed by the edits below. The 11th, `scoreboard-sides.tsx:51`, is a **false positive**: the detector's regex-based `gray-on-color` rule pairs class names textually within one template-literal branch regardless of which ternary arm they actually belong to (`text-slate-400` there is the *false*-branch class, paired incorrectly with the *true*-branch's `bg-emerald-500`) — the exact same false-positive shape already recorded in `.impeccable/config.json`'s `ignoreValues` for `apps/web/src/components/match-workspace.tsx`. Do not "fix" `scoreboard-sides.tsx:51` as if it were a real defect; leave that wrapping `<div>`'s background/text ternary as-is (it is correct: `bg-ring-green/15 text-chalk` when active is what Task 3 touches only incidentally if at all — do not add scope here).

- [ ] **Step 1: Scope the scoreboard root into `.sektorenring`**

In `apps/web/src/components/match/match-scoreboard.tsx`, change:

```tsx
    <section aria-label="Match-Scoreboard" className="grid h-[100dvh] grid-rows-[auto_auto_auto_1fr] bg-slate-950 text-white">
```

to:

```tsx
    <section aria-label="Match-Scoreboard" className="sektorenring grid h-[100dvh] grid-rows-[auto_auto_auto_1fr] bg-slate-950 text-white">
```

Leave `bg-slate-950 text-white` in place for this step (do not touch the base background/text yet) — `.sektorenring`'s own computed background (`--color-sisal-200` → `#020617`, identical to Tailwind's `slate-950`) and color (`--color-wedge-900` → `#f8fafc`, visually indistinguishable from `white` at body-text sizes) make this an additive, non-visually-breaking change on its own; it only *activates* correct resolution for the token classes the remaining steps introduce.

- [ ] **Step 2: Run the full match component suite to confirm no regression from the class add alone**

Run: `pnpm --filter @darts-platform/web exec vitest run src/components/match`
Expected: PASS (this step changes only a class list; no test asserts its absence)

- [ ] **Step 3: `checkout-dialog.tsx` — darts-count buttons**

Change:

```tsx
                  className={cn(dartsButtonClassName, darts === count ? "bg-emerald-500 text-slate-950" : "bg-slate-800 text-white hover:bg-slate-700")}
```

to:

```tsx
                  className={cn(dartsButtonClassName, darts === count ? "bg-ring-green text-chalk" : "bg-slate-800 text-white hover:bg-slate-700")}
```

- [ ] **Step 4: `dart-keypad.tsx` — DOUBLE/TRIPLE modifier toggles**

Change both occurrences (lines ~111 and ~121):

```tsx
          className={cn(keyClassName, modifier === 2 ? "bg-emerald-500 text-slate-950" : "bg-slate-800 hover:enabled:bg-slate-700")}
```
```tsx
          className={cn(keyClassName, modifier === 3 ? "bg-emerald-500 text-slate-950" : "bg-slate-800 hover:enabled:bg-slate-700")}
```

to:

```tsx
          className={cn(keyClassName, modifier === 2 ? "bg-ring-green text-chalk" : "bg-slate-800 hover:enabled:bg-slate-700")}
```
```tsx
          className={cn(keyClassName, modifier === 3 ? "bg-ring-green text-chalk" : "bg-slate-800 hover:enabled:bg-slate-700")}
```

- [ ] **Step 5: `round-keypad.tsx` — submit key**

Change:

```tsx
          className={cn(keyClassName, "bg-emerald-500 text-slate-950 hover:enabled:bg-emerald-400")}
```

to:

```tsx
          className={cn(keyClassName, "bg-ring-green text-chalk hover:enabled:bg-ring-green-deep")}
```

(`hover:bg-ring-green-deep` is already a defined override in `globals.css`: `.sektorenring .hover\:bg-ring-green-deep:hover { background-color: #065f46; }` — a deliberately darker hover step, matching `Control`'s own `go-hover` spec in DESIGN.md.)

- [ ] **Step 6: `scoreboard-settings-dialog.tsx` — mode switch and JA pill**

Change the `InputModeSwitch` active class (line ~45):

```tsx
            mode === option.value ? "bg-emerald-500 text-slate-950" : "bg-slate-900 text-slate-200 hover:bg-slate-800",
```

to:

```tsx
            mode === option.value ? "bg-ring-green text-chalk" : "bg-slate-900 text-slate-200 hover:bg-slate-800",
```

Change the `SettingSwitch` "JA" pill (line ~89):

```tsx
        <span className={cn("px-3 py-1.5", checked && "bg-emerald-500 text-slate-950")}>JA</span>
```

to:

```tsx
        <span className={cn("px-3 py-1.5", checked && "bg-ring-green text-chalk")}>JA</span>
```

Note: this file's regex-flagged `text-slate-200 on bg-emerald-500` (the 11th-but-one finding, itself a ternary cross-branch false positive) disappears as a side effect once the `text-slate-950`/`bg-emerald-500` pairing above is gone — no separate fix needed for it.

- [ ] **Step 7: `scoreboard-sides.tsx` — "am Wurf" pill**

Change:

```tsx
                  <span className={person.isThrowing ? "rounded-full bg-emerald-500 px-2 text-slate-950" : ""}>
```

to:

```tsx
                  <span className={person.isThrowing ? "rounded-full bg-ring-green px-2 text-chalk" : ""}>
```

- [ ] **Step 8: `visit-confirmation.tsx` — WEITER button**

Change:

```tsx
            className="min-h-14 rounded-lg bg-emerald-500 text-title-sm font-bold text-slate-950 transition hover:bg-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
```

to:

```tsx
            className="min-h-14 rounded-lg bg-ring-green text-title-sm font-bold text-chalk transition hover:bg-ring-green-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green"
```

(Also swaps the focus-ring color from `emerald-400` to the token `ring-green`, for the same reason — matches the "focus ring is ring-green" rule from `page-nav.tsx`'s own `navLinkClassName`.)

- [ ] **Step 9: `members-route.tsx` — ownership-transfer confirm button**

This one is semantically a high-consequence, irreversible destructive-ish confirmation ("Eigentum übertragen" — hands over every right in the organization, reversible only by another ownership transfer), not a "go/positive" action — map it to the **danger** pairing (`bg-ring-red`/`text-chalk`), not green. This file already renders inside a `.sektorenring`-scoped ancestor: `MembersRoute` is rendered by `apps/web/src/app/mitglieder/page.tsx`, and `members-route.tsx` wraps its own content in `<WorkspaceShell>` (imported at the top of the file), whose `<main>` carries `className="sektorenring min-h-screen"` (`apps/web/src/components/workspace-shell.tsx:40`) — confirmed by reading both files during research for this plan. No `.sektorenring` addition needed here.

Change:

```tsx
        className="w-full max-w-lg space-y-5 rounded-2xl border border-amber-400/50 bg-slate-950 p-5 text-white shadow-2xl sm:p-6"
```

to:

```tsx
        className="w-full max-w-lg space-y-5 rounded-2xl border border-ring-red-deep/50 bg-slate-950 p-5 text-white shadow-2xl sm:p-6"
```

and:

```tsx
          <Button className="bg-amber-500 text-slate-950 hover:bg-amber-400" disabled={pending} onClick={onConfirm} type="button">
```

to:

```tsx
          <Button className="bg-ring-red text-chalk hover:bg-ring-red-deep" disabled={pending} onClick={onConfirm} type="button">
```

- [ ] **Step 10: Full match/organization suite + typecheck**

Run: `pnpm --filter @darts-platform/web exec vitest run src/components/match src/components/organization`
Run: `pnpm --filter @darts-platform/web typecheck`
Expected: both green.

- [ ] **Step 11: Re-run the detector to confirm the 10 genuine findings are gone**

Run: `node .claude/skills/impeccable/scripts/detect.mjs --json apps/web/src`
Expected: exit code 2 with 0 remaining `gray-on-color` findings in the 7 files touched above (the tool has no way to know about the `scoreboard-sides.tsx:51` false positive being pre-existing and untouched — confirm manually it is still the only line reported there, if reported at all).

- [ ] **Step 12: Manual Playwright sanity check on the actual scoring flow**

Run: `pnpm --filter @darts-platform/web test:e2e -- scoreboard`
Expected: `apps/web/tests/scoreboard.spec.ts` passes unchanged — this is the release-blocking regression guard for the exact screen this task edits color tokens on.

- [ ] **Step 13: Commit**

```bash
git add apps/web/src/components/match/match-scoreboard.tsx \
        apps/web/src/components/match/checkout-dialog.tsx \
        apps/web/src/components/match/dart-keypad.tsx \
        apps/web/src/components/match/round-keypad.tsx \
        apps/web/src/components/match/scoreboard-settings-dialog.tsx \
        apps/web/src/components/match/scoreboard-sides.tsx \
        apps/web/src/components/match/visit-confirmation.tsx \
        apps/web/src/components/organization/members-route.tsx
git commit -m "fix(web): replace raw emerald/amber fills with Sektorenring tokens

Scoreboard controls used bg-emerald-500/text-slate-950 (and one bg-amber-500)
instead of the design system's filled-pair tokens (bg-ring-green/bg-ring-red
+ text-chalk). Scopes match-scoreboard.tsx into .sektorenring so the token
overrides in globals.css resolve correctly. Closes 10 of the detector's 11
gray-on-color findings (the 11th, scoreboard-sides.tsx:51, is a pre-existing
ternary-branch false positive, left untouched)."
```

---

### Task 3: P1b — Remove the amber "third accent hue" from state indicators

**Files:**
- Modify: `apps/web/src/app/offline/page.tsx` (add `.sektorenring`)
- Modify: `apps/web/src/components/health-dashboard.tsx`
- Modify: `apps/web/src/components/match/match-scoreboard.tsx` (queued-command banner only)
- Modify: `apps/web/src/components/match/scoreboard-status.tsx`
- Test: `pnpm --filter @darts-platform/web exec vitest run src/components/health-dashboard.spec.tsx` (new, see Step 3)

**Interfaces:**
- Consumes: `StateTag` from `@darts-platform/ui` (`tone: "free" | "live" | "finish" | "blocked" | "conflict" | "waiting"`, `on: "ink" | "sisal"` — see `packages/ui/src/sektorenring/state-tag.tsx`). The `waiting` tone already exists specifically for "pending/queued" and renders a clock mark + word, satisfying the Never-Only-Colour rule for free.
- Produces: no prop/API changes.

Amber (`amber-200`/`amber-300`/`amber-400`/`amber-500`) is used across these four files purely to mean "pending/waiting/queued/offline" — exactly the semantic `StateTag`'s `waiting` tone (a slate/steel clock-mark word, not a third hue) already exists for. This task swaps the ad-hoc amber dot-plus-text pattern for `StateTag`, and — where the surrounding markup is a full custom layout rather than a single inline status line — swaps only the raw amber color classes for the `waiting` tone's own token (`text-spider`/`text-sisal-500`, per `onInk`/`onSisal` in `state-tag.tsx`), whichever `StateTag` itself would have used, to stay visually consistent without forcing every call site into the exact `StateTag` markup shape.

- [ ] **Step 1: `apps/web/src/app/offline/page.tsx`**

Add `.sektorenring` to the root and replace the ad-hoc amber dot with `StateTag`:

```tsx
import type { Metadata } from "next";

import { StateTag } from "@darts-platform/ui";

export const metadata: Metadata = { title: "Offline" };

export default function OfflinePage() {
  return <main className="sektorenring flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
    <section className="max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-7">
      <h1 className="font-numerals text-headline font-bold">DartBase bleibt bereit</h1>
      <p className="mt-3">
        <StateTag label="Keine Verbindung" on="ink" tone="waiting" />
      </p>
      <p className="mt-4 max-w-[65ch] prose-de text-body text-slate-300">Die App-Oberfläche ist offline verfügbar. Bereits geöffnete Board-Matches speichern neue Aufnahmen auf diesem Gerät und übertragen sie nach Wiederherstellung der Verbindung.</p>
    </section>
  </main>;
}
```

(The outer border moves from `border-amber-300/40` to a neutral `border-slate-700`: this panel isn't itself an alarm state to react to — it's an expected, calm PWA-offline notice — so the amber border was miscategorized signal-color use to begin with, not just off-token. `StateTag`'s `waiting` clock mark now carries the "pending" meaning instead.)

- [ ] **Step 2: `apps/web/src/components/health-dashboard.tsx`**

Full replacement for this file (verified against the actual current source — `Button` stays imported and used by the refresh control; `cn` is dropped since `StatusRow`'s manual class-branching is gone; the error banner's raw `rose-400/30`/`bg-rose-400/10`/`text-rose-200` also gets tokenized in the same pass, since it's the same off-token-color finding on the same file):

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";

import { Button, StateTag } from "@darts-platform/ui";

import { fetchHealth } from "@/lib/health";

type DisplayStatus = "ok" | "error" | "pending";

interface StatusRowProps {
  readonly label: string;
  readonly status: DisplayStatus;
}

const statusLabels = {
  ok: "OK",
  error: "Nicht verfügbar",
  pending: "Wird geprüft …",
} as const satisfies Record<DisplayStatus, string>;

const statusTone = {
  ok: "free",
  error: "blocked",
  pending: "waiting",
} as const satisfies Record<DisplayStatus, "free" | "blocked" | "waiting">;

function StatusRow({ label, status }: StatusRowProps) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-6 border-b border-slate-800 py-3 last:border-0">
      <dt className="text-body font-medium text-slate-300">{label}</dt>
      <dd>
        <StateTag label={statusLabels[status]} on="ink" tone={statusTone[status]} />
      </dd>
    </div>
  );
}

export function HealthDashboard() {
  const healthQuery = useQuery({
    queryKey: ["system-health"],
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval: 10_000,
  });

  const apiStatus: DisplayStatus = healthQuery.isPending
    ? "pending"
    : healthQuery.isError
      ? "error"
      : "ok";
  const databaseStatus: DisplayStatus = healthQuery.isPending
    ? "pending"
    : healthQuery.data?.services.database === "ok"
      ? "ok"
      : "error";
  const redisStatus: DisplayStatus = healthQuery.isPending
    ? "pending"
    : healthQuery.data?.services.redis === "ok"
      ? "ok"
      : "error";

  return (
    <section
      aria-labelledby="services-title"
      className="w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-8"
    >
      <div className="mb-5 flex flex-col gap-4 border-b border-slate-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="services-title" className="font-numerals text-title font-bold text-white">
            DartBase-Dienste
          </h2>
        </div>
        <Button
          aria-label="Dienststatus aktualisieren"
          disabled={healthQuery.isFetching}
          onClick={() => void healthQuery.refetch()}
          variant="outline"
        >
          {healthQuery.isFetching ? "Wird aktualisiert …" : "Aktualisieren"}
        </Button>
      </div>

      <dl aria-live="polite">
        <StatusRow label="Web" status="ok" />
        <StatusRow label="API" status={apiStatus} />
        <StatusRow label="Datenbank" status={databaseStatus} />
        <StatusRow label="Redis" status={redisStatus} />
      </dl>

      {healthQuery.isError ? (
        <p className="mt-5 rounded-lg border border-ring-red-deep/30 bg-ring-red-deep/10 p-3 text-body text-ring-red-deep">
          Der Systemstatus ist aktuell nicht erreichbar. Versuche es in Kürze erneut.
        </p>
      ) : null}
    </section>
  );
}
```

This component renders inside `ApplicationDashboard`, which is NOT itself under `.sektorenring` (`apps/web/src/app/page.tsx`'s root has none — confirmed by grep during research for this plan). `StateTag`'s `on="ink"` tones (`onInk` map in `state-tag.tsx`) reference `text-ring-green-lit`/`text-ring-red-lit`/`text-spider`, and the error banner's `text-ring-red-deep`/`bg-ring-red-deep` — all of these custom properties (`--color-ring-green-lit`, `--color-ring-red-lit`, `--color-ring-red-deep`, `--color-spider`) are defined unconditionally in the top-level `@theme` block in `globals.css` (lines 9–35), not only inside the later `.sektorenring` class block, so they resolve correctly here without adding that class.

- [ ] **Step 3: Write the render test for the health dashboard status mapping**

Create `apps/web/src/components/health-dashboard.render.spec.tsx`:

```tsx
// @vitest-environment happy-dom
//
// Haelt fest, dass das Health-Panel keine dritte Akzentfarbe mehr traegt:
// jeder Status kommt ueber StateTag (Farbe + gezeichnete Marke + Wort), nicht
// mehr ueber einen rohen amber/emerald/rose-Punkt (DESIGN.md, "The Two
// Signals Rule").
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/health", () => ({
  fetchHealth: vi.fn(() => Promise.resolve({ services: { database: "ok", redis: "ok" } })),
}));

import { HealthDashboard } from "./health-dashboard";

afterEach(() => {
  cleanup();
});

describe("HealthDashboard", () => {
  it("rendert keine rohe amber/emerald/rose-Klasse mehr", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      createElement(QueryClientProvider, { client: queryClient }, createElement(HealthDashboard)),
    );
    await screen.findAllByText("OK");
    expect(container.innerHTML).not.toMatch(/\b(?:bg|text)-(?:amber|emerald|rose)-\d/);
  });
});
```

The mocked resolved value matches `HealthResponse` (`@darts-platform/schemas`) as read from `apps/web/src/lib/health.ts`: `{ services: { database, redis } }`; `apiStatus` derives from `healthQuery.isError`/`isPending`, not from a field on the payload, so it needs no mock field of its own.

- [ ] **Step 4: Run the new test**

Run: `pnpm --filter @darts-platform/web exec vitest run src/components/health-dashboard.render.spec.tsx`
Expected: PASS

- [ ] **Step 5: `match-scoreboard.tsx` — queued-command banner**

Change:

```tsx
            <div className="border-b border-amber-400/40 bg-amber-300/10 p-4">
```
```tsx
                <p className="text-body text-amber-100" role="status">{queueReadError}</p>
```
```tsx
                <p className="text-body text-amber-100" role="status">{queueWriteError}</p>
```
```tsx
                    <span className="flex flex-wrap items-center justify-between gap-3 text-body text-amber-100" key={command.commandId}>
```
(the class is actually on the enclosing `<div>`, not a `<span>` — re-read the exact current line before editing; do not assume the tag name, only the class list, which was verified above)

to (steel/slate replacing amber, keeping the same layout, border and background structure — only the two color families swap):

```tsx
            <div className="border-b border-slate-700 bg-slate-900 p-4">
```
```tsx
                <p className="text-body text-slate-200" role="status">{queueReadError}</p>
```
```tsx
                <p className="text-body text-slate-200" role="status">{queueWriteError}</p>
```
and the per-entry row's text color class:
```tsx
                  <div className="flex flex-wrap items-center justify-between gap-3 text-body text-slate-200" key={command.commandId}>
```

This file already gained `.sektorenring` in Task 2 Step 1, so this step could equally use `text-spider`/`bg-wedge-900`-family tokens instead of plain Tailwind slate — but this banner's job is exactly the "waiting" queue notice already handled by `StateTag`'s `waiting` tone (`text-spider` on ink), so for full consistency with Step 1/2 above, prefer:

```tsx
            <div className="border-b border-slate-700 bg-slate-900 p-4">
```
(border/background stay as literal slate — this banner is inside `.sektorenring` scope, but `slate-700`/`slate-900` are plain unscoped Tailwind grays, not Sektorenring tokens; this is acceptable here because the surrounding markup keeps its own established slate-panel convention rather than pulling in a full `Wedge` wrapper, which would change padding/radius and is out of scope for this task's "smallest sensible change") and text color `text-slate-200` unmodified from the current file's own existing pattern elsewhere (`scoreboard-status.tsx` already uses `text-slate-200` for its own status lines) rather than introducing yet another token here.

- [ ] **Step 6: `scoreboard-status.tsx` — queued-count line**

Change:

```tsx
      {queuedCount > 0 ? (
        <p className="text-amber-300">
          {queuedCount} Aufnahme wartet dauerhaft gespeichert auf die Übertragung.
        </p>
      ) : null}
```

to:

```tsx
      {queuedCount > 0 ? (
        <p className="text-slate-200">
          {queuedCount} Aufnahme wartet dauerhaft gespeichert auf die Übertragung.
        </p>
      ) : null}
```

(Matching the file's own existing `text-slate-200` convention for the `FREMD`/`WIRD_ÜBERNOMMEN`/offline lines directly above it — this was the one line in the file that broke that internal consistency with a one-off amber, per the critique's "amber shows up for pending/queued states … where `StateTag`'s existing `waiting` tone was built for exactly this" finding. A full `StateTag` swap here was considered but rejected: this line sits inside a `role="status"` container that already announces itself to assistive tech, and wrapping it in `StateTag` would nest a second `uppercase tracking-[0.12em]` caption style inside body-copy sentence casing, reads oddly with the surrounding sentence-case lines in the same box. Plain-color reconciliation is the smallest sensible fix; note the fuller `StateTag` treatment as a follow-up if a future design pass unifies this whole status block.)

- [ ] **Step 7: Full suite + typecheck + detector re-scan**

Run: `pnpm --filter @darts-platform/web exec vitest run src/components/match src/components/health-dashboard.render.spec.tsx src/app`
Run: `pnpm --filter @darts-platform/web typecheck`
Run: `node .claude/skills/impeccable/scripts/detect.mjs --json apps/web/src` (confirm no new findings; `overused-font`/other pre-existing ignored findings from `.impeccable/config.json` are expected to still be silent)
Expected: all green / clean.

- [ ] **Step 8: Playwright sanity check**

Run: `pnpm --filter @darts-platform/web test:e2e -- scoreboard`
Expected: PASS (the queued-banner and status-line changes are presentation-only, no selector/text changed).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/app/offline/page.tsx \
        apps/web/src/components/health-dashboard.tsx \
        apps/web/src/components/health-dashboard.render.spec.tsx \
        apps/web/src/components/match/match-scoreboard.tsx \
        apps/web/src/components/match/scoreboard-status.tsx
git commit -m "fix(web): remove amber third accent hue from pending/offline states

Offline page, health dashboard, the queued-command banner and the
scoreboard's queued-count line all used amber-* to mean 'pending' — a
third accent hue the design system forbids. Health dashboard and the
offline page now use StateTag's existing 'waiting' tone (colour + drawn
clock mark + word); the two banner/status lines fall back to this file's
own established slate-200 convention where a full StateTag would clash
with surrounding sentence-case copy."
```

---

### Task 4: P1c — Move alarm/conflict banners above admin chrome in the command centre

**Files:**
- Modify: `apps/web/src/components/tournament/command-centre.tsx`

**Interfaces:** none — pure JSX reordering, no prop or state changes.

- [ ] **Step 1: Reorder the render**

In `apps/web/src/components/tournament/command-centre.tsx`, the current render order (inside the `<div className="mx-auto max-w-[1600px] …">` wrapper) is:

```
<PageNav>…</PageNav>
<DashboardHeader … />
<SharePanel … />
<DisplayKeysPanel … />
{conflict ? <Wedge tone="alarm">…</Wedge> : null}
{commandError !== null && conflict === null ? <Wedge tone="alarm">…</Wedge> : null}
{queueReadError !== null ? <Wedge tone="alarm">…</Wedge> : null}
{queueWriteError !== null ? <Wedge tone="alarm">…</Wedge> : null}
{queueEntries.length > 0 ? <Wedge tone="plate">…</Wedge> : null}
```

Move the four `tone="alarm"` blocks (the `conflict`, `commandError`, `queueReadError`, `queueWriteError` blocks — everything between the `{conflict ? …}` block, inclusive, and the closing `) : null}` right before `{queueEntries.length > 0 ? …}`) to sit immediately after `<DashboardHeader … />` and before `<SharePanel … />`. Do not change the JSX inside each block — only their position. Do not move the `queueEntries.length > 0` (`tone="plate"`, not alarm) block; it stays where it is, after `DisplayKeysPanel`.

Resulting order:

```
<PageNav>…</PageNav>
<DashboardHeader … />
{conflict ? <Wedge tone="alarm">…</Wedge> : null}
{commandError !== null && conflict === null ? <Wedge tone="alarm">…</Wedge> : null}
{queueReadError !== null ? <Wedge tone="alarm">…</Wedge> : null}
{queueWriteError !== null ? <Wedge tone="alarm">…</Wedge> : null}
<SharePanel … />
<DisplayKeysPanel … />
{queueEntries.length > 0 ? <Wedge tone="plate">…</Wedge> : null}
```

- [ ] **Step 2: Typecheck + existing command-centre tests**

Run: `pnpm --filter @darts-platform/web typecheck`
Run: `pnpm --filter @darts-platform/web exec vitest run src/components/tournament`
Expected: both green — no test in this suite asserts DOM order of these blocks today (confirm by grepping the suite for `"Versionskonflikt"` / `"Befehl nicht ausgeführt"` before assuming; if one does assert order, update its expectation to match the new, intended order rather than reverting the change).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/tournament/command-centre.tsx
git commit -m "fix(web): surface version-conflict/error banners above admin panels

Alarm-tone banners (version conflict, command error, queue read/write
error) rendered below the SharePanel and DisplayKeysPanel — administrative
chrome a director rarely touches mid-tournament — costing time exactly
when a live incident needs the fastest possible visibility."
```

---

### Task 5: P2 — Demote the entry-page health panel

**Files:**
- Modify: `apps/web/src/components/application-dashboard.tsx`
- Modify: `apps/web/src/components/health-dashboard.tsx` (add a compact variant alongside the existing full one)

**Interfaces:**
- Produces: `HealthDashboard` gains an optional `variant?: "full" | "compact"` prop, default `"full"` (backward compatible — no other call site is known to exist besides `application-dashboard.tsx`; grep `apps/web/src` for `<HealthDashboard` before this step to confirm before changing its default).

- [ ] **Step 1: Add a compact rendering path to `HealthDashboard`**

After Task 3's edits, `health-dashboard.tsx`'s `StatusRow` already renders `StateTag`, and `apiStatus`/`databaseStatus`/`redisStatus` are already derived (the `"Web"` row is always `"ok"`, hardcoded, unrelated to the query). Add a `variant` prop; in `"compact"` mode, render a single summary `StateTag` (worst of the three real statuses — `"Web"` is excluded from the worst-of calculation since it's not a real check) instead of the four-row `<dl>` and the refresh button:

```tsx
export function HealthDashboard({ variant = "full" }: { readonly variant?: "full" | "compact" }) {
  const healthQuery = useQuery({
    queryKey: ["system-health"],
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval: 10_000,
  });

  const apiStatus: DisplayStatus = healthQuery.isPending
    ? "pending"
    : healthQuery.isError
      ? "error"
      : "ok";
  const databaseStatus: DisplayStatus = healthQuery.isPending
    ? "pending"
    : healthQuery.data?.services.database === "ok"
      ? "ok"
      : "error";
  const redisStatus: DisplayStatus = healthQuery.isPending
    ? "pending"
    : healthQuery.data?.services.redis === "ok"
      ? "ok"
      : "error";

  if (variant === "compact") {
    const statuses = [apiStatus, databaseStatus, redisStatus];
    const worst: DisplayStatus = statuses.includes("error")
      ? "error"
      : statuses.includes("pending")
        ? "pending"
        : "ok";
    const compactLabel = {
      ok: "Dienste betriebsbereit",
      error: "Dienststörung",
      pending: "Dienste werden geprüft …",
    } as const satisfies Record<DisplayStatus, string>;
    return <StateTag label={compactLabel[worst]} on="sisal" tone={statusTone[worst]} />;
  }

  return (
    <section
      aria-labelledby="services-title"
      className="w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-8"
    >
      <div className="mb-5 flex flex-col gap-4 border-b border-slate-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="services-title" className="font-numerals text-title font-bold text-white">
            DartBase-Dienste
          </h2>
        </div>
        <Button
          aria-label="Dienststatus aktualisieren"
          disabled={healthQuery.isFetching}
          onClick={() => void healthQuery.refetch()}
          variant="outline"
        >
          {healthQuery.isFetching ? "Wird aktualisiert …" : "Aktualisieren"}
        </Button>
      </div>

      <dl aria-live="polite">
        <StatusRow label="Web" status="ok" />
        <StatusRow label="API" status={apiStatus} />
        <StatusRow label="Datenbank" status={databaseStatus} />
        <StatusRow label="Redis" status={redisStatus} />
      </dl>

      {healthQuery.isError ? (
        <p className="mt-5 rounded-lg border border-ring-red-deep/30 bg-ring-red-deep/10 p-3 text-body text-ring-red-deep">
          Der Systemstatus ist aktuell nicht erreichbar. Versuche es in Kürze erneut.
        </p>
      ) : null}
    </section>
  );
}
```

`on="sisal"` (rather than `"ink"`, used by the per-row `StatusRow` tags) because this pill sits directly on the entry page's own background, not inside a dark panel — `onSisal` tones in `state-tag.tsx` are tuned for that ground (`text-ring-green-deep`/`text-ring-red-deep`/`text-sisal-500`, each verified in DESIGN.md to clear 4.5:1 there).

- [ ] **Step 2: Use the compact variant on the entry page**

In `apps/web/src/components/application-dashboard.tsx`, change:

```tsx
      <div className="w-full">
        <div className="grid gap-6 lg:grid-cols-2">
          <AuthPanel onAuthenticated={session.refetch} />
          <HealthDashboard />
        </div>
        <AuthFooter />
      </div>
```

to:

```tsx
      <div className="w-full">
        <AuthPanel onAuthenticated={session.refetch} />
        <p className="mt-4 flex justify-center">
          <HealthDashboard variant="compact" />
        </p>
        <AuthFooter />
      </div>
```

This drops the `lg:grid-cols-2` two-column layout (the health panel no longer needs a column of its own) and centers the compact pill below the login form instead — the first screen a visitor sees is now the login form and the product name, with service status reduced to one small, still-honest status pill, not a full ops dashboard competing for attention (Single Focus, cognitive-load checklist item).

- [ ] **Step 3: Test**

Run: `pnpm --filter @darts-platform/web exec vitest run src/components/health-dashboard.render.spec.tsx` (extend the Task 3 test file with one more `it` covering `variant="compact"` rendering exactly one `StateTag` and no `<dl>`)
Run: `pnpm --filter @darts-platform/web typecheck`
Expected: both green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/application-dashboard.tsx apps/web/src/components/health-dashboard.tsx apps/web/src/components/health-dashboard.render.spec.tsx
git commit -m "fix(web): demote entry-page health panel to a single status pill

The anonymous landing page paired the login form with a full-weight raw
infra health dashboard (Web/API/Datenbank/Redis) — a visitor's first
screen was an ops panel, nothing dart-related. HealthDashboard gains a
compact variant (one summary StateTag); application-dashboard.tsx uses it."
```

---

### Task 6: P2 — Chunk the ungrouped 8-item lists on `player-profile.tsx` and `setup-sheet.tsx`

**Files:**
- Modify: `apps/web/src/components/player-profile.tsx`
- Modify: `apps/web/src/components/tournament/setup-sheet.tsx`

**Interfaces:** none — pure markup regrouping, no data/prop changes.

- [ ] **Step 1: `player-profile.tsx` — split the 8 stat tiles into two labeled groups**

Change:

```tsx
      <section aria-label="Karrierestatistik" className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Statistic label="Average" value={stats.threeDartAverage.toFixed(2)} />
        <Statistic label="First 9" value={stats.firstNineAverage.toFixed(2)} />
        <Statistic
          label="Checkout-Quote"
          value={stats.checkoutPercentage === null ? "–" : `${stats.checkoutPercentage.toFixed(1)} %`}
          note={stats.checkouts === null || stats.checkoutAttempts === null ? "Unter Straight Out nicht anwendbar" : `${stats.checkouts} von ${stats.checkoutAttempts}`}
        />
        <Statistic label="180er" value={String(stats.oneEighties)} />
        <Statistic label="High Finish" value={String(stats.highFinish)} />
        <Statistic label="Best Leg" value={stats.bestLeg === null ? "–" : `${stats.bestLeg} Darts`} />
        <Statistic label="Darts pro Leg" value={stats.dartsPerLeg.toFixed(2)} />
        <Statistic label="Siegquote" value={stats.matchesPlayed === 0 ? "0 %" : `${(stats.wins / stats.matchesPlayed * 100).toFixed(1)} %`} />
      </section>
```

to:

```tsx
      <section aria-label="Karrierestatistik" className="mt-5 flex flex-col gap-6">
        <div>
          <SheetLabel as="h2">Scoring</SheetLabel>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Statistic label="Average" value={stats.threeDartAverage.toFixed(2)} />
            <Statistic label="First 9" value={stats.firstNineAverage.toFixed(2)} />
            <Statistic label="180er" value={String(stats.oneEighties)} />
            <Statistic label="High Finish" value={String(stats.highFinish)} />
          </div>
        </div>
        <div>
          <SheetLabel as="h2">Finish &amp; Form</SheetLabel>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Statistic
              label="Checkout-Quote"
              value={stats.checkoutPercentage === null ? "–" : `${stats.checkoutPercentage.toFixed(1)} %`}
              note={stats.checkouts === null || stats.checkoutAttempts === null ? "Unter Straight Out nicht anwendbar" : `${stats.checkouts} von ${stats.checkoutAttempts}`}
            />
            <Statistic label="Best Leg" value={stats.bestLeg === null ? "–" : `${stats.bestLeg} Darts`} />
            <Statistic label="Darts pro Leg" value={stats.dartsPerLeg.toFixed(2)} />
            <Statistic label="Siegquote" value={stats.matchesPlayed === 0 ? "0 %" : `${(stats.wins / stats.matchesPlayed * 100).toFixed(1)} %`} />
          </div>
        </div>
      </section>
```

`SheetLabel` is already imported in this file (`import { Rule, SheetLabel } from "@darts-platform/ui";`), so no new import is needed.

- [ ] **Step 2: `setup-sheet.tsx` — split section "1 · Turnier" into two subgroups**

Change the single 8-field grid (lines ~230–323) into two 4-field grids under sub-captions, keeping every `Field`/`SelectInput`/`TextInput` block byte-for-byte identical — only the wrapping `<div>` structure changes:

```tsx
              <div className="mt-4 flex flex-col gap-6">
                <div>
                  <SheetLabel as="p" className="text-caption normal-case">Grunddaten</SheetLabel>
                  <div className="mt-2 grid gap-4 sm:grid-cols-2">
                    <Field
                      className="sm:col-span-2"
                      error={contractErrors.name ?? null}
                      htmlFor="name"
                      label="Name"
                    >
                      <TextInput
                        aria-describedby={contractErrors.name ? "name-error" : undefined}
                        id="name"
                        placeholder="Vereinsmeisterschaft 2026"
                        {...register("name")}
                      />
                    </Field>
                    <Field
                      error={contractErrors.startsAt ?? null}
                      htmlFor="startsAt"
                      label="Startdatum"
                    >
                      <TextInput
                        aria-describedby={contractErrors.startsAt ? "startsAt-error" : undefined}
                        id="startsAt"
                        type="date"
                        {...register("startsAt")}
                      />
                    </Field>
                    <Field htmlFor="format" label="Format">
                      <SelectInput id="format" {...register("format")}>
                        <option value="GROUPS_THEN_KNOCKOUT">Gruppen, dann K.-o.</option>
                        <option value="ROUND_ROBIN">Jeder gegen jeden</option>
                        <option value="SINGLE_ELIMINATION">Einfach-K.-o.</option>
                      </SelectInput>
                    </Field>
                    <Field htmlFor="startingScore" label="Startscore">
                      <SelectInput id="startingScore" {...register("startingScore")}>
                        <option value="301">301</option>
                        <option value="501">501</option>
                        <option value="701">701</option>
                      </SelectInput>
                    </Field>
                  </div>
                </div>
                <div>
                  <SheetLabel as="p" className="text-caption normal-case">Spielregeln</SheetLabel>
                  <div className="mt-2 grid gap-4 sm:grid-cols-2">
                    <Field
                      error={contractErrors.bestOfLegs ?? null}
                      htmlFor="bestOfLegs"
                      label="Best of Legs"
                    >
                      <SelectInput
                        aria-describedby={contractErrors.bestOfLegs ? "bestOfLegs-error" : undefined}
                        id="bestOfLegs"
                        {...register("bestOfLegs")}
                      >
                        <option value="1">Best of 1</option>
                        <option value="3">Best of 3</option>
                        <option value="5">Best of 5</option>
                        <option value="7">Best of 7</option>
                      </SelectInput>
                    </Field>
                    <Field
                      error={contractErrors.bestOfSets ?? null}
                      htmlFor="bestOfSets"
                      label="Best of Sets"
                    >
                      <SelectInput
                        aria-describedby={contractErrors.bestOfSets ? "bestOfSets-error" : undefined}
                        id="bestOfSets"
                        {...register("bestOfSets")}
                      >
                        <option value="1">Best of 1</option>
                        <option value="3">Best of 3</option>
                        <option value="5">Best of 5</option>
                        <option value="7">Best of 7</option>
                      </SelectInput>
                    </Field>
                    <Field error={contractErrors.inRule ?? null} htmlFor="inRule" label="In-Regel">
                      <SelectInput
                        aria-describedby={contractErrors.inRule ? "inRule-error" : undefined}
                        id="inRule"
                        {...register("inRule")}
                      >
                        <option value="STRAIGHT">Straight In</option>
                        <option value="DOUBLE">Double In</option>
                      </SelectInput>
                    </Field>
                    <Field error={contractErrors.outRule ?? null} htmlFor="outRule" label="Out-Regel">
                      <SelectInput
                        aria-describedby={contractErrors.outRule ? "outRule-error" : undefined}
                        id="outRule"
                        {...register("outRule")}
                      >
                        <option value="SINGLE">Single Out</option>
                        <option value="DOUBLE">Double Out</option>
                        <option value="MASTER">Master Out</option>
                      </SelectInput>
                    </Field>
                  </div>
                </div>
              </div>
```

`SheetLabel as="p"` with `className="text-caption normal-case"` overrides the component's own default uppercase/label-size classes (`sheetLabelVariants` base: `"min-w-0 font-plate text-label font-semibold uppercase"`) down to a plain caption-weight sub-heading, dropping to `tone`'s default (`"ink"` → `text-sisal-500`, already the desired color, so no color override is needed). This avoids a second all-caps tracked "eyebrow" stacked directly under the section's own `<h2 id="setup-basics">1 · Turnier</h2>` `SheetLabel`, which DESIGN.md's Do's/Don'ts explicitly forbids ("Don't stack a small uppercase caption above a heading as an eyebrow"). Verified against `packages/ui/src/lib/cn.ts`: its `tailwind-merge` extension registers all ten type-scale steps (`display` … `label`, including `caption`) as one `font-size` class group specifically so a later step correctly replaces an earlier one instead of both colliding as an unrelated color utility (see that file's own doc comment) — `text-caption` after the base `text-label` therefore merges correctly, and `normal-case` after `uppercase` merges via Tailwind's built-in text-transform group with no extension needed.

- [ ] **Step 2: Typecheck + existing setup-sheet / player-profile tests**

Run: `pnpm --filter @darts-platform/web typecheck`
Run: `pnpm --filter @darts-platform/web exec vitest run src/components/tournament src/components/player-profile` (adjust the second path if `player-profile.tsx` has no colocated spec directory of its own — check first)
Expected: both green; if an existing test queries a `Field` by its position within a single flat list (e.g. `getAllByRole("textbox")[3]`), it still passes since the *set* and *order* of fields is unchanged, only their DOM grouping.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/player-profile.tsx apps/web/src/components/tournament/setup-sheet.tsx
git commit -m "fix(web): chunk 8-item stat/field groups into labeled subgroups of 4

player-profile.tsx's Karrierestatistik and setup-sheet.tsx's '1 · Turnier'
each presented 8 items in one flat group, failing the cognitive-load
checklist's <=4-per-group guidance on two surfaces that are explicitly NOT
covered by the command-centre's deliberate density exception."
```

---

### Task 7: P3 — Link the Bedienungsanleitung from the tools that need it

**Files:**
- Modify: `apps/web/src/components/page-nav.tsx` (no code change — read-only check, see Step 1)
- Modify: `apps/web/src/components/tournament/command-centre.tsx`
- Modify: `apps/web/src/components/match/scoreboard-header.tsx`

**Interfaces:** none.

- [ ] **Step 1: Confirm `NavLink` (Next `Link`) works for a static `.html` asset**

`NavLink` (in `page-nav.tsx`) wraps `next/link`'s `Link`, which handles any `href` including a path to a public static file — it does not require the target to be an app-router route. The existing landing-page link to `/bedienungsanleitung.html` (`apps/web/src/app/page.tsx:44-49`) uses a plain `<a>` instead only because that file predates `page-nav.tsx`'s extraction (see that component's own doc comment: "sie lag vorher fünfmal als lokale Konstante … und in drei weiteren Renditionen"). Using `NavLink` here is consistent with, not a deviation from, the stated intent of consolidating every nav-link rendition into one. No code change in this step — just confirm by reading `apps/web/src/app/page.tsx` once more that nothing about that link depends on being a plain anchor (e.g. no `target="_blank"`, no download attribute) before reusing `NavLink` elsewhere.

- [ ] **Step 2: Add it to the command centre's `PageNav`**

In `apps/web/src/components/tournament/command-centre.tsx`, change:

```tsx
        <PageNav>
          <NavLink href={`/turniere?organisation=${organizationId}`}>Alle Turniere</NavLink>
          <NavLink href={`/live/${dashboard.tournament.publicId}`}>Öffentliche Live-Ansicht</NavLink>
        </PageNav>
```

to:

```tsx
        <PageNav>
          <NavLink href={`/turniere?organisation=${organizationId}`}>Alle Turniere</NavLink>
          <NavLink href={`/live/${dashboard.tournament.publicId}`}>Öffentliche Live-Ansicht</NavLink>
          <NavLink href="/bedienungsanleitung.html">Bedienungsanleitung</NavLink>
        </PageNav>
```

- [ ] **Step 3: Add a help icon-button to the scoreboard header**

In `apps/web/src/components/match/scoreboard-header.tsx`, add a drawn question-mark mark (per DESIGN.md: "no unicode glyphs standing in for a mark") and a third icon button next to the settings gear:

```tsx
/** Fragezeichen: rein dekorativ, die zugängliche Bezeichnung trägt der Link. */
function HelpIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path d="M9.5 9a2.5 2.5 0 1 1 3.4 2.33c-.77.3-1.4.98-1.4 1.92v.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="17.5" fill="currentColor" r="0.75" stroke="none" />
    </svg>
  );
}
```

and in the right-hand `<div className="flex items-center justify-end gap-1">` block, add the link before the settings button:

```tsx
      <div className="flex items-center justify-end gap-1">
        {live !== null ? (
          <Link
            className="inline-flex min-h-11 items-center rounded-lg px-2 text-label font-semibold text-emerald-300 transition hover:bg-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
            href={live}
          >
            LIVE
          </Link>
        ) : null}
        <Link aria-label="Bedienungsanleitung" className={iconButtonClassName} href="/bedienungsanleitung.html">
          <HelpIcon />
        </Link>
        <button aria-label="Einstellungen" className={iconButtonClassName} onClick={onOpenSettings} type="button">
          <GearIcon />
        </button>
      </div>
```

`iconButtonClassName` and `Link` are already imported/defined in this file; no new imports needed beyond nothing (both already present).

- [ ] **Step 4: Typecheck + component tests + e2e**

Run: `pnpm --filter @darts-platform/web typecheck`
Run: `pnpm --filter @darts-platform/web exec vitest run src/components/match src/components/tournament`
Run: `pnpm --filter @darts-platform/web test:e2e -- scoreboard` (confirm the header's extra icon button doesn't shift any selector-by-role/position the e2e suite depends on — Playwright specs in this repo select by `aria-label`/text per the conventions seen in `scoreboard.spec.ts`, so an added labeled button should not break existing locators, but verify by actually running it, not by assumption)
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/tournament/command-centre.tsx apps/web/src/components/match/scoreboard-header.tsx
git commit -m "fix(web): link Bedienungsanleitung from the command centre and scoreboard

Help was reachable only once, from the anonymous landing page footer —
absent from every screen a confused first-timer (director or scorer)
would actually need it on."
```

---

## Final Verification (after Task 7)

- [ ] **Full quality gate** (per AGENTS.md §20):

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

All five must be green before opening the PR. Do not skip `test:e2e` — this branch's riskiest changes (Task 1, 2, 3) are all on the live-scoring screen, and `apps/web/tests/scoreboard.spec.ts` is the only end-to-end guard against a silent visual/behavioral regression there.

- [ ] **Re-run the critique's deterministic scan** to confirm the fixes actually land:

```bash
node .claude/skills/impeccable/scripts/detect.mjs --json apps/web/src
```

Expect 0 `gray-on-color` findings among the 7 files Task 2 touched (the pre-existing `scoreboard-sides.tsx:51` false positive and any unrelated pre-existing ignored findings from `.impeccable/config.json` are out of scope and may still appear/not appear independent of this branch).

- [ ] **Push the branch and open the PR against `develop`** (not `main` — this repo's Liga/feature integration convention, see the `develop-integration-branch` memory):

```bash
git push -u origin fix/apps-web-critique-2026-09-09
gh pr create --base develop --title "fix(web): apps/web critique fixes (Oche Rule, token reconciliation, banner order, chunking, help links)" --body "$(cat <<'EOF'
## Problem
`/impeccable critique` on `apps/web` (2026-09-09, archived at `.impeccable/critique/2026-09-09T09-53-06Z__apps-web.md`, score 29/40) found 6 priority issues, most severely a broken Oche Rule (the design system's own turn-indicator rule) on the live scoreboard, and a design-system reconciliation gap on the match-scoring, offline and health-check surfaces that reintroduced a banned third accent hue (amber) and off-token color fills.

## Lösung
- P0: `ScoreboardSides` now sizes the active/inactive remaining score via the `Score` primitive (`display`/`lead`), matching the already-correct pattern in `board-wedge.tsx`.
- P1: raw `bg-emerald-500`/`bg-amber-500` + `text-slate-950` fills across `components/match/*` and `members-route.tsx` reconciled to the Sektorenring filled-pair tokens (`bg-ring-green`/`bg-ring-red` + `text-chalk`); `match-scoreboard.tsx` and `offline/page.tsx` gained `.sektorenring` scoping so the tokens resolve correctly.
- P1: amber "pending/offline" state indicators (offline page, health dashboard, queued-command banner, scoreboard queued-count line) now use `StateTag`'s existing `waiting` tone or this file's own established slate-200 convention — no third hue left.
- P1: version-conflict/error banners in the tournament command centre now render immediately below the header, above the SharePanel/DisplayKeysPanel admin chrome.
- P2: entry-page health panel demoted to a single compact `StateTag` pill instead of a full ops dashboard beside the login form.
- P2: `player-profile.tsx`'s 8 stat tiles and `setup-sheet.tsx`'s 8-field "1 · Turnier" section each split into two labeled subgroups of 4.
- P3: Bedienungsanleitung now linked from the command centre's PageNav and the scoreboard header, not only the anonymous landing page.

## Architektur-Auswirkung
None — every change is a presentation-layer class/markup edit or JSX reorder; no data flow, API, or domain logic touched.

## DB-Migrationen
None.

## Tests
- New: `scoreboard-sides.render.spec.tsx` (Oche Rule size assertion), `health-dashboard.render.spec.tsx` (no raw amber/emerald/rose class survives a render; compact-variant coverage).
- Full gate run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e` (all green — see CI).
- `apps/web/tests/scoreboard.spec.ts` (Playwright) re-verified unchanged pass, since it's the regression guard for the exact screen Tasks 1–3 edit.

## Security-Auswirkungen
None — no auth, tenant-scoping, or authorization path touched.

## Screenshots
Add before/after screenshots of the scoreboard (active/inactive score sizing) and the entry page (health panel) here before requesting review.
EOF
)"
```

Fill in the screenshots placeholder by hand (or with a follow-up browser check) before requesting review — this plan's author has no browser-automation tool available to capture them directly.
