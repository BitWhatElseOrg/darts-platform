"use client";

import type { ClubDuelDashboard } from "@darts-platform/schemas";
import { cn, MarkCheck, MarkDoubleRing, Table, Td, Th, Tr } from "@darts-platform/ui";
import { useRef, useState } from "react";

import { sideLabel } from "@/lib/club-duel-view";

type View = "overall" | "sideA" | "sideB";

const percent = (rate: number) => `${Math.round(rate * 100)} %`;
/** Erst runden, dann Vorzeichen – sonst entstünde «-0.0». */
const signedOneDecimal = (value: number) => {
  const rounded = Math.round(value * 10) / 10;
  const clean = rounded === 0 ? 0 : rounded;
  return `${clean > 0 ? "+" : ""}${clean.toFixed(1)}`;
};

/**
 * Rangliste Gesamt oder je Verein. Die Ansicht wählt eine Radiogroup nach dem
 * Muster von `InputModeSwitch` (scoreboard-settings-dialog.tsx). Finalrunden-
 * plätze gibt es nur in den Vereinsranglisten; sie tragen Grund, Marke und
 * Screenreader-Text, nie nur Farbe.
 */
export function ClubStandings({ clubDuel }: { readonly clubDuel: ClubDuelDashboard }) {
  const [view, setView] = useState<View>("overall");
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const options: readonly { readonly id: View; readonly label: string }[] = [
    { id: "overall", label: "Gesamt" },
    { id: "sideA", label: clubDuel.sideAName },
    { id: "sideB", label: clubDuel.sideBName },
  ];
  const rows = clubDuel.standings[view];
  const current = options.find((option) => option.id === view) ?? options[0];

  const moveTo = (delta: 1 | -1) => {
    const index = options.findIndex((option) => option.id === view);
    const nextIndex = (index + delta + options.length) % options.length;
    const next = options[nextIndex];
    if (next === undefined) return;
    setView(next.id);
    buttonRefs.current[nextIndex]?.focus();
  };

  return (
    <div className="flex flex-col gap-4">
      <div aria-label="Ranglistenansicht" className="flex flex-wrap gap-2" role="radiogroup">
        {options.map((option, index) => {
          const checked = view === option.id;
          return (
            <button
              aria-checked={checked}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 rounded-lg px-4 font-plate text-body font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green",
                checked ? "bg-ring-green text-chalk" : "bg-sisal-100 text-spider hover:bg-wedge-900",
              )}
              key={option.id}
              onClick={() => setView(option.id)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); moveTo(1); }
                if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); moveTo(-1); }
              }}
              ref={(element) => { buttonRefs.current[index] = element; }}
              role="radio"
              tabIndex={checked ? 0 : -1}
              type="button"
            >
              {checked ? <MarkCheck className="h-3 w-3" /> : null}
              {option.label}
            </button>
          );
        })}
      </div>
      <div className="overflow-x-auto">
        <Table aria-label={`Rangliste ${current?.label ?? ""}`.trim()}>
          <thead>
            <tr>
              <Th>Rang</Th>
              <Th>Name</Th>
              <Th>Verein</Th>
              <Th className="text-right">Spiele</Th>
              <Th className="text-right">Siege</Th>
              <Th className="text-right">Quote</Th>
              <Th className="text-right">Legdiff./Spiel</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const club = sideLabel(clubDuel, row.side);
              // qualified kommt vom Server (club-duel-projection.ts), die UI entscheidet nicht mit.
              const qualified = view !== "overall" && row.qualified;
              return (
                <Tr key={row.playerId} qualified={qualified}>
                  <Td className="pl-0.5">
                    <span className="flex items-center gap-1">
                      {qualified ? <MarkDoubleRing className="text-ring-green" size={10} /> : null}
                      <span className="font-numerals font-bold">{row.position}</span>
                    </span>
                  </Td>
                  <Td>
                    {row.displayName}
                    {row.withdrawn ? <span className="text-sisal-500"> · Ausgefallen</span> : null}
                    {qualified ? <span className="sr-only"> (Finalrunde)</span> : null}
                  </Td>
                  <Td>
                    <abbr aria-hidden="true" className="no-underline" title={club.name}>{club.short}</abbr>
                    <span className="sr-only">{club.name}</span>
                  </Td>
                  <Td className="text-right font-numerals">{row.played}</Td>
                  <Td className="text-right font-numerals">{row.won}</Td>
                  <Td className="text-right font-numerals">{percent(row.winRate)}</Td>
                  <Td className="text-right font-numerals">{signedOneDecimal(row.legDifferencePerMatch)}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </div>
    </div>
  );
}
