import type { ClubDuelDashboard } from "@darts-platform/schemas";
import { cn, Rule, SheetLabel, Wedge } from "@darts-platform/ui";

import { scoreLine } from "@/lib/club-duel-view";

/**
 * Vereinswertung. Stand, Führung und Legdifferenz stehen immer in Worten und
 * mit vollen Vereinsnamen da – Kürzel können kollidieren (AGENTS.md §19).
 */
export function ClubScoreBanner({ clubDuel, size = "default" }: {
  readonly clubDuel: ClubDuelDashboard;
  readonly size?: "default" | "tv";
}) {
  const { score } = clubDuel;
  const leader = score.leader === "TIED"
    ? "Gleichstand"
    : `${score.leader === "A" ? clubDuel.sideAName : clubDuel.sideBName} führt`;
  const legs = `Legs ${score.legDifferenceA > 0 ? "+" : ""}${score.legDifferenceA}`;
  const tv = size === "tv";
  return (
    <Wedge aria-label="Vereinswertung" aria-live="polite" as="section" className={tv ? "p-8" : "p-4"} tone="plate">
      <SheetLabel as="h2">Vereinswertung</SheetLabel>
      <Rule className="mt-2" tone="faint" />
      <p className={cn("mt-3 font-numerals font-bold tabular text-wedge-900", tv ? "text-display" : "text-title")}>
        {scoreLine(clubDuel)}
      </p>
      <p className={cn("mt-1 font-plate text-sisal-500", tv ? "text-title-sm" : "text-body")}>
        {leader} · <span className="font-numerals tabular">{legs}</span>
      </p>
    </Wedge>
  );
}
