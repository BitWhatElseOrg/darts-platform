---
name: Dart Tournament Platform
description: The board's own graphic apparatus, used as an operating surface for a live tournament.
colors:
  sisal-50: "#f6f0de"
  sisal-100: "#ede3c6"
  sisal-200: "#e1d3ae"
  sisal-300: "#cdbc93"
  sisal-400: "#a08e69"
  sisal-500: "#6f6144"
  wedge-900: "#15130f"
  wedge-800: "#221f19"
  wedge-700: "#35301f"
  ring-red: "#b4232a"
  ring-red-deep: "#7c161c"
  ring-red-lit: "#e2646a"
  ring-green: "#1e7443"
  ring-green-deep: "#124327"
  ring-green-lit: "#4cb277"
  spider: "#c9ccc8"
  spider-dim: "#6d716c"
  chalk: "#f9f5e9"
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
  title:
    fontFamily: "Saira Condensed, Arial Narrow, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  data:
    fontFamily: "Saira Condensed, Arial Narrow, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 0.85
    letterSpacing: "-0.015em"
    fontFeature: "tnum 1"
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.16em"
rounded:
  none: "0"
  plate: "9999px"
spacing:
  hair: "0.375rem"
  tight: "0.625rem"
  panel: "1rem"
  zone: "1.75rem"
  page: "2.25rem"
components:
  control-go:
    backgroundColor: "{colors.ring-green}"
    textColor: "{colors.chalk}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0 1.25rem"
    height: "2.75rem"
  control-go-hover:
    backgroundColor: "{colors.ring-green-deep}"
    textColor: "{colors.chalk}"
  control-plate:
    backgroundColor: "{colors.wedge-900}"
    textColor: "{colors.chalk}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0 1.25rem"
    height: "2.75rem"
  control-plate-hover:
    backgroundColor: "{colors.wedge-800}"
    textColor: "{colors.chalk}"
  control-wire:
    backgroundColor: "transparent"
    textColor: "{colors.wedge-900}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0 1.25rem"
    height: "2.75rem"
  control-wire-hover:
    backgroundColor: "{colors.sisal-100}"
    textColor: "{colors.wedge-900}"
  control-danger:
    backgroundColor: "{colors.ring-red}"
    textColor: "{colors.chalk}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0 1.25rem"
    height: "2.75rem"
  input-text:
    backgroundColor: "{colors.sisal-50}"
    textColor: "{colors.wedge-900}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "0 0.75rem"
    height: "2.75rem"
  wedge-live:
    backgroundColor: "{colors.wedge-900}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.none}"
    padding: "0.875rem 1rem"
  wedge-free:
    backgroundColor: "{colors.sisal-100}"
    textColor: "{colors.wedge-900}"
    rounded: "{rounded.none}"
    padding: "0.875rem 1rem"
  wedge-blocked:
    backgroundColor: "{colors.wedge-900}"
    textColor: "{colors.sisal-300}"
    rounded: "{rounded.none}"
    padding: "0.875rem 1rem"
  wedge-plate:
    backgroundColor: "{colors.sisal-100}"
    textColor: "{colors.wedge-900}"
    rounded: "{rounded.none}"
    padding: "1.25rem"
  plate-playing:
    backgroundColor: "{colors.wedge-900}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.plate}"
    size: "2.75rem"
  plate-free:
    backgroundColor: "{colors.ring-green}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.plate}"
    size: "2.75rem"
  plate-blocked:
    backgroundColor: "{colors.wedge-900}"
    textColor: "{colors.sisal-300}"
    rounded: "{rounded.plate}"
    size: "2.75rem"
---

# Design System: Dart Tournament Platform

## Overview

**Creative North Star: "Der Sektorenring"**

A bristle board is already a precision information graphic: sisal wedges alternating black and oat, a steel spider dividing every sector, stencilled enamel numerals on a fixed ring, and a red/green double ring that has meant *this can end now* for a century. This system takes that apparatus and operates a tournament with it. It is emphatically not a picture of a dartboard — there is no round board on any screen. The board supplies the grammar: fields instead of cards, wire instead of borders, enamel numerals instead of a UI sans, and the sport's own two signal colours instead of an invented status palette.

The register is dense and matte. A tournament director reads this surface across a noisy hall under mixed light, so the ground is warm and light (sisal) with black fields carrying the live data — the inverse of the dark dashboard this category ships, and chosen from that scene rather than from taste. Density is high and deliberate: eight boards, a queue, a disruption list and eight group tables coexist without a single collapsible. Nothing dims, nothing hides behind a badge.

