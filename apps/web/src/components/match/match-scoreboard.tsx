"use client";

import { useEffect, useRef, useState } from "react";
import { type MatchStateResponse } from "@darts-platform/schemas";
import { Button, cn } from "@darts-platform/ui";
import { userFacingErrorMessage } from "@/lib/api-client";
import { ScoreboardHeader } from "./scoreboard-header";
import { ScoreboardSides } from "./scoreboard-sides";
import { ScoreboardStatus } from "./scoreboard-status";
import { useMatchScoring } from "./use-match-scoring";

const inputClassName = "min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-body text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30";

/** Eine Seite kann zwei Personen tragen; ihr Name ist beider Name. */
function sideNames(participant: MatchStateResponse["participants"][number]): string {
  return participant.players.map((person) => person.displayName).join(" und ");
}

function winnerName(match: MatchStateResponse): string {
  const side = match.participants.find((participant) =>
    participant.players.some((person) => person.playerId === match.winnerPlayerId),
  );
  return side === undefined ? "" : sideNames(side);
}
const mutationMessage = (error: unknown) => userFacingErrorMessage(error);

export function MatchScoreboard({ backHref, backLabel, canAbort, canScore, match, organizationId }: {
  readonly backHref: string;
  readonly backLabel: string;
  readonly canAbort: boolean;
  readonly canScore: boolean;
  readonly match: MatchStateResponse;
  readonly organizationId: string;
}) {
  const scoring = useMatchScoring({ organizationId, match, canScore });
  const { lock, queued, online, replaying, mayControl, error } = scoring;
  const [points, setPoints] = useState("");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutDouble, setCheckoutDouble] = useState("");
  const [checkoutDarts, setCheckoutDarts] = useState<1 | 2 | 3>(3);
  const [abortOpen, setAbortOpen] = useState(false);
  const hasPending = queued.length > 0;
  // Der Eingabezustand der Fläche gehört der Komponente, das Wissen um Erfolg
  // oder Misserfolg der Mutation dem Hook. Ohne Callback bleibt der
  // Erfolgszähler die einzige Möglichkeit, „gerade erfolgreich übertragen"
  // von „noch nie versucht" zu unterscheiden — angepasst während des Renders
  // (React-Muster für abgeleiteten Zustand), nicht in einem Effect.
  const [lastSubmitSuccess, setLastSubmitSuccess] = useState(scoring.submitSucceededAt);
  if (lastSubmitSuccess !== scoring.submitSucceededAt) {
    setLastSubmitSuccess(scoring.submitSucceededAt);
    setPoints("");
    setCheckoutOpen(false);
    setCheckoutDouble("");
    setCheckoutDarts(3);
  }
  const [lastAbortSuccess, setLastAbortSuccess] = useState(scoring.abortSucceededAt);
  if (lastAbortSuccess !== scoring.abortSucceededAt) {
    setLastAbortSuccess(scoring.abortSucceededAt);
    setAbortOpen(false);
  }
  // Im Doppel ist `currentPlayerId` die werfende Person, nicht die erste der
  // Seite. Am Oche steht die Seite mit `isActive`.
  const activeParticipant = match.participants.find((participant) => participant.isActive);
  const openCheckoutOrSubmit = () => {
    const visitPoints = Number(points);
    if (activeParticipant !== undefined && visitPoints === activeParticipant.remaining) {
      scoring.resetSubmit();
      setCheckoutDouble("");
      setCheckoutDarts(3);
      setCheckoutOpen(true);
      return;
    }
    scoring.submitVisit({ points: visitPoints, dartsThrown: 3 });
  };
  return (
    <section aria-label="Match-Scoreboard" className="grid h-[100dvh] grid-rows-[auto_auto_auto_1fr] bg-slate-950 text-white">
      <ScoreboardHeader
        backHref={backHref}
        backLabel={backLabel}
        match={match}
        onOpenSettings={() => {
          // Task 14 verdrahtet das Einstellungs-Modal; der Knopf steht schon,
          // damit die Kopfzeile ab Task 11 vollständig ist.
        }}
      />
      <ScoreboardStatus
        lockState={lock.state}
        message={error !== null && !checkoutOpen ? mutationMessage(error) : null}
        online={online}
        onTakeOver={lock.takeOver}
        queuedCount={queued.length}
      />
      <ScoreboardSides match={match} pendingDarts={[]} showDartBand={false} />
      <div className="min-h-0 overflow-y-auto">
        {hasPending ? (
          <div className="border-b border-amber-400/40 bg-amber-300/10 p-4">
            {queued.map((command) => (
              <div className="flex flex-wrap items-center justify-between gap-3 text-body text-amber-100" key={command.commandId}>
                <span>{command.label} · {command.status === "CONFLICT" ? command.error : online ? "Wiederholung läuft" : "Offline"}</span>
                {command.status === "CONFLICT" ? (
                  <Button onClick={() => scoring.discardQueued(command.commandId)} variant="outline">Verwerfen und synchronisieren</Button>
                ) : (
                  <Button disabled={!online || replaying} onClick={() => scoring.replay()} variant="outline">Jetzt übertragen</Button>
                )}
              </div>
            ))}
          </div>
        ) : null}
        {match.status === "COMPLETED" ? (
          <div className="border-b border-emerald-400/30 bg-emerald-400/10 p-5 text-center">
            <p className="text-body uppercase tracking-[0.12em] text-emerald-300">Match beendet</p>
            <p className="mt-1 font-numerals text-title font-bold text-white">{winnerName(match)} gewinnt</p>
          </div>
        ) : canScore ? (
          <form className="grid gap-3 border-b border-slate-800 p-4 sm:grid-cols-[1fr_auto]" onSubmit={(event) => { event.preventDefault(); openCheckoutOrSubmit(); }}>
            <input aria-label="Aufnahmescore" autoFocus className={inputClassName} disabled={!mayControl} inputMode="numeric" min="0" max="180" placeholder="Score" required type="number" value={points} onChange={(event) => setPoints(event.target.value)} />
            <Button disabled={scoring.submitPending || !mayControl || checkoutOpen} type="submit">Erfassen</Button>
          </form>
        ) : null}
        <CheckoutDialog
          darts={checkoutDarts}
          error={checkoutOpen && scoring.submitError !== null ? mutationMessage(scoring.submitError) : null}
          field={checkoutDouble}
          onCancel={() => { scoring.resetSubmit(); setCheckoutOpen(false); }}
          onDartsChange={setCheckoutDarts}
          onFieldChange={setCheckoutDouble}
          onSubmit={() => scoring.submitVisit({ points: Number(points), dartsThrown: checkoutDarts, checkoutDouble: Number(checkoutDouble) })}
          open={checkoutOpen}
          pending={scoring.submitPending}
          points={Number(points)}
        />
        <AbortMatchDialog error={scoring.abortError !== null ? mutationMessage(scoring.abortError) : null} onCancel={() => { scoring.resetAbort(); setAbortOpen(false); }} onSubmit={(reason) => scoring.abortMatch(reason)} open={abortOpen} pending={scoring.abortPending} queuedCount={queued.length} />
        <div className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="font-numerals text-title-sm font-bold text-slate-200">Letzte Aufnahmen</h4>
            <div className="flex flex-wrap gap-2">
              {mayControl && match.visits.some((visit) => !visit.reverted) ? <Button disabled={scoring.undoPending || !online} onClick={() => scoring.undoVisit()} variant="outline">Letzte Aufnahme zurücknehmen</Button> : null}
              {canAbort && match.status === "IN_PROGRESS" ? <Button className="border border-rose-500/60 bg-rose-600 text-white hover:bg-rose-500" disabled={!online || lock.state !== "EIGEN" || scoring.abortPending} onClick={() => { scoring.resetAbort(); setAbortOpen(true); }}>Match abbrechen</Button> : null}
            </div>
          </div>
          <div className="mt-3 space-y-2">{match.visits.slice(0, 8).map((visit) => <div className={cn("flex min-h-11 items-center justify-between rounded-lg bg-slate-900 px-3 text-body", visit.reverted && "opacity-40 line-through")} key={visit.id}><span className="text-slate-300">{visit.playerDisplayName} · {visit.dartsThrown} Darts</span><span className="font-bold text-white">{visit.outcome === "BUST" ? `BUST (${visit.points})` : `${visit.appliedPoints} → ${visit.scoreAfter}`}</span></div>)}</div>
        </div>
      </div>
    </section>
  );
}

