"use client";

import { Control, MarkFlight, Rule, SheetLabel, StateTag } from "@darts-platform/ui";
import type { QueueEntry } from "@darts-platform/schemas";

import { readinessLabel } from "@/lib/tournament-format";

interface QueuePanelProps {
  readonly queue: readonly QueueEntry[];
  /** The board a manual assignment would go to, if any is open. */
  readonly openBoardName: string | null;
  readonly onAssign: (matchId: string) => void;
}

export function QueuePanel({ onAssign, openBoardName, queue }: QueuePanelProps) {
  return (
    <section aria-labelledby="queue-heading" className="flex min-h-0 flex-col">
      <div className="flex items-baseline justify-between gap-3 pb-2">
        <SheetLabel as="h2" id="queue-heading">
          Warteschlange
        </SheetLabel>
        <span className="font-numerals text-[1rem] font-bold tabular text-sisal-500">
          {queue.length}
        </span>
      </div>
      <Rule />
      {queue.length === 0 ? (
        <p className="py-4 font-plate text-[0.875rem] text-sisal-500">
          Kein Match wartet. Alles Spielbare ist auf einem Board.
        </p>
      ) : (
        <ol className="min-h-0 flex-1 overflow-y-auto">
          {queue.map((entry) => {
            const ready = entry.readiness === "READY";
            return (
              <li className="border-b border-sisal-300 py-2.5" key={entry.matchId}>
                <div className="flex items-baseline gap-2.5">
                  <span className="w-4 shrink-0 font-numerals text-[1rem] font-bold tabular text-sisal-500">
                    {entry.position}
                  </span>
                  <span className="flex-1 font-plate text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-sisal-500">
                    {entry.stageLabel}
                  </span>
                  <StateTag
                    label={readinessLabel(entry.readiness)}
                    tone={ready ? "free" : entry.readiness === "BLOCKED_NO_BOARD" ? "waiting" : "blocked"}
                  />
                </div>
                <p className="mt-0.5 pl-6.5 font-plate text-[0.875rem] font-semibold text-wedge-900">
                  {entry.participants[0].displayName}
                  <span className="px-1.5 font-normal text-sisal-500">–</span>
                  {entry.participants[1].displayName}
                </p>
                {entry.blockedReason ? (
                  <p className="mt-0.5 pl-6.5 font-plate text-[0.75rem] text-sisal-500">
                    {entry.blockedReason}
                  </p>
                ) : null}
                {ready && openBoardName ? (
                  <Control
                    className="mt-1.5 ml-6.5"
                    density="tight"
                    icon={<MarkFlight size={12} />}
                    onClick={() => onAssign(entry.matchId)}
                    variant="wire"
                  >
                    Auf {openBoardName}
                  </Control>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