The world currently governs the tournament routes (`/turniere`, `/turniere/neu`, `/turniere/[id]`) and the `Sektorenring` primitive set in `packages/ui`. The Phase-0/1 scaffold on `/` still carries the previous dark slate look; it is scoped out by the `.sektorenring` class and will be replaced when that surface is redesigned. Treat the scaffold as an anti-reference, not as a second system.

**Key Characteristics:**
- Warm sisal ground, black wedge fields, no rounded rectangles anywhere
- Two chromatic signals only — the board's red and green — always paired with a drawn mark and a word
- Enamel condensed numerals at display scale; the remaining score is the largest thing on the page
- Hairlines instead of boxes: the spider wire is the only divider
- One authored motion: the landing of a match on a board

## Colors

Neutrals plus the board's two signals. The palette is restrained on purpose: an operating surface earns nothing from a third accent, and reserving red and green for state is what makes them readable at a glance.

### Primary
- **Ring Green** (`#1e7443`): the double ring, filled. It means *available or achievable* — a free board's plate, the primary "start this match" control, a qualifying place, a checkout that is on. Never decorative.
- **Ring Green Deep** (`#124327`): the pressed and hovered state of anything green, and green text on a sisal ground where 4.5:1 is required.
- **Ring Green Lit** (`#4cb277`): the same signal seen against a black wedge. Exists only so green stays above 4.5:1 on `wedge-900`.

### Secondary
- **Ring Red** (`#b4232a`): the alarm half of the ring pair — a blocked board's rim, a destructive control, a blocking conflict. Two of eight boards red should read as *the tournament is losing capacity*.
- **Ring Red Deep** (`#7c161c`): red text and pressed states on sisal.
- **Ring Red Lit** (`#e2646a`): red against a black wedge, contrast-corrected the same way as its green counterpart.

### Neutral
- **Sisal** (`#e1d3ae` base; `#f6f0de` / `#ede3c6` raised, `#cdbc93` seams, `#a08e69` hairlines and captions, `#6f6144` caption text): the fibre ground of the board and the paper of this system. The page ground carries a 58° repeating fibre gradient at 7% — direction, not noise.
- **Wedge Black** (`#15130f` field, `#221f19` hover, `#35301f` field border): warm near-black, never blue-black. It is a painted sector, not a dark theme.
- **Spider Steel** (`#c9ccc8`, dim `#6d716c`): the wire. Every divider inside a black field is this colour at 15–45% opacity.
- **Chalk** (`#f9f5e9`): enamel white. All text and numerals on a black field.

### Named Rules
**The Two Signals Rule.** Only red and green carry state. Anything else on the surface is sisal, wedge black, steel or chalk. A third hue would make the first two stop meaning anything.

**The Never-Only-Colour Rule.** Every coloured state also carries a drawn mark (disc, bar, double ring, hatch, cross, clock) and a word. Colour is the third channel, never the only one. This is binding, not stylistic (AGENTS.md §19).

**The Lit-Pair Rule.** A signal colour has two renditions: the true ring colour on sisal, the lit variant on black. Using the true colour on a black field is a contrast failure, not a style choice.

## Typography

**Display Font:** Saira Condensed (with Arial Narrow, sans-serif)
**Body Font:** Archivo (with system-ui, sans-serif)

**Character:** Saira Condensed is the number ring's lettering — squared terminals, condensed width, built to be read across a room. It carries every numeral and every heading. Archivo does the reading work: a workhorse grotesque with true tabular figures that sits under the numerals without competing. Both are self-hosted through `next/font`.

### Hierarchy
- **Display** (Saira Condensed 700, 3.5rem, 0.78 line-height, -0.02em, tabular): the remaining score of the player at the oche. Nothing else on the page uses this size.
- **Headline** (Saira Condensed 700, 2.75rem, 0.9 line-height, -0.02em): the page's one `h1` — tournament name, "Turniere", "Turnier anlegen".
- **Title** (Saira Condensed 700, 1.125–1.5rem, 1.1 line-height): group headings, tournament names in a list, section totals.
- **Data** (Saira Condensed 700, 2rem / 1.25rem, tabular): the opponent's remaining score, preview counters, leg counts, runtimes.
- **Body** (Archivo 400–600, 0.8125–0.9375rem, 1.5 line-height): names, reasons, prose. Prose measure stays under 70ch.
- **Label** (Archivo 600, 0.625–0.6875rem, uppercase, 0.12–0.16em): zone captions, table headers, state words.

### Named Rules
**The Oche Rule.** The active player's remaining score is the largest element on the page (3.5rem); the opponent's is set at 2rem in dim steel. The size difference *is* the turn indicator, so it is never softened.

**The Tabular Rule.** Any numeral that can sit in a column — score, legs, runtime, points, leg difference — uses tabular figures (`.tabular`). A proportional numeral in a table is a defect.

