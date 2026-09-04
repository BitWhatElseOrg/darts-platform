import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Die zehn Stufen der Typo-Skala aus `globals.css`. `tailwind-merge` kennt nur
 * Tailwinds eigene Grössen; ohne diese Liste hält es `text-display` für eine
 * Farb-Utility und verwirft sie, sobald in derselben Klassenkette eine
 * Textfarbe folgt — `cn("text-display", "text-chalk")` ergäbe dann nur noch
 * `text-chalk`, und die Stufe verschwände lautlos aus jedem Primitive, das
 * Grösse und Ton getrennt setzt.
 *
 * Wer der Skala eine Stufe hinzufügt, trägt sie hier nach.
 */
const TYPE_STEPS = [
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
] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [...TYPE_STEPS] }],
    },
  },
});

export function cn(...inputs: readonly ClassValue[]): string {
  return twMerge(clsx(inputs));
}
