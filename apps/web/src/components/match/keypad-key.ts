/**
 * Die gemeinsame Taste beider Keypads. Vorher stand dieselbe Klassenkette
 * zweimal wörtlich in `round-keypad.tsx` und `dart-keypad.tsx` und driftete
 * dort auseinander (drei Fokus-Renditionen, rohe Slate-Werte, keine
 * Zentrierung).
 *
 * Drei Eigenschaften, die die Kette absichtlich trägt:
 *
 * - `inline-flex … items-center justify-center`: Tailwinds Preflight setzt
 *   `svg { display: block }`. Eine gezeichnete Marke ist damit ein
 *   Block-Element und ignoriert `text-align: center` — die Marken klebten am
 *   linken Rand ihrer Taste (bei 820 px mit 240 px Luft rechts daneben).
 * - `border-sisal-400`: die Taste hat keine andere Begrenzung als ihren
 *   Grund, und `bg-wedge-900` (#1e293b) steht nur 1,4:1 über dem
 *   Seitengrund. WCAG 2.2 SC 1.4.11 verlangt 3:1 für die Grenze eines
 *   Bedienelements; das Token liefert 3,8:1 gegen den Panel-Grund
 *   (DESIGN.md, „Repaired").
 * - `min-h-11` ohne Höhen-Breakpoint: 44 px ist die Untergrenze aus
 *   AGENTS.md §19 und zugleich der einzige feste Wert, den die Taste noch
 *   trägt. Darüber wächst sie mit ihrer Gitterzeile (`1fr`), füllt also den
 *   vorhandenen Platz, statt ihn zu fordern. Vorher stand hier `min-h-14`
 *   mit einem Wechsel auf `min-h-11` unterhalb von 44 rem: bei 705 px
 *   Sichthöhe — dem Bereich eines iPhones mit eingeblendeten Safari-Leisten
 *   — sprang die Tastenhöhe damit um 12 px je Reihe nach oben, während der
 *   Viewport nur 1 px gewachsen war. Die Differenz landete im scrollenden
 *   Teil des Keypads, gemessen 16 px im Runden-Modus: genau die Zähltasten
 *   scrollten, mitten im Zählen.
 * - Kein bares `focus-visible:outline`: `cn()` liest es als Farbutility und
 *   verwirft es, sobald eine Textfarbe folgt. `outline-2` setzt die
 *   Linienart ohnehin mit.
 */
export const keypadKeyClassName =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-sisal-400 bg-wedge-900 font-numerals text-title-sm font-semibold tabular text-chalk transition-colors duration-150 hover:enabled:bg-wedge-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Die Tasten der Aktionszeile (Rücktaste, `0`, Absenden, DOUBLE/TRIPLE).
 * Sie stehen ausserhalb der mitwachsenden Tastenfläche in einer Zeile fester
 * Höhe und würden dort auf einem grossen Gerät als einzige bei 44 px stehen
 * bleiben, während die Zähltasten daneben mitwachsen. Ab 44 rem Sichthöhe
 * tragen sie deshalb wieder 56 px — ein Sprung, den sich diese Zeile leisten
 * kann: er kostet die elastische Fläche 12 px, die sie durch Schrumpfen
 * hergibt, statt sie ins Scrollen zu schieben.
 *
 * Die Höhenregel steht zusätzlich einzeln bereit: Komponenten mit eigener
 * Rendition — `BackspaceKey` und ihre rote Undo-Identität — nehmen NUR sie
 * entgegen. Die volle Klasse durchzureichen hat deren rote Farbtoken still
 * überschrieben: `cn()` (tailwind-merge) lässt bei gleichartigen Utilities
 * die spätere Klasse gewinnen, und `className` steht in `BackspaceKey`
 * zuletzt. Die Taste sah dadurch aus wie jede andere, obwohl sie die einzige
 * destruktive Handlung der Fläche trägt.
 */
export const keypadActionKeyHeightClassName = "[@media(min-height:44rem)]:min-h-14";

export const keypadActionKeyClassName =
  `${keypadKeyClassName} ${keypadActionKeyHeightClassName}`;
