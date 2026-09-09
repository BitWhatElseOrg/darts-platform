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
 * - `[@media(max-height:44rem)]:min-h-11`: auf einem 640 px hohen Gerät
 *   passten fünf Tastenreihen zu 56 px nicht neben Kopfzeile, Spielerpanels
 *   und Aktionszeile — die Ziffern 7–9 lagen im scrollenden Teil. 44 px ist
 *   die Untergrenze aus AGENTS.md §19 und wird nicht unterschritten.
 * - Kein bares `focus-visible:outline`: `cn()` liest es als Farbutility und
 *   verwirft es, sobald eine Textfarbe folgt. `outline-2` setzt die
 *   Linienart ohnehin mit.
 */
export const keypadKeyClassName =
  "inline-flex min-h-14 items-center justify-center gap-2 [@media(max-height:44rem)]:min-h-11 rounded-lg border border-sisal-400 bg-wedge-900 font-numerals text-title-sm font-semibold tabular text-chalk transition-colors duration-150 hover:enabled:bg-wedge-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green disabled:cursor-not-allowed disabled:opacity-40";
