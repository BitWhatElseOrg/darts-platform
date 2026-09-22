---
name: DartBase - Turnier Plattform
description: The board's own graphic apparatus, painted onto slate and operated as a live tournament surface.
colors:
  slate-950: "#020617"
  slate-900: "#0f172a"
  slate-800: "#1e293b"
  slate-700: "#334155"
  slate-600: "#475569"
  slate-400: "#94a3b8"
  slate-300: "#cbd5e1"
  chalk: "#f8fafc"
  ring-green: "#34d399"
  ring-green-deep: "#6ee7b7"
  ring-green-filled: "#047857"
  ring-green-filled-hover: "#065f46"
  ring-red: "#fb7185"
  ring-red-deep: "#fda4af"
  ring-red-filled: "#be123c"
  ring-red-filled-hover: "#9f1239"
typography:
  display:
    fontFamily: "Saira Condensed, Arial Narrow, sans-serif"
    fontSize: "3.5rem"
    fontWeight: 700
    lineHeight: 0.78
    letterSpacing: "-0.02em"
    fontFeature: "tnum 1"
  headline:
    fontFamily: "Saira Condensed, Arial Narrow, sans-serif"
    fontSize: "2.75rem"
    fontWeight: 700
    lineHeight: 0.9
    letterSpacing: "-0.02em"
  data:
    fontFamily: "Saira Condensed, Arial Narrow, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 0.85
    letterSpacing: "-0.015em"
    fontFeature: "tnum 1"
  title:
    fontFamily: "Saira Condensed, Arial Narrow, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  title-sm:
    fontFamily: "Saira Condensed, Arial Narrow, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.01em"
    fontFeature: "tnum 1"
  counter:
    fontFamily: "Saira Condensed, Arial Narrow, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "normal"
    fontFeature: "tnum 1"
  field:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  caption:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
  label:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.16em"
rounded:
  control: "0.5rem"
  inset: "0.75rem"
  panel: "1rem"
  plate: "9999px"
spacing:
  hair: "0.25rem"
  tight: "0.5rem"
  row: "0.75rem"
  panel: "1rem"
  zone: "1.5rem"
  page: "2.5rem"
components:
  control-go:
    backgroundColor: "{colors.ring-green-filled}"
    textColor: "{colors.chalk}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 1.25rem"
    height: "2.75rem"
  control-go-hover:
    backgroundColor: "{colors.ring-green-filled-hover}"
    textColor: "{colors.chalk}"
  control-plate:
    backgroundColor: "{colors.slate-800}"
    textColor: "{colors.chalk}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 1.25rem"
    height: "2.75rem"
  control-plate-hover:
    backgroundColor: "{colors.slate-700}"
    textColor: "{colors.chalk}"
  control-wire:
    backgroundColor: "transparent"
    textColor: "{colors.chalk}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 1.25rem"
    height: "2.75rem"
  control-wire-hover:
    backgroundColor: "{colors.slate-900}"
    textColor: "{colors.chalk}"
  control-danger:
    backgroundColor: "{colors.ring-red-filled}"
    textColor: "{colors.chalk}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 1.25rem"
    height: "2.75rem"
  control-danger-hover:
    backgroundColor: "{colors.ring-red-filled-hover}"
    textColor: "{colors.chalk}"
  input-text:
    backgroundColor: "{colors.slate-950}"
    textColor: "{colors.chalk}"
    typography: "{typography.field}"
    rounded: "{rounded.control}"
    padding: "0 0.75rem"
    height: "2.75rem"
  wedge-plate:
    backgroundColor: "{colors.slate-900}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.panel}"
    padding: "1rem"
  wedge-ink:
    backgroundColor: "{colors.slate-800}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.panel}"
    padding: "0.875rem 1rem"
  wedge-free:
    backgroundColor: "{colors.slate-900}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.panel}"
    padding: "0.875rem 1rem"
  wedge-blocked:
    backgroundColor: "{colors.slate-800}"
    textColor: "{colors.slate-300}"
    rounded: "{rounded.panel}"
    padding: "0.875rem 1rem"
  wedge-alarm:
    backgroundColor: "{colors.slate-950}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.panel}"
    padding: "1rem"
  plate-playing:
    backgroundColor: "{colors.slate-800}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.plate}"
    size: "2.75rem"
  plate-free:
    backgroundColor: "{colors.ring-green-filled}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.plate}"
    size: "2.75rem"
  plate-blocked:
    backgroundColor: "{colors.slate-800}"
    textColor: "{colors.slate-300}"
    rounded: "{rounded.plate}"
    size: "2.75rem"