**The One Voice Per Job Rule.** Saira Condensed for numerals and headings, Archivo for everything read as language. No third face, and no system display face substituted for either.

## Layout

Three fixed zones, one page, no collapsing. At the 1440 desktop anchor the grid is `minmax(0,1fr) 22rem`: boards fill the wide column as a two-across field of wedge panels, while the queue and the disruption list stack in the right rail. The group sheet runs full width below on a 4-column grid (2 columns at `sm`, 1 below). Page container is `max-w-[1600px]` with `1.25rem` gutters, `2.25rem` at `xl`.

Rhythm: `0.375rem` inside a label group, `0.625rem` between rows, `1rem` inside a panel, `1.75rem` between zones, `2.25rem` between page regions. More space above a heading than below it. Board wedges sit on a `1rem` gap so the eight of them read as a wall of plates rather than a list.

Responsive behaviour follows the two real devices: the desk (≥1280px, three zones side by side, keyboard shortcuts advertised on the controls) and the hall tablet (768–1279px, boards two-across with the rail dropping below them). Below 768px the surface degrades to one column in zone order — boards, queue, disruptions, groups — and stays usable rather than pretending to be the board scorer's screen, which is a separate surface.

### Named Rules
**The Three Zones Rule.** Boards, queue, disruptions. All three are on screen at the desk anchor, and none of them dims, collapses or hides behind a count. A monitoring surface may not obscure its own state.

**The Disruption-In-View Rule.** Conflicts render in the first viewport, never in a modal and never as a badge that must be clicked. When there is nothing wrong, the zone says so with a green disc and the word *ohne Befund*.

## Elevation & Depth

Flat by material, with one real mounted shadow. A wedge panel is a plate screwed to a wall: a `1px` sisal-300 seam directly under it plus a soft, offset ambient shadow (`0 10px 20px -14px rgba(21,19,15,0.55)`). That is the only shadow in the system. Depth otherwise comes from tonal layering — sisal-200 ground, sisal-100 raised plate, sisal-50 input well, wedge-900 field — and from the hairline seams between them.

### Shadow Vocabulary
- **Mounted plate** (`box-shadow: 0 1px 0 #cdbc93, 0 10px 20px -14px rgba(21,19,15,0.55)`): every `Wedge` unless `lift` is turned off. Offset and blur are both real; there is no glow.

### Named Rules
**The Mounted-Plate Rule.** Panels are mounted, not floating. One seam, one soft shadow, no second elevation step. A zero-offset coloured halo is decoration and has no place here.

## Shapes

Square corners without exception: a board has no radii, so every panel, control, input, table cell and chip is `0`. The single round form in the system is the number-ring plate (`9999px`) — a black or green disc carrying a stencilled board numeral, sized `1.75rem` / `2.75rem` / `3.5rem`. That contrast is deliberate: the only circles on screen are the ones the board itself would have.

Borders do the work radii would otherwise do. `1px` for ordinary definition (sisal-400 on light, wedge-700 on black, spider at 15–45% inside a field), `2px` reserved for a state that changes what the director should do — a free board's green rim, a blocked board's red rim, an alarm plate. Marks are drawn SVG on a 16px box with `1.5px` strokes and solid fills; there are no icon fonts, no emoji, no unicode glyphs standing in for a mark.

### Named Rules
**The No-Radius Rule.** Radius is `0` everywhere except the number-ring plate. A rounded rectangle in this system is a foreign object.

**The Two-Pixel Rule.** A `2px` border means *act on this*. Free, blocked and alarm own it; nothing else may borrow it.

## Components

### Buttons (`Control`)
- **Shape:** square (0 radius), `2.75rem` min height, `1.25rem` horizontal padding; label is Archivo 600, uppercase, 0.1em.
- **`go`:** ring green on chalk text — the action that starts a match. One per board, never two on screen competing.
- **`plate`:** wedge black on chalk — the ordinary committing action (accept server state, transmit queued commands).
- **`wire` / `wireInk`:** 1px outline, transparent ground — reversible and secondary actions; `wireInk` is the same control inside a black field.
- **`danger`:** ring red on chalk, for destructive or blocking actions.
- **Hover / Focus:** background steps one tone darker over 150ms; focus is a `2px` ring-green outline at `2px` offset, never a removed outline.
- **Shortcut slot:** a control may carry a `kbd` plate showing the keystroke that does the same thing. On the board wedges this is the board's own digit — the keyboard-first promise made visible.

