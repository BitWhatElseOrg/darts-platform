"use client";

import { Rule, SheetLabel, StateTag } from "@darts-platform/ui";
import type { TournamentConflict } from "@darts-platform/schemas";

import { clockTime } from "@/lib/tournament-format";

interface DisruptionsPanelProps {
  readonly conflicts: readonly TournamentConflict[];
}

/**
 * Disruptions are the second job of this surface, so they are never hidden
 * behind a modal or a badge: the zone stays on the page and states plainly
 * that there is nothing wrong when there is nothing wrong.
 */
export function DisruptionsPanel({ conflicts }: DisruptionsPanelProps) {
  const blocking = conflicts.filter((conflict) => conflict.severity === "BLOCKING");

  return (
    <section aria-labelledby="disruptions-heading" className="flex flex-col">
      <div className="flex items-baseline justify-between gap-3 pb-2">
        <SheetLabel as="h2" id="disruptions-heading" tone={blocking.length > 0 ? "alarm" : "ink"}>
          Störungen
        </SheetLabel>
        <span className="font-numerals text-[0.875rem] font-bold tabular text-sisal-500">
          {conflicts.length}
        </span>
      </div>
      <Rule tone={blocking.length > 0 ? "ink" : "faint"} />
      {conflicts.length === 0 ? (
        <p className="flex items-center gap-2 py-3">
          <StateTag label="ohne Befund" tone="free" />
        </p>
      ) : (
        <ul>
          {conflicts.map((conflict) => (
            <li className="border-b border-sisal-300 py-2.5" key={conflict.id}>
              <div className="flex items-baseline justify-between gap-3">
                <StateTag
                  label={conflict.severity === "BLOCKING" ? "blockiert" : "Hinweis"}
                  tone={conflict.severity === "BLOCKING" ? "conflict" : "waiting"}
                />
                <span className="font-numerals text-[0.75rem] font-bold tabular text-sisal-400">
                  {clockTime(conflict.detectedAt)}
                </span>
              </div>
              <p className="mt-1 font-plate text-[0.875rem] leading-snug text-wedge-900">
                {conflict.message}
              </p>
              <p className="mt-0.5 font-plate text-[0.75rem] text-sisal-500">{conflict.subject}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
