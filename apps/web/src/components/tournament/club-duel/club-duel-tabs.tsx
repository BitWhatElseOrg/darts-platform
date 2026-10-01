"use client";

import { cn } from "@darts-platform/ui";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface ClubDuelTab {
  readonly id: string;
  readonly label: string;
  readonly panel: ReactNode;
}

/**
 * Zugängliche Tabs nach dem WAI-ARIA-Tabs-Muster: Pfeiltasten wechseln Tab
 * und Fokus in einem Schritt, Home/End springen an die Enden. Nur der
 * gewählte Tab liegt in der Tab-Reihenfolge (roving tabindex).
 */
export function ClubDuelTabs({ tabs, initial }: {
  readonly tabs: readonly ClubDuelTab[];
  readonly initial?: string;
}) {
  const [active, setActive] = useState(
    () => tabs.find((tab) => tab.id === initial)?.id ?? tabs[0]?.id ?? "",
  );
  const baseId = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = tabs.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next === null) return;
    event.preventDefault();
    const tab = tabs[next];
    if (tab === undefined) return;
    setActive(tab.id);
    buttons.current[next]?.focus();
  }

  return (
    <div>
      <div aria-label="Ansicht" className="flex flex-wrap gap-2" role="tablist">
        {tabs.map((tab, index) => {
          const selected = tab.id === active;
          return (
            <button
              aria-controls={`${baseId}-${tab.id}-panel`}
              aria-selected={selected}
              className={cn(
                "min-h-11 rounded-lg border px-4 font-plate text-body font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green",
                selected ? "border-ring-green bg-ring-green text-chalk" : "border-sisal-400 bg-sisal-100 text-spider hover:bg-wedge-900",
              )}
              id={`${baseId}-${tab.id}-tab`}
              key={tab.id}
              onClick={() => setActive(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              ref={(element) => { buttons.current[index] = element; }}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          aria-labelledby={`${baseId}-${tab.id}-tab`}
          className="mt-4 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green"
          hidden={tab.id !== active}
          id={`${baseId}-${tab.id}-panel`}
          key={tab.id}
          role="tabpanel"
          tabIndex={0}
        >
          {tab.id === active ? tab.panel : null}
        </div>
      ))}
    </div>
  );
}