---

# Design System: DartBase - Turnier Plattform

## Overview

**Creative North Star: "Der Sektorenring"**

A bristle board is already a precision information graphic: wedges alternating dark and light, a steel spider dividing every sector, stencilled enamel numerals on a fixed ring, and a red/green double ring that has meant *this can end now* for a century. This system takes that apparatus and operates a tournament with it. It is emphatically not a picture of a dartboard — there is no round board on any screen. The board supplies the **grammar**: fields instead of cards, wire instead of borders, ring numerals instead of a UI sans, and the sport's own two signal colours instead of an invented status palette.

The material is slate. An earlier study painted this apparatus onto warm sisal, on the theory that a hall is bright; the product went the other way and unified every surface — entry, organisation, tournament, league — onto one calm dark ground with an emerald signal, so a director moving between the sign-in page and the command centre never changes worlds. The grammar survived the material change intact, and that is the point: the north star was never the colour of the ground, it was the way the board organises information.

Density is high and deliberate. Nineteen encounter slots, two lineups, four doubling panels and a running scoreline coexist on one page. Nothing dims, nothing hides behind a badge, and a monitoring surface may not obscure its own state. What earns the density is that the director is standing in a noisy hall with a tablet, deciding which board to fill next, and every collapsed zone is a question they have to re-open under time pressure.

**Key Characteristics:**
- Slate ground with a single emerald radial glow; raised slate panels, never a second hue
- Two chromatic signals only — the board's red and green — always paired with a drawn mark and a word
- Condensed ring numerals at display scale; the remaining score is the largest thing on the page
- Rounded surfaces (0.5rem controls, 1rem panels) shared with the entry page
- One authored motion: the landing of a match on a board

## Colors

One neutral ramp and the board's two signals. The palette is restrained on purpose: an operating surface earns nothing from a third accent, and reserving red and green for state is what makes them readable at a glance.

### Primary
- **Ring Green** (`#34d399`): the double ring, lit. It means *available or achievable* — a free board, a completed step, a qualifying place, the focus ring on every control. Never decorative.
- **Ring Green Deep** (`#6ee7b7`): the lighter rendition, used where green must sit as text against slate and stay well above 4.5:1.
- **Ring Green Filled** (`#047857`): the same signal as a filled ground under chalk text — the `go` control and the free board plate. Darker than the lit token precisely so white text clears 5:1 on it.

### Secondary
- **Ring Red** (`#fb7185`): the alarm half of the ring pair — a blocked board, a version conflict, a destructive control. Two of eight boards red should read as *the tournament is losing capacity*.
- **Ring Red Deep** (`#fda4af`): red as text on slate — validation errors, alarm captions.
- **Ring Red Filled** (`#be123c`): red as a filled ground under chalk text — the `danger` control.

### Neutral
- **Night Slate** (`#020617`): the page ground and the input well. Everything is painted on this.
- **Panel Slate** (`#0f172a`): the raised plate. Every `Wedge` in `plate` tone.
- **Field Slate** (`#1e293b`): the filled plate control and the ink wedge — the darker field a running match is painted on.
- **Seam Slate** (`#334155` / `#475569`): dividers and panel borders.
- **Steel** (`#94a3b8` caption text, `#cbd5e1` marks on a dark field): the wire. Caption tone clears 6.9:1 on the panel.
- **Chalk** (`#f8fafc`): enamel white. All primary text.

