import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Die Seitennavigation ist genau einmal gestaltet — in `page-nav.tsx`.
 *
 * Vor diesem Test lag sie in sechs Renditionen im Code: fünfmal als lokale
 * `navLinkClassName`-Konstante, dreimal als Inline-Literal, einmal als blosses
 * `underline` in Fliesstextgrösse, einmal als smaragdgrüner Link mit einem
 * Unicode-Chevron als Marke — und auf der Turnierliste gar nicht.
 * Sichtbar wurde das erst im Wechsel zwischen zwei Flächen.
 *
 * Der Test greift die zwei Regressionen, die tatsächlich passiert sind: eine
 * zurückkopierte lokale Klassenkonstante und ein Unicode-Zeichen anstelle
 * einer gezeichneten Marke.
 */

const sourceRoot = fileURLToPath(new URL("..", import.meta.url));

function typescriptSources(directory: string): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...typescriptSources(path));
      continue;
    }
    if (entry.name.endsWith(".tsx")) found.push(path);
  }
  return found;
}

const sources = typescriptSources(sourceRoot).map((path) => ({
  path: path.slice(sourceRoot.length),
  text: readFileSync(path, "utf8"),
}));

describe("Seitennavigation", () => {
  it("findet überhaupt Quelldateien", () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  it("gestaltet den Navigationslink nur in page-nav.tsx", () => {
    const offenders = sources
      .filter((source) => source.text.includes("navLinkClassName"))
      .map((source) => source.path);
    expect(offenders).toEqual(["components/page-nav.tsx"]);
  });

  /**
   * DESIGN.md: Marken werden gezeichnet, nie durch ein Unicode-Zeichen ersetzt.
   *
   * Gesucht ist nur das Zeichen als führende Affordanz eines JSX-Textknotens
   * («› Zurück»), nicht der Pfeil im Fliesstext: «Meier → Huber» in der
   * Auswechslungsliste ist Sprache und bleibt erlaubt.
   */
  it("setzt kein Unicode-Zeichen als Richtungsmarke", () => {
    const leadingGlyph = /(?<=>)\s*[\u2039\u203a\u2190\u2192\u25b8\u25c2]\s/u;
    const offenders = sources
      .filter((source) => leadingGlyph.test(source.text))
      .map((source) => source.path);
    expect(offenders).toEqual([]);
  });
});