### Inputs / Fields (`Field`, `TextInput`, `SelectInput`)
- **Style:** sisal-50 well, 1px sisal-400 stroke, 0 radius, `2.75rem` tall, Archivo 0.9375rem.
- **Focus:** stroke turns ring-green and a `2px` ring-green outline sits `2px` outside the field.
- **Label:** the `SheetLabel` caption above it, uppercase 0.625rem at 0.16em — a ruled caption on a printed sheet.
- **Error:** ring-red-deep text with a drawn cross, naming the problem *and* the way out ("Jede Gruppe braucht mindestens zwei Teilnehmer. Reduziere die Gruppenzahl."). Hint and error carry stable ids (`<id>-hint`, `<id>-error`) for `aria-describedby`.
- **Select:** appearance stripped, with a drawn wire chevron; never a native arrow.

### Containers (`Wedge`)
- **Corner Style:** square (0).
- **Tones:** `ink` (black field, live match), `free` (sisal-100 with a 2px green rim), `blocked` (black with a 2px red rim plus a diagonal red hatch on the plate), `plate` (sisal-100 mounted panel), `alarm` (sisal-50 with a 2px red rim).
- **Shadow Strategy:** the mounted-plate shadow, on by default (`lift`).
- **Internal Padding:** `0.875rem 1rem` for board wedges, `1.25rem` for content plates.

### Dividers (`Rule`)
- A 1px line, horizontal or vertical, in one of three tones: `ink` (sisal-400) on light, `faint` (sisal-300) between rows, `steel` (spider at 45%) inside a black field. This is the only divider in the system; there are no boxes drawn to separate content.

### Number-Ring Plate (`BoardPlate`)
The signature component. A circular plate carrying a stencilled numeral: black with a steel ring while playing, ring-green filled when free, black with a red rim and a diagonal red hatch when blocked, sisal-100 with a sisal-400 ring when it is a neutral index (setup steps). It is `aria-hidden`: the board's name is always rendered as text beside it, so the numeral never carries information alone.

### State Tag (`StateTag`)
Colour, drawn mark and word in one row — the enforcement mechanism for the Never-Only-Colour Rule. Six tones (`free`, `live`, `finish`, `blocked`, `conflict`, `waiting`), each with its own mark, and an `on` prop (`ink` | `sisal`) that selects the contrast-correct rendition for the ground it sits on.

### Tables (`Table`, `Th`, `Td`, `Tr`)
Modelled on the printed checkout table: hairline rules, tabular figures, no zebra striping, no card wrapper. Headers are 0.625rem uppercase captions at 0.14em in sisal-500. A qualifying row gets a sisal-100 ground, a drawn double-ring mark in the position cell and a screen-reader-only "(qualifiziert)" — three channels for one fact.

### Step Ring (`RingSteps`)
Setup progress as ring plates strung on a hairline: a green plate with a drawn check for a completed step, a black plate with its numeral for the current one, a quiet sisal plate for what is ahead. Step numbers stay because the sequence itself is the information.

## Do's and Don'ts

### Do:
- **Do** pair every coloured state with a drawn mark and a word, on every surface, without exception.
- **Do** use `Score` at `display` (3.5rem) for the active player's remaining score and `lead` (2rem) for the opponent's — the size gap is the turn indicator.
- **Do** put numerals in Saira Condensed with tabular figures, and language in Archivo.
- **Do** reach for `Rule` when content needs separating. A hairline is the answer; a box is not.
- **Do** keep radius at `0` and let the number-ring plate be the only circle.
- **Do** pick the lit signal variant (`ring-green-lit`, `ring-red-lit`) whenever a signal sits on `wedge-900`.
- **Do** show pending commands and version conflicts as visible, actionable states — a queued command listed by name beats a silent retry.
- **Do** advertise the keyboard path on the control that performs it (`shortcut` on `Control`).

### Don't:
- **Don't** introduce a third accent hue. Amber, blue and violet have no meaning on a dartboard and would drain red and green of theirs.
- **Don't** round a corner, anywhere, for any component.
- **Don't** render a circular dartboard, a wire spider illustration, or any depiction of the board as ornament. The board is the grammar, not the picture.
- **Don't** dim, collapse or badge-away a zone of the command centre to reduce density. Density is the feature.
- **Don't** use `emerald`, `slate` or any other Tailwind default palette colour on a `.sektorenring` surface — those belong to the scaffold this world replaces.
- **Don't** add a second shadow step or a coloured glow; there is exactly one mounted-plate shadow.
- **Don't** stack a small uppercase caption above a heading as an eyebrow. `SheetLabel` *is* the heading for a data group.
- **Don't** substitute a unicode glyph or emoji for a drawn mark, and don't mix stroke weights in the mark family (1.5px on a 16px box).
- **Don't** scatter hover animations. The system has one authored motion — the landing — and it belongs to assignment, result and release.
