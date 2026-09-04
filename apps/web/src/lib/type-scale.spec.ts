import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { cn } from "@darts-platform/ui";
import { describe, expect, it } from "vitest";

/**
 * Die Typo-Skala lebt in `globals.css`, der Klassen-Merge in `packages/ui`.
 * `tailwind-merge` kennt nur Tailwinds eigene Grössen: eine Stufe, die es
 * nicht kennt, hält es für eine Farb-Utility und verwirft sie, sobald eine
 * Textfarbe folgt. `cn("text-display", "text-chalk")` ergäbe dann nur noch
 * `text-chalk` — die Grösse verschwände lautlos aus jedem Primitive, das
 * Grösse und Ton getrennt setzt, also aus `Score`, `Name`, `SheetLabel`
 * und `Th`.
 *
 * Der Test liest die Stufen aus der CSS-Datei statt sie zu wiederholen: wer
 * der Skala eine Stufe hinzufügt und `packages/ui/src/lib/cn.ts` vergisst,
 * bekommt hier einen roten Test statt eine unsichtbar falsche Schriftgrösse.
 */

const globalsCss = readFileSync(
  fileURLToPath(new URL("../app/globals.css", import.meta.url)),
  "utf8",
);

function declaredTypeSteps(): readonly string[] {
  const steps = new Set<string>();
  for (const match of globalsCss.matchAll(/^\s*--text-([a-z0-9-]+):/gmu)) {
    const name = match[1];
    if (name === undefined) continue;
    // `--text-body--line-height` und `--text-display--letter-spacing` gehören
    // zu ihrer Stufe; eigene Stufen sind sie nicht.
    if (name.includes("--")) continue;
    steps.add(name);
  }
  return [...steps];
}

describe("Typo-Skala", () => {
  const steps = declaredTypeSteps();

  it("findet die Stufen in globals.css", () => {
    expect(steps).toEqual(
      expect.arrayContaining([
        "display",
        "headline",
        "data",
        "title",
        "title-sm",
        "counter",
        "field",
        "body",
        "caption",
        "label",
      ]),
    );
  });

  it.each(steps)("behält text-%s neben einer Textfarbe", (step) => {
    expect(cn(`text-${step}`, "text-white")).toContain(`text-${step}`);
    expect(cn(`font-plate text-${step} font-semibold text-sisal-500`)).toContain(`text-${step}`);
  });

  it("lässt eine Stufe weiterhin von einer späteren Stufe überschreiben", () => {
    expect(cn("text-body", "text-title")).toBe("text-title");
    expect(cn("text-title", "text-title-sm")).toBe("text-title-sm");
  });

  it("mergt echte Textfarben unverändert", () => {
    expect(cn("text-white", "text-slate-400")).toBe("text-slate-400");
  });
});