### Named Rules

**The Two Signals Rule.** Only red and green carry state. Anything else on the surface is slate, steel or chalk. A third hue would make the first two stop meaning anything.

**The Never-Only-Colour Rule.** Every coloured state also carries a drawn mark (disc, bar, double ring, hatch, cross, clock) and a word. Colour is the third channel, never the only one. This is binding, not stylistic (AGENTS.md §19).

**The Filled-Pair Rule.** A signal colour has two renditions: the lit token as text or rim on slate, the filled token as a ground under chalk. Putting `ring-green` (`#34d399`) behind white text is a contrast failure, not a style choice.

### Known deviation

One value in `apps/web/src/app/globals.css` does not hold the system up. It is recorded here so the next author does not mistake it for intent:

- `--color-sisal-50` and `--color-sisal-200` are both `#020617`. The input well and the page ground are therefore the same colour, and the raised panel sits only 1.13:1 above the ground. The three-step tonal layering this system describes is currently two steps.

Repaired: `--color-sisal-400` was `#475569`, the only boundary a text field has, at **2.36:1** against the panel — below the 3:1 that WCAG 2.2 SC 1.4.11 requires for a control boundary. It is now `#64748b` (3.8:1 against the panel, 4.2:1 against the ground). The token is only ever a border, rule or underline, never a ground under text.

### Token naming

The Tailwind token names still read `sisal-*`, `wedge-*` and `spider-*` from the earlier light study, while the values are slate. Two consequences to know before editing:

- `text-wedge-900` renders **near-white** (`#f8fafc`), not black. The token inverted when the ground did.
- `bg-wedge-900` is separately forced to `#1e293b` by a rule in `globals.css`, because the same token cannot serve as both body text and a filled control ground. `bg-ring-green` and `bg-ring-red` are overridden the same way.

Read the class name as a *role* (`plate`, `field`, `signal`), never as a colour.

## Typography

**Display Font:** Saira Condensed (with Arial Narrow, sans-serif)
**Body Font:** Archivo (with system-ui, sans-serif)

**Character:** Saira Condensed is the number ring's lettering — squared terminals, condensed width, built to be read across a room. It carries every numeral and every heading. Archivo does the reading work: a workhorse grotesque with true tabular figures that sits under the numerals without competing. Both are self-hosted through `next/font`.

### Hierarchy

Ten steps, and only ten. All ten are in active use. Saira Condensed carries the top six, Archivo the bottom four; `counter` is the hinge where numerals get small enough to sit in a text line.

- **Display** (Saira Condensed 700, 3.5rem, 0.78 line-height, tabular): the remaining score of the player at the oche. Nothing else on any surface uses this size.
- **Headline** (Saira Condensed 700, 2.75rem, 0.9 line-height): the page's one `h1`.
- **Data** (Saira Condensed 700, 2rem, 0.85 line-height, tabular): the opponent's remaining score, an encounter's match total, the large board plate's numeral.
- **Title** (Saira Condensed 700, 1.5rem, 1.1 line-height): names in a list, structure-preview counters, the medium board plate, the empty state's statement.
- **Title-sm** (Saira Condensed 700, 1.125rem, tabular): the quiet score step, group headings, header values.
- **Counter** (Saira Condensed 700, 1rem, tabular): legs won, zone counts, slot sequence numbers — numerals that sit inline with text.
- **Field** (Archivo 600, 0.9375rem, 1.4 line-height): input values, player names, board names. The one step where a name must not shrink.
- **Body** (Archivo 400–600, 0.875rem, 1.5 line-height): prose, reasons, table cells, control labels. Prose measure stays under 70ch.
- **Caption** (Archivo 400–600, 0.75rem, 1.4 line-height): meta lines, state words (uppercase at 0.12em), hints, shortcut keys.
- **Label** (Archivo 600, 0.625rem, uppercase, 0.14–0.16em): sheet captions and table headers — the ruled caption that doubles as a data group's heading.

