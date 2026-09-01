"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  abortMatchResponseSchema, matchStateSchema, type MatchStateResponse,
} from "@darts-platform/schemas";
import { Button, cn } from "@darts-platform/ui";
import { ApiClientError, apiRequest, userFacingErrorMessage } from "@/lib/api-client";
import { generateId } from "@/lib/id";
import { listOfflineCommands, markOfflineCommandConflict, removeOfflineCommand, removeOfflineCommandsForScope, saveOfflineCommand, type OfflineCommand } from "@/lib/offline-command-queue";
import { useBoardControllerLock } from "@/lib/use-board-controller-lock";

const inputClassName = "min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30";
const mutationMessage = (error: unknown) => userFacingErrorMessage(error);

export function MatchScoreboard({ organizationId, match, canAbort, canScore }: { readonly organizationId: string; readonly match: MatchStateResponse; readonly canAbort: boolean; readonly canScore: boolean }) {
  const queryClient = useQueryClient();
  const lock = useBoardControllerLock(organizationId, match.id, canScore && match.status === "IN_PROGRESS");
  const [points, setPoints] = useState("");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutDouble, setCheckoutDouble] = useState("");
  const [checkoutDarts, setCheckoutDarts] = useState<1 | 2 | 3>(3);
  const [abortOpen, setAbortOpen] = useState(false);
  const [queued, setQueued] = useState<readonly OfflineCommand[]>([]);
  const [replaying, setReplaying] = useState(false);
  const replayingRef = useRef(false);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const scope = `match:${organizationId}:${match.id}`;
  const refresh = useCallback(async () => { await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["matches", organizationId] }),
    queryClient.invalidateQueries({ queryKey: ["match", organizationId, match.id] }),
    queryClient.invalidateQueries({ queryKey: ["boards", organizationId] }),
    queryClient.invalidateQueries({ queryKey: ["tournament-dashboard", organizationId] }),
    queryClient.invalidateQueries({ queryKey: ["tournaments", organizationId] }),
  ]); }, [organizationId, queryClient, match.id]);
  const refreshQueue = useCallback(async () => setQueued(await listOfflineCommands(scope)), [scope]);
  useEffect(() => {
    let active = true;
    void listOfflineCommands(scope).then((commands) => { if (active) setQueued(commands); });
    return () => { active = false; };
  }, [scope]);

  const replay = useCallback(async () => {
    if (!navigator.onLine || replayingRef.current) return;
    replayingRef.current = true;
    setReplaying(true);
    const commands = await listOfflineCommands(scope);
    for (const command of commands.filter((candidate) => candidate.status === "PENDING")) {
      try {
        await apiRequest({ path: command.path, method: "POST", body: command.body, schema: matchStateSchema });
        await removeOfflineCommand(command.commandId);
      } catch (error) {
        if (error instanceof ApiClientError && ["MATCH_VERSION_CONFLICT", "BOARD_CONTROLLER_CONFLICT"].includes(error.code)) {
          const message = error.code === "BOARD_CONTROLLER_CONFLICT"
            ? "Ein anderes Gerät steuert dieses Board. Übernimm zuerst die Steuerung."
            : "Der Serverzustand hat sich geändert. Synchronisiere, bevor du weiterzählst.";
          await markOfflineCommandConflict(command, message);
        }
        break;
      }
    }
    await refreshQueue();
    await refresh();
    setReplaying(false);
    replayingRef.current = false;
  }, [scope, refresh, refreshQueue]);

  useEffect(() => {
    const becameOnline = () => { setOnline(true); void replay(); };
    const becameOffline = () => setOnline(false);
    window.addEventListener("online", becameOnline);
    window.addEventListener("offline", becameOffline);
    if (navigator.onLine) void replay();
    return () => { window.removeEventListener("online", becameOnline); window.removeEventListener("offline", becameOffline); };
  }, [replay]);

  const submit = useMutation({
    networkMode: "always",
    mutationFn: async (visit: { readonly points: number; readonly dartsThrown: 1 | 2 | 3; readonly checkoutDouble?: number }) => {
      const commandId = generateId();
      const path = `/organizations/${organizationId}/matches/${match.id}/visits`;
      const body = {
        commandId,
        expectedVersion: match.version,
        playerId: match.currentPlayerId,
        points: visit.points,
        dartsThrown: visit.dartsThrown,
        checkoutDouble: visit.checkoutDouble ?? null,
        checkoutAttempts: visit.checkoutDouble === undefined ? 0 : 1,
        controllerId: lock.controllerId,
      };
      if (!navigator.onLine) {
        await saveOfflineCommand({ commandId, scope, path, body, label: `${visit.points} Punkte`, createdAt: new Date().toISOString(), status: "PENDING", error: null });
        await refreshQueue();
        return null;
      }
      try {
        return await apiRequest({ path, method: "POST", body, schema: matchStateSchema });
      } catch (error) {
        if (!(error instanceof ApiClientError)) {
          await saveOfflineCommand({ commandId, scope, path, body, label: `${visit.points} Punkte`, createdAt: new Date().toISOString(), status: "PENDING", error: null });
          await refreshQueue();
          return null;
        }
        throw error;
      }
    },
    onSuccess: async (serverState) => {
      setPoints("");
      setCheckoutOpen(false);
      setCheckoutDouble("");
      setCheckoutDarts(3);
      if (serverState !== null) await refresh();
    },
    onError: async (error) => { if (error instanceof ApiClientError && error.code === "MATCH_VERSION_CONFLICT") await refresh(); },
  });
  const undo = useMutation({
    mutationFn: () => apiRequest({ path: `/organizations/${organizationId}/matches/${match.id}/undo`, method: "POST", body: { commandId: generateId(), expectedVersion: match.version, controllerId: lock.controllerId }, schema: matchStateSchema }),
    onSuccess: refresh,
    onError: async (error) => { if (error instanceof ApiClientError && error.code === "MATCH_VERSION_CONFLICT") await refresh(); },
  });
  const abort = useMutation({
    mutationFn: (reason: string) => apiRequest({
      path: `/organizations/${organizationId}/matches/${match.id}/abort`,
      method: "POST",
      body: { commandId: generateId(), expectedVersion: match.version, controllerId: lock.controllerId, reason },
      schema: abortMatchResponseSchema,
    }),
    onSuccess: async () => {
      await removeOfflineCommandsForScope(scope);
      setQueued([]);
      setAbortOpen(false);
      await refresh();
    },
    onError: async (abortError) => {
      if (abortError instanceof ApiClientError && abortError.code === "MATCH_VERSION_CONFLICT") await refresh();
    },
  });
  const error = submit.error ?? undo.error ?? abort.error;
  const hasPending = queued.length > 0;
  const mayControl = canScore && match.status === "IN_PROGRESS" && lock.state === "EIGEN" && !hasPending;
  const activeParticipant = match.participants.find((participant) => participant.playerId === match.currentPlayerId);
  const openCheckoutOrSubmit = () => {
    const visitPoints = Number(points);
    if (activeParticipant !== undefined && visitPoints === activeParticipant.remaining) {
      submit.reset();
      setCheckoutDouble("");
      setCheckoutDarts(3);
      setCheckoutOpen(true);
      return;
    }
    submit.mutate({ points: visitPoints, dartsThrown: 3 });
  };
  return (
    <section aria-label="Match-Scoreboard" className="overflow-hidden rounded-2xl border border-emerald-400/30 bg-slate-950 shadow-2xl shadow-emerald-950/20">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3 text-xs font-semibold tracking-wider text-slate-400 uppercase"><span>Set {match.currentSetNumber} · Leg {match.currentLegNumber} · Best of {match.bestOfLegs}</span><span>{match.boardName ?? "Nicht zugewiesen"} · v{match.version}</span></div>
      <div className="grid grid-cols-2 divide-x divide-slate-800">
        {match.participants.map((participant) => (
          <div className={cn("p-4 text-center sm:p-7", participant.isActive && match.status === "IN_PROGRESS" ? "bg-emerald-400/10" : "")} key={participant.playerId}>
            <p className="truncate text-sm font-semibold text-slate-300">{participant.displayName}</p>
            <p aria-label={`${participant.displayName}, Restscore`} className="mt-2 text-5xl font-black tabular-nums text-white sm:text-7xl">{participant.remaining}</p>
            <p className="mt-2 text-sm text-slate-400">{participant.legsWonInSet} / {match.legsToWin} Legs · {participant.setsWon} / {match.setsToWin} Sets</p>
          </div>
        ))}
      </div>
      {canScore && match.status === "IN_PROGRESS" ? <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-900 px-4 py-3 text-sm"><span>{lock.state === "EIGEN" ? "Dieses Gerät steuert das Board · Verbindung aktiv" : lock.state === "FREMD" ? "Ein anderes Gerät steuert dieses Board" : "Board-Steuerung wird übernommen …"}</span>{lock.state === "FREMD" ? <Button onClick={lock.takeOver} variant="outline">Steuerung übernehmen</Button> : null}</div> : null}
      {hasPending ? <div className="border-t border-amber-400/40 bg-amber-300/10 p-4" role="status"><p className="font-semibold text-amber-100">{queued.length} Aufnahme wartet dauerhaft gespeichert auf die Übertragung.</p>{queued.map((command) => <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-sm text-amber-100" key={command.commandId}><span>{command.label} · {command.status === "CONFLICT" ? command.error : online ? "Wiederholung läuft" : "Offline"}</span>{command.status === "CONFLICT" ? <Button onClick={() => void removeOfflineCommand(command.commandId).then(refreshQueue).then(refresh)} variant="outline">Verwerfen und synchronisieren</Button> : <Button disabled={!online || replaying} onClick={() => void replay()} variant="outline">Jetzt übertragen</Button>}</div>)}</div> : null}
      {match.status === "COMPLETED" ? <div className="border-t border-emerald-400/30 bg-emerald-400/10 p-5 text-center"><p className="text-sm uppercase tracking-widest text-emerald-300">Match beendet</p><p className="mt-1 text-2xl font-bold text-white">{match.participants.find((player) => player.playerId === match.winnerPlayerId)?.displayName} gewinnt</p></div> : canScore ? (
        <form className="grid gap-3 border-t border-slate-800 p-4 sm:grid-cols-[1fr_auto]" onSubmit={(event) => { event.preventDefault(); openCheckoutOrSubmit(); }}>
          <input aria-label="Aufnahmescore" autoFocus className={inputClassName} disabled={!mayControl} inputMode="numeric" min="0" max="180" placeholder="Score" required type="number" value={points} onChange={(event) => setPoints(event.target.value)} />
          <Button disabled={submit.isPending || !mayControl || checkoutOpen} type="submit">Erfassen</Button>
        </form>
      ) : null}
      <CheckoutDialog
        darts={checkoutDarts}
        error={checkoutOpen && submit.isError ? mutationMessage(submit.error) : null}
        field={checkoutDouble}
        onCancel={() => { submit.reset(); setCheckoutOpen(false); }}
        onDartsChange={setCheckoutDarts}
        onFieldChange={setCheckoutDouble}
        onSubmit={() => submit.mutate({ points: Number(points), dartsThrown: checkoutDarts, checkoutDouble: Number(checkoutDouble) })}
        open={checkoutOpen}
        pending={submit.isPending}
        points={Number(points)}
      />
      <AbortMatchDialog error={abort.isError ? mutationMessage(abort.error) : null} onCancel={() => { abort.reset(); setAbortOpen(false); }} onSubmit={(reason) => abort.mutate(reason)} open={abortOpen} pending={abort.isPending} queuedCount={queued.length} />
      <div className="border-t border-slate-800 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-slate-200">Letzte Aufnahmen</h4>
          <div className="flex flex-wrap gap-2">
            {mayControl && match.visits.some((visit) => !visit.reverted) ? <Button disabled={undo.isPending || !online} onClick={() => undo.mutate()} variant="outline">Letzte Aufnahme zurücknehmen</Button> : null}
            {canAbort && match.status === "IN_PROGRESS" ? <Button className="border border-rose-500/60 bg-rose-600 text-white hover:bg-rose-500" disabled={!online || lock.state !== "EIGEN" || abort.isPending} onClick={() => { abort.reset(); setAbortOpen(true); }}>Match abbrechen</Button> : null}
          </div>
        </div>
        {error && !checkoutOpen ? <p className="mt-3 text-sm text-rose-300" role="alert">{mutationMessage(error)}</p> : null}
        <div className="mt-3 space-y-2">{match.visits.slice(0, 8).map((visit) => <div className={cn("flex min-h-11 items-center justify-between rounded-lg bg-slate-900 px-3 text-sm", visit.reverted && "opacity-40 line-through")} key={visit.id}><span className="text-slate-300">{visit.playerDisplayName} · {visit.dartsThrown} Darts</span><span className="font-bold text-white">{visit.outcome === "BUST" ? `BUST (${visit.points})` : `${visit.appliedPoints} → ${visit.scoreAfter}`}</span></div>)}</div>
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
          <h4 className="text-xl font-semibold" id="abort-match-title">Match abbrechen</h4>
          <p className="mt-2 text-sm leading-6 text-slate-300" id="abort-match-description">Alle Aufnahmen und Legs dieses Matches werden unwiderruflich verworfen. {queuedCount} lokal gespeicherte {queuedCount === 1 ? "Aufnahme wird" : "Aufnahmen werden"} verworfen. Das Board wird freigegeben; eine Turnierpaarung wechselt zurück auf READY.</p>
        </div>
        <label className="block space-y-2 text-sm font-semibold text-slate-200">
          <span>Abbruchgrund</span>
          <textarea autoFocus className="min-h-24 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-base text-white outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-400/30" maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="z. B. falsche Board-Zuweisung" required value={reason} />
        </label>
        {error ? <p className="text-sm text-rose-300" role="alert">{error}</p> : null}
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
          <h4 className="text-xl font-semibold" id="checkout-dialog-title">Checkout erfassen</h4>
          <p className="mt-2 text-sm text-slate-300">{points} Punkte auf 0. Wähle das letzte Doppel und die benötigten Darts.</p>
        </div>
        <label className="block space-y-2 text-sm font-semibold text-slate-200">
          <span>Checkout-Feld</span>
          <select autoFocus className={inputClassName} required value={field} onChange={(event) => onFieldChange(event.target.value)}>
            <option value="">Doppel wählen</option>
            {Array.from({ length: 20 }, (_, index) => index + 1).map((double) => <option key={double} value={double}>D{double}</option>)}
            <option value={25}>Bull (Double 25)</option>
          </select>
        </label>
        <label className="block space-y-2 text-sm font-semibold text-slate-200">
          <span>Benötigte Darts</span>
          <select className={inputClassName} value={darts} onChange={(event) => onDartsChange(Number(event.target.value) as 1 | 2 | 3)}>
            <option value={1}>1 Dart</option>
            <option value={2}>2 Darts</option>
            <option value={3}>3 Darts</option>
          </select>
        </label>
        {error ? <p className="text-sm text-rose-300" role="alert">{error}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Button disabled={pending} onClick={onCancel} type="button" variant="outline">Abbrechen</Button>
          <Button disabled={pending || field === ""} type="submit">Checkout speichern</Button>
        </div>
      </form>
    </dialog>
  );
}
