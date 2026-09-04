"use client";

import type { TournamentDashboard } from "@darts-platform/schemas";
import { Control, MarkCross, Rule, SheetLabel, StateTag } from "@darts-platform/ui";
import { useEffect, useMemo, useRef, useState } from "react";

interface ParticipantDisruptionPanelProps {
  readonly participants: TournamentDashboard["participants"];
  readonly canWithdraw: boolean;
  readonly disabled: boolean;
  readonly onWithdraw: (playerId: string, reason: string) => void;
}

export function ParticipantDisruptionPanel({ participants, canWithdraw, disabled, onWithdraw }: ParticipantDisruptionPanelProps) {
  const [open, setOpen] = useState(false);
  const active = useMemo(() => participants.filter((participant) => participant.status === "ACTIVE"), [participants]);
  const withdrawn = useMemo(() => participants.filter((participant) => participant.status === "WITHDRAWN"), [participants]);

  return (
    <section aria-labelledby="participants-heading">
      <div className="flex items-baseline justify-between gap-3 pb-2">
        <SheetLabel as="h2" id="participants-heading">Teilnehmerstatus</SheetLabel>
        <span className="shrink-0 font-numerals text-counter font-bold tabular text-sisal-500">{active.length}/{participants.length}</span>
      </div>
      <Rule />
      {withdrawn.length === 0 ? (
        <p className="py-3 font-plate text-body text-sisal-500">Alle Teilnehmer sind spielbereit.</p>
      ) : (
        <ul className="divide-y divide-sisal-300">
          {withdrawn.map((participant) => (
            <li className="py-3" key={participant.playerId}>
              <p className="font-plate text-body font-semibold text-wedge-900">{participant.displayName} · Ausgefallen</p>
              <div className="mt-1"><StateTag label="Ausgefallen" tone="blocked" /></div>
              {participant.withdrawalReason ? <p className="mt-1 break-words font-plate text-caption text-sisal-500">{participant.withdrawalReason}</p> : null}
            </li>
          ))}
        </ul>
      )}
      {canWithdraw ? <Control className="mt-3 w-full" disabled={disabled || active.length === 0} onClick={() => setOpen(true)} variant="danger">Spielerausfall erfassen</Control> : null}
      <WithdrawalDialog active={active} disabled={disabled} onCancel={() => setOpen(false)} onSubmit={(playerId, reason) => { onWithdraw(playerId, reason); setOpen(false); }} open={open} />
    </section>
  );
}

function WithdrawalDialog({ active, disabled, onCancel, onSubmit, open }: {
  readonly active: TournamentDashboard["participants"];
  readonly disabled: boolean;
  readonly onCancel: () => void;
  readonly onSubmit: (playerId: string, reason: string) => void;
  readonly open: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [playerId, setPlayerId] = useState("");
  const [reason, setReason] = useState("");
  const resolvedPlayerId = active.some((participant) => participant.playerId === playerId) ? playerId : (active[0]?.playerId ?? "");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      setPlayerId("");
      setReason("");
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
    return () => { if (dialog.open) dialog.close(); };
  }, [open]);

  if (!open) return null;
  return (
    <dialog aria-describedby="withdrawal-description" aria-labelledby="withdrawal-title" className="m-auto w-[calc(100%-2rem)] max-w-lg border border-ring-red bg-sisal-50 p-0 text-wedge-900 shadow-[0_1px_0_#cdbc93,0_10px_20px_-14px_rgba(21,19,15,0.55)] backdrop:bg-wedge-900/80" onCancel={(event) => { event.preventDefault(); onCancel(); }} ref={dialogRef}>
      <form className="space-y-5 p-5 sm:p-6" onSubmit={(event) => { event.preventDefault(); onSubmit(resolvedPlayerId, reason.trim()); }}>
        <div className="flex gap-3">
          <MarkCross className="mt-1 shrink-0 text-ring-red" size={18} />
          <div>
            <h3 className="font-numerals text-title font-bold" id="withdrawal-title">Spielerausfall erfassen</h3>
            <p className="mt-2 max-w-[65ch] prose-de font-plate text-body text-sisal-500" id="withdrawal-description">Gespielte Resultate bleiben bestehen. Offene Matches werden kampflos entschieden; ein laufendes Match wird vollständig verworfen.</p>
          </div>
        </div>
        <label className="block space-y-2 font-plate text-body font-semibold">
          <span>Spieler</span>
          <select autoFocus className="min-h-11 w-full border border-sisal-400 bg-sisal-50 px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green" onChange={(event) => setPlayerId(event.target.value)} required value={resolvedPlayerId}>
            {active.map((participant) => <option key={participant.playerId} value={participant.playerId}>{participant.displayName}</option>)}
          </select>
        </label>
        <label className="block space-y-2 font-plate text-body font-semibold">
          <span>Ausfallgrund</span>
          <textarea className="min-h-24 w-full border border-sisal-400 bg-sisal-50 p-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green" maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="z. B. Verletzung oder Krankheit" required value={reason} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Control disabled={disabled} onClick={onCancel} type="button" variant="wire">Zurück</Control>
          <Control disabled={disabled || resolvedPlayerId === "" || reason.trim().length < 3} type="submit" variant="danger">Ausfall bestätigen</Control>
        </div>
      </form>
    </dialog>
  );
}