### Named Rules

**The Oche Rule.** The active player's remaining score is the largest element on the page (3.5rem); the opponent's is set at 2rem in dim steel. The size difference *is* the turn indicator, so it is never softened. This binds every surface that shows a remaining score — the board scorer's own screen and the live wallboard included, not just the director's overview.

**The Tabular Rule.** Any numeral that can sit in a column — score, legs, runtime, points, leg difference — uses tabular figures (`.tabular`). A proportional numeral in a table is a defect.

**The Sixteen-Pixel Rule.** iOS Safari zooms the viewport when a focused control computes below 16px, which strands the board scorer mid-visit. The designed `field` step (0.9375rem) stays on pointer devices; under `@media (pointer: coarse)` every `input`, `select` and `textarea` lifts to `max(1rem, 1em)`. Never set a form control below the field step to buy space.

**The Hall Clock Rule.** A fixture time is entered as local time and must come back as the same local time. Dates and clock times render in `Europe/Zurich`, pinned in `apps/web/src/lib/tournament-format.ts` — never in UTC and never in the device's own zone. `Intl` supplies only the numeric parts; the string and the month names are composed in that module, so a server render and a client render cannot disagree.

**The Hyphenation Rule.** Product language is German, where a compound is routinely longer than the column it is given. Prose carries `prose-de` (`hyphens: auto` plus `overflow-wrap: break-word`); `lang="de"` on `<html>` supplies the pattern. Prose measure is capped at `65ch`. Any `truncate` on a user-supplied name carries `title={…}`, because a clipped name must still be readable.

**The One Voice Per Job Rule.** Saira Condensed for numerals and headings, Archivo for everything read as language. No third face, and no system display face substituted for either.

**The Ten Steps Rule.** The ramp has exactly ten steps and they are the ones above. A size one pixel off an existing step is drift, not a decision: pick the neighbour. There are no literal `text-[…]` sizes left anywhere in `apps/web` or `packages/ui`: every one of the 215 call sites now names its role, and the entry page, scoreboard, live wallboard and workspace shell — which used to run a parallel `text-sm`/`text-3xl` ramp of their own — are on the same ten steps.

### How the ramp is enforced

The ten steps are Tailwind theme tokens in `globals.css`, not literal values: `--text-display` … `--text-label`, each with its `--text-<step>--line-height`. A role is therefore one class — `text-body`, `text-headline` — and its leading travels with it. Because Tailwind emits `line-height: var(--tw-leading, …)`, a deliberate `leading-*` still wins where a surface needs one; nothing in the product currently needs one.

Weight stays explicit at the call site, and so does uppercase tracking where a step is set in its tracked voice: `text-caption` is body prose in one place and a tracked state word in another. The sanctioned added values are `0.1em` (control labels), `0.12em` (caption uppercase) and `0.14em` (table headers). A fourth is drift.

**A step is only as safe as `cn` is.** `tailwind-merge` knows Tailwind's own sizes and nothing else: a step it does not recognise it reads as a colour utility and *drops* as soon as a text colour follows in the same chain. `cn("text-display", "text-chalk")` returned `text-chalk` alone, which silently deleted the size from every primitive that sets size and tone separately — `Score`, `Name`, `SheetLabel`, `Th`. The ten steps are therefore declared to `tailwind-merge` in `packages/ui/src/lib/cn.ts`, and `apps/web/src/lib/type-scale.spec.ts` reads them back out of `globals.css` so an eleventh step cannot be added without teaching `cn` about it.

Repaired: `body` and `.sektorenring` both used to set `font-family: Arial, Helvetica, sans-serif`, overriding the two faces `next/font` loads on every page. Saira Condensed and Archivo were downloaded and rendered nowhere. Both overrides are gone, and Saira's unused 600 weight is no longer requested — 134 KB of fonts down to 108 KB, all of it now on screen.