function AbortMatchDialog({ error, onCancel, onSubmit, open, pending, queuedCount }: {
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onSubmit: (reason: string) => void;
  readonly open: boolean;
  readonly pending: boolean;
  readonly queuedCount: number;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      setReason("");
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
    return () => { if (dialog.open) dialog.close(); };
  }, [open]);

  if (!open) return null;
  return (
    <dialog aria-describedby="abort-match-description" aria-labelledby="abort-match-title" className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-rose-500/50 bg-slate-950 p-0 text-white shadow-2xl backdrop:bg-slate-950/80" onCancel={(event) => { event.preventDefault(); onCancel(); }} ref={dialogRef}>
      <form className="space-y-5 p-5 sm:p-6" onSubmit={(event) => { event.preventDefault(); onSubmit(reason.trim()); }}>
        <div>
          <h4 className="font-numerals text-title font-bold" id="abort-match-title">Match abbrechen</h4>
          <p className="mt-2 text-body text-slate-300" id="abort-match-description">Alle Aufnahmen und Legs dieses Matches werden unwiderruflich verworfen. {queuedCount} lokal gespeicherte {queuedCount === 1 ? "Aufnahme wird" : "Aufnahmen werden"} verworfen. Das Board wird freigegeben; eine Turnierpaarung wechselt zurück auf READY.</p>
        </div>
        <label className="block space-y-2 text-body font-semibold text-slate-200">
          <span>Abbruchgrund</span>
          <textarea autoFocus className="min-h-24 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-base text-white outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-400/30" maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="z. B. falsche Board-Zuweisung" required value={reason} />
        </label>
        {error ? <p className="text-body text-rose-300" role="alert">{error}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Button disabled={pending} onClick={onCancel} type="button" variant="outline">Zurück zum Match</Button>
          <Button className="bg-rose-600 text-white hover:bg-rose-500" disabled={pending || reason.trim().length < 3} type="submit">Match endgültig abbrechen</Button>
        </div>
      </form>
    </dialog>
  );
}

