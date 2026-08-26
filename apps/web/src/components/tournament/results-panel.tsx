"use client";

import type { TournamentResult } from "@darts-platform/schemas";
import { Control, Rule, SheetLabel, StateTag } from "@darts-platform/ui";
import { useState } from "react";

interface ResultsPanelProps {
  readonly results: readonly TournamentResult[];
  readonly canCorrect: boolean;
  readonly busy: boolean;
  readonly onCorrect: (matchId: string, reason: string) => void;
}

export function ResultsPanel({ results, canCorrect, busy, onCorrect }: ResultsPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  return (
    <section aria-labelledby="results-heading">
      <div className="flex items-baseline justify-between gap-3 pb-2">
        <SheetLabel as="h2" id="results-heading">Letzte Ergebnisse</SheetLabel>
        <span className="font-numerals text-[1rem] font-bold tabular text-sisal-500">{results.length}</span>
      </div>
      <Rule />
      {results.length === 0 ? (
        <p className="py-4 font-plate text-[0.875rem] text-sisal-500">Noch kein Ergebnis erfasst.</p>
      ) : (
        <ul>
          {results.map((result) => (
            <li className="border-b border-sisal-300 py-3" key={result.matchId}>
              <p className="font-plate text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-sisal-500">{result.stageLabel}</p>
              <p className="mt-1 font-plate text-[0.875rem] font-semibold text-wedge-900">
                {result.participantNames[0]} <span className="px-1 font-normal text-sisal-500">–</span> {result.participantNames[1]}
              </p>
              <p className="mt-1"><StateTag label={`${result.winnerDisplayName} gewinnt`} tone="waiting" /></p>
              {canCorrect && selectedId !== result.matchId ? (
                <Control className="mt-2" density="tight" disabled={busy} onClick={() => {
                  setSelectedId(result.matchId);
                  setReason("");
                }} variant="wire">Ergebnis korrigieren</Control>
              ) : null}
              {canCorrect && selectedId === result.matchId ? (
                <div className="mt-3 flex flex-col gap-2">
                  <label className="font-plate text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-sisal-500" htmlFor={`correction-${result.matchId}`}>Korrekturgrund</label>
                  <textarea
                    className="min-h-20 border border-sisal-400 bg-sisal-50 p-3 font-plate text-[0.875rem] text-wedge-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green"
                    id={`correction-${result.matchId}`}
                    maxLength={500}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="z. B. Aufnahme falsch erfasst"
                    value={reason}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Control density="tight" disabled={busy || reason.trim().length < 3} onClick={() => onCorrect(result.matchId, reason.trim())} variant="plate">Match wieder öffnen</Control>
                    <Control density="tight" disabled={busy} onClick={() => setSelectedId(null)} variant="wire">Abbrechen</Control>
                  </div>
                  <p className="font-plate text-[0.75rem] leading-relaxed text-sisal-500">Der letzte entscheidende Visit wird auditiert zurückgenommen. Gestartete Folgematches blockieren die Korrektur.</p>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