## Layout

One page, three regions, no collapsing. The container is `max-w-[1600px]` with `1.25rem` gutters, `2.25rem` at `xl`. The command centre splits at `xl` into `minmax(0,1fr) 26rem`: the work list fills the wide column while the side panels stack in the right rail. Detail and setup surfaces sit on a narrower `max-w-[1100px]`.

Rhythm follows a 0.25rem step: `0.25rem` inside a label group, `0.5rem` between rows, `0.75rem` between list items, `1rem` inside a panel, `1.5rem` between zones, `2.5rem` between page regions. More space above a heading than below it.

Responsive behaviour follows the two real devices: the desk (≥1280px, list and rail side by side) and the hall tablet (below 1280px, one column in reading order — work list first, then lineups, doubles, substitutions). Below 768px the same single column holds without horizontal scroll; the surface stays usable rather than pretending to be the board scorer's screen, which is a separate surface.

**Nothing scrolls sideways.** Verified at 1440, 390 and 360 px on every surface, with one measured residue: the command centre with an occupied board overruns by 2px at 360px. Nothing is clipped at that width and 390px is clean, so it is recorded rather than chased. The trap is `flex-1` on a wrapping row: its `flex-basis` is `0`, so `flex-wrap` never fires and the flexible children get crushed to a few pixels while the fixed columns keep their width. A flexible child in a row that must stack carries `basis-full sm:basis-0`, and a fixed `min-w-[…]` is gated behind `sm:`.

### Named Rules

**The No-Collapse Rule.** A zone of a command centre does not dim, collapse or hide behind a count. Density is the feature. The one sanctioned exception is a destructive action (`Nichtantritt werten`, `Begegnung absagen`, `Kampflos werten`), where a disclosure is a deliberate speed bump — and it must still present a ≥44px target.

**The In-View Rule.** Conflicts and failed commands render in the page flow, never in a modal and never as a badge that must be clicked.

## Elevation & Depth

Depth comes from tonal layering plus one shadow. The page is night slate, the panel is one step up, and a filled field is one step up again; a `Wedge` adds a soft ambient shadow so it reads as mounted rather than drawn. There is no second elevation step and no coloured glow on a component — the only glow in the system is the page's own emerald radial wash, which belongs to the ground and not to any element.

### Shadow Vocabulary
- **Mounted panel** (`box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.2)`): every `Wedge` unless `lift` is turned off. Tailwind's `shadow-2xl` at 20% black.
- **Page wash** (`radial-gradient(circle at top, rgb(16 185 129 / 0.12), transparent 36rem)`): on `body` and on `.sektorenring`. Direction, not decoration.

### Named Rules

**The One Shadow Rule.** Panels are mounted, not floating. One ambient shadow, no second step, no zero-offset coloured halo on any component.

## Shapes

Rounded, and consistently so: `0.5rem` for controls, inputs and inline links, `0.75rem` for insets, `1rem` for panels and any bordered plate, and a full circle for the number-ring plate. The four steps are the whole vocabulary.

The ring plate is the one circular form in the system — a slate or green disc carrying a stencilled board numeral at `1.75rem` / `2.75rem` / `3.5rem`. It is `aria-hidden`, because the board's name is always rendered as text beside it and the numeral must never carry information alone.

Borders do the work that separation needs. `1px` for ordinary definition, `2px` reserved for a state that changes what the director should do — a free board's green rim, a blocked board's red rim, an alarm plate. Marks are drawn SVG on a 16px box with `1.5px` strokes and solid fills; there are no icon fonts, no emoji, no unicode glyphs standing in for a mark.

### Named Rules

**The Four Radii Rule.** `0.5rem`, `0.75rem`, `1rem`, `9999px`. A fifth value is drift; pick the neighbour.