function CheckoutDialog({
  darts,
  error,
  field,
  onCancel,
  onDartsChange,
  onFieldChange,
  onSubmit,
  open,
  pending,
  points,
}: {
  readonly darts: 1 | 2 | 3;
  readonly error: string | null;
  readonly field: string;
  readonly onCancel: () => void;
  readonly onDartsChange: (darts: 1 | 2 | 3) => void;
  readonly onFieldChange: (field: string) => void;
  readonly onSubmit: () => void;
  readonly open: boolean;
  readonly pending: boolean;
  readonly points: number;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      aria-labelledby="checkout-dialog-title"
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-emerald-400/40 bg-slate-950 p-0 text-white shadow-2xl backdrop:bg-slate-950/80"
      onCancel={(event) => { event.preventDefault(); onCancel(); }}
      ref={dialogRef}
    >
      <form className="space-y-5 p-5 sm:p-6" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <div>
          <h4 className="font-numerals text-title font-bold" id="checkout-dialog-title">Checkout erfassen</h4>
          <p className="mt-2 text-body text-slate-300">{points} Punkte auf 0. Wähle das letzte Doppel und die benötigten Darts.</p>
        </div>
        <label className="block space-y-2 text-body font-semibold text-slate-200">
          <span>Checkout-Feld</span>
          <select autoFocus className={inputClassName} required value={field} onChange={(event) => onFieldChange(event.target.value)}>
            <option value="">Doppel wählen</option>
            {Array.from({ length: 20 }, (_, index) => index + 1).map((double) => <option key={double} value={double}>D{double}</option>)}
            <option value={25}>Bull (Double 25)</option>
          </select>
        </label>
        <label className="block space-y-2 text-body font-semibold text-slate-200">
          <span>Benötigte Darts</span>
          <select className={inputClassName} value={darts} onChange={(event) => onDartsChange(Number(event.target.value) as 1 | 2 | 3)}>
            <option value={1}>1 Dart</option>
            <option value={2}>2 Darts</option>
            <option value={3}>3 Darts</option>
          </select>
        </label>
        {error ? <p className="text-body text-rose-300" role="alert">{error}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Button disabled={pending} onClick={onCancel} type="button" variant="outline">Abbrechen</Button>
          <Button disabled={pending || field === ""} type="submit">Checkout speichern</Button>
        </div>
      </form>
    </dialog>
  );
}
