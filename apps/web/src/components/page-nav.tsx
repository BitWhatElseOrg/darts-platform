import { cn } from "@darts-platform/ui";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Die Seitennavigation am Kopf jeder Arbeitsfläche — «Übersicht», «Zurück»,
 * «Alle Turniere», das Geschwistersurface.
 *
 * Sie lag vorher fünfmal als lokale `navLinkClassName`-Konstante, dreimal als
 * Inline-Literal und in drei weiteren Renditionen im Code: einmal als blosses
 * `underline` in Fliesstextgrösse, einmal als smaragdgrüner Chevron-Link mit
 * einem Unicode-Chevron statt einer gezeichneten Marke, und auf der
 * Turnierliste gar nicht. Genau eine Rendition ist die richtige, also gibt es
 * sie hier genau einmal.
 */

/**
 * Der Link selbst: die gesetzte Versalie der `label`-Stufe, mit der
 * Haarlinie darunter. Drei Dinge, die die handgeschriebenen Kopien nicht
 * hatten und die hier verbindlich sind:
 *
 * - `min-h-11` — ein alleinstehender Link ist ein Bedienziel und hält die
 *   2.75rem aus DESIGN.md und AGENTS.md §19. Eine Zeile 12px hoher Versalien
 *   ist am Tablet im Hallenbetrieb kein Ziel.
 * - der ring-grüne Fokusrahmen — «never removed» gilt auch für Textlinks.
 * - `rounded-lg` — ohne Grund keine sichtbare Wirkung, gibt dem Fokusrahmen
 *   aber den Radius der Steuerelemente statt scharfer Ecken.
 */
const navLinkClassName =
  "inline-flex min-h-11 items-center rounded-lg font-plate text-caption font-semibold tracking-[0.14em] text-sisal-500 uppercase underline decoration-sisal-400 decoration-1 underline-offset-4 transition-colors hover:text-wedge-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green";

export function NavLink({
  children,
  href,
}: {
  readonly children: ReactNode;
  readonly href: string;
}) {
  return (
    <Link className={navLinkClassName} href={href}>
      {children}
    </Link>
  );
}

/**
 * Die Zeile, in der die Links stehen.
 *
 * Das negative `-mt-3` ist Absicht: das Bedienziel ist 2.75rem hoch, die
 * sichtbare Versalienzeile darin knapp 17px. Ohne Ausgleich schöbe das
 * grössere Ziel die Überschrift um rund 27px nach unten. Mit `-mt-3 mb-1`
 * steht die Schrift dort, wo sie vorher stand, und das Ziel ist trotzdem
 * ganze 44px hoch.
 */
export function PageNav({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <nav
      aria-label="Seitennavigation"
      className={cn("-mt-3 mb-1 flex flex-wrap items-center gap-x-5", className)}
    >
      {children}
    </nav>
  );
}