**The Two-Pixel Rule.** A `2px` border means *act on this*. Free, blocked and alarm own it; nothing else may borrow it.

## Components

### Buttons (`Control`)
- **Shape:** `0.5rem` radius, `2.75rem` minimum height in **both** densities, `1.25rem` horizontal padding; label is Archivo 600, uppercase, 0.1em.
- **`go`:** filled green under chalk — the action that starts a match. One per slot, never two competing on screen.
- **`plate`:** filled slate under chalk — the ordinary committing action (submit a lineup, accept server state).
- **`wire` / `wireInk`:** 1px outline, transparent ground — reversible and secondary actions; `wireInk` is the same control inside a dark field.
- **`danger`:** filled red under chalk, for destructive or blocking actions.
- **Hover / Focus:** background steps one tone over 150ms; focus is a `2px` ring-green outline at `2px` offset, never removed.
- **Shortcut slot:** a control may carry a `kbd` plate showing the keystroke that does the same thing — the keyboard-first promise made visible.

### Inputs / Fields (`Field`, `TextInput`, `SelectInput`)
- **Style:** night-slate well, 1px seam stroke, `0.5rem` radius, `2.75rem` tall, Archivo 0.9375rem.
- **Focus:** stroke turns ring-green and a `2px` ring-green outline sits `2px` outside the field.
- **Label:** the `SheetLabel` caption above it — a ruled caption on a printed sheet.
- **Error:** ring-red-deep text with a drawn cross, naming the problem *and* the way out ("Eine Begründung ist Pflicht und wird auditiert."). Hint and error carry stable ids (`<id>-hint`, `<id>-error`) for `aria-describedby`.
- **Select:** appearance stripped, with a drawn wire chevron; never a native arrow.

### Containers (`Wedge`)
- **Corner Style:** `1rem`.
- **Tones:** `plate` (raised panel, the default), `ink` (darker field, a running match), `free` (2px green rim), `blocked` (2px red rim plus a diagonal hatch on the plate), `alarm` (night-slate ground with a 2px red rim).
- **Shadow Strategy:** the mounted-panel shadow, on by default (`lift`).
- **Internal Padding:** `0.875rem 1rem` for board wedges, `1rem` for content plates.

### Dividers (`Rule`)
A 1px line, horizontal or vertical, in one of three tones: `ink` (`#475569`), `faint` (`#334155`), `steel` (`#cbd5e1` at 45%, inside a dark field). This is the only divider in the system; there are no boxes drawn to separate content. It is `aria-hidden` by construction.

### Number-Ring Plate (`BoardPlate`)
The signature component. A circular plate carrying a stencilled numeral: slate with a steel ring while playing, filled green when free, slate with a red rim and a hatch when blocked, panel slate with a seam ring when it is a neutral index. Sizes `sm` (1.75rem), `md` (2.75rem), `lg` (3.5rem). Always `aria-hidden`.

### Name (`Name`)
A person, pair or team, wherever one is named: Archivo 600 at the field step (`0.9375rem`). Tones `ink`, `chalk`, `dim`, `quiet`. Active and inactive differ by **tone, never by size** — the field step is the one place a name may not shrink, so a board wedge's inactive participant sits at the same size as the active one and only its colour recedes. Pair it with `title={…}` wherever it can truncate.

### Score (`Score`)
Enamel numerals off the number ring, always `tabular` so columns of scores align. Three sizes — `display` (the remaining score of the player at the oche, the largest thing on the page), `lead`, `quiet` — and four tones (`chalk`, `ink`, `dim`, `finish`). A score is the one figure that may be read from across a hall, so it never shares its size step with anything that is not a score.

### Marks (`MarkDisc`, `MarkBar`, `MarkDoubleRing`, `MarkHatch`, `MarkCross`, `MarkClock`, `MarkFlight`, `MarkCheck`, `MarkChevron`)
The drawn half of the Never-Only-Colour Rule: nine inline SVG marks, each tied to a meaning rather than to a component — disc for free, bar for running, double ring for a finish or a qualifying place, hatch for blocked, cross for an error, clock for waiting, flight for starting, check for done, chevron for a select. They carry no colour of their own; they take the colour of the text they sit in, and they are `aria-hidden` wherever a word already says the same thing.

### State Tag (`StateTag`)
Colour, drawn mark and word in one row — the enforcement mechanism for the Never-Only-Colour Rule. Six tones (`free`, `live`, `finish`, `blocked`, `conflict`, `waiting`), each with its own mark, and an `on` prop (`ink` | `sisal`) that selects the contrast-correct rendition for the ground it sits on.

### Tables (`Table`, `Th`, `Td`, `Tr`)
Modelled on the printed checkout table: hairline rules, tabular figures, no zebra striping, no card wrapper. Headers are 0.625rem uppercase captions at 0.14em. A qualifying row gets a raised ground, a drawn double-ring mark in the position cell and a screen-reader-only "(qualifiziert)" — three channels for one fact.

### Step Ring (`RingSteps`)
Setup progress as ring plates strung on a hairline: a green plate with a drawn check for a completed step, a slate plate with its numeral for the current one, a quiet plate for what is ahead. Step numbers stay because the sequence itself is the information.

### Motion
Two authored animations, both defined in `globals.css` and both silenced under `prefers-reduced-motion`:
- **`land`** (240ms, `cubic-bezier(0.16, 1, 0.3, 1)`): a match landing on a board. Belongs to assignment, result and release.
- **`chalk`** (700ms, same easing): an inset chalk rim fading off a surface that just changed.

## Do's and Don'ts

### Do:
- **Do** pair every coloured state with a drawn mark and a word, on every surface, without exception.
- **Do** use `Score` at `display` (3.5rem) for the active player's remaining score and `lead` (2rem) for the opponent's — the size gap is the turn indicator.
- **Do** put numerals in Saira Condensed with tabular figures, and language in Archivo.
- **Do** reach for `Rule` when content needs separating. A hairline is the answer; a box is not.
- **Do** pick the filled signal token (`#047857`, `#be123c`) whenever a signal sits behind chalk text, and the lit token (`#34d399`, `#fda4af`) whenever it sits on slate.
- **Do** keep every interactive target at `2.75rem` minimum height, including `<summary>` elements and standalone links.
- **Do** show pending commands, failed commands and version conflicts as visible, actionable states in the page flow — and announce them to assistive technology, not only visually.
- **Do** read a `sisal-*` or `wedge-*` class as a role, and check its live value in `globals.css` before assuming a colour.

### Don't:
- **Don't** introduce a third accent hue. Amber, blue and violet have no meaning on a dartboard and would drain red and green of theirs.
- **Don't** invent a fifth radius. The vocabulary is `0.5rem`, `0.75rem`, `1rem`, `9999px`.
- **Don't** render a circular dartboard, a wire spider illustration, or any depiction of the board as ornament. The board is the grammar, not the picture.
- **Don't** dim, collapse or badge-away a zone of a command centre to reduce density; destructive actions are the one sanctioned disclosure.
- **Don't** use a raw Tailwind palette colour (`emerald-500`, `slate-800`) inside a `.sektorenring` surface. Go through the tokens, so one edit moves the whole world.
- **Don't** add a second shadow step or a coloured glow to a component; the emerald wash belongs to the page ground alone.
- **Don't** stack a small uppercase caption above a heading as an eyebrow. `SheetLabel` *is* the heading for a data group.
- **Don't** substitute a unicode glyph or emoji for a drawn mark, and don't mix stroke weights in the mark family (1.5px on a 16px box).
- **Don't** hand-roll a button out of a `<Link>` and utility classes when `Control` exists; that is how the radius vocabulary drifts.
- **Don't** scatter hover animations. The system has two authored motions and they belong to state change, not to decoration.
