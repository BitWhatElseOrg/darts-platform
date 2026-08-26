"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  boardListSchema, boardSchema, matchListSchema, matchStateSchema,
  type MatchStateResponse, type OrganizationSummary, type PlayerResponse,
} from "@darts-platform/schemas";
import { Button, cn } from "@darts-platform/ui";
import { ApiClientError, apiRequest, userFacingErrorMessage } from "@/lib/api-client";
import { listOfflineCommands, markOfflineCommandConflict, removeOfflineCommand, saveOfflineCommand, type OfflineCommand } from "@/lib/offline-command-queue";
import { useBoardControllerLock } from "@/lib/use-board-controller-lock";

const inputClassName = "min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30";
const mutationMessage = (error: unknown) => userFacingErrorMessage(error);

export function MatchWorkspace({ organization, players }: { readonly organization: OrganizationSummary; readonly players: readonly PlayerResponse[] }) {
  const queryClient = useQueryClient();
  const activePlayers = useMemo(() => players.filter((player) => player.status === "ACTIVE"), [players]);
  const [boardName, setBoardName] = useState("");
  const [playerOneId, setPlayerOneId] = useState("");
  const [playerTwoId, setPlayerTwoId] = useState("");
  const [startingPlayerId, setStartingPlayerId] = useState("");
  const [boardId, setBoardId] = useState("");
  const [bestOfLegs, setBestOfLegs] = useState(3);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);

  const resolvedPlayerOneId = activePlayers.some((player) => player.id === playerOneId) ? playerOneId : (activePlayers[0]?.id ?? "");
  const resolvedPlayerTwoId = activePlayers.some((player) => player.id === playerTwoId && player.id !== resolvedPlayerOneId)
    ? playerTwoId
    : (activePlayers.find((player) => player.id !== resolvedPlayerOneId)?.id ?? "");
  const resolvedStartingPlayerId = [resolvedPlayerOneId, resolvedPlayerTwoId].includes(startingPlayerId)
    ? startingPlayerId
    : resolvedPlayerOneId;

  const boardsQuery = useQuery({ queryKey: ["boards", organization.id], queryFn: ({ signal }) => apiRequest({ path: `/organizations/${organization.id}/boards`, schema: boardListSchema, signal }) });
  const matchesQuery = useQuery({ queryKey: ["matches", organization.id], queryFn: ({ signal }) => apiRequest({ path: `/organizations/${organization.id}/matches`, schema: matchListSchema, signal }) });
  const selectedMatch = matchesQuery.data?.find((match) => match.id === selectedMatchId) ?? matchesQuery.data?.[0] ?? null;
  const canCreate = ["OWNER", "ADMIN", "TOURNAMENT_DIRECTOR"].includes(organization.role);
  const canScore = ["OWNER", "ADMIN", "TOURNAMENT_DIRECTOR", "SCORER"].includes(organization.role);

  const createBoard = useMutation({
    mutationFn: () => apiRequest({ path: `/organizations/${organization.id}/boards`, method: "POST", body: { name: boardName }, schema: boardSchema }),
    onSuccess: async (board) => { setBoardName(""); setBoardId(board.id); await queryClient.invalidateQueries({ queryKey: ["boards", organization.id] }); },
  });
  const createMatch = useMutation({
    mutationFn: () => apiRequest({ path: `/organizations/${organization.id}/matches`, method: "POST", body: { playerOneId: resolvedPlayerOneId, playerTwoId: resolvedPlayerTwoId, startingPlayerId: resolvedStartingPlayerId, bestOfLegs, bestOfSets: 1, boardId: boardId || null }, schema: matchStateSchema }),
    onSuccess: async (match) => {
      setSelectedMatchId(match.id);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["matches", organization.id] }), queryClient.invalidateQueries({ queryKey: ["boards", organization.id] })]);
    },
  });

  return (
    <div className="mt-8 space-y-6 border-t border-slate-800 pt-6">
      <div>
        <p className="text-xs font-semibold tracking-[0.18em] text-emerald-300 uppercase">Spielbares Match</p>
        <h3 className="mt-1 text-xl font-semibold text-white">501 · Double Out</h3>
      </div>
      {canCreate ? (
        <div className="grid gap-4 xl:grid-cols-[0.7fr_1.3fr]">
          <form className="rounded-xl border border-slate-800 bg-slate-950/40 p-4" onSubmit={(event) => { event.preventDefault(); createBoard.mutate(); }}>
            <h4 className="text-sm font-semibold text-slate-200">Boards</h4>
            <div className="mt-3 flex gap-2"><input aria-label="Boardname" className={inputClassName} placeholder="Board 1" value={boardName} onChange={(event) => setBoardName(event.target.value)} /><Button disabled={!boardName.trim() || createBoard.isPending} type="submit">Hinzufügen</Button></div>
            <p className="mt-3 text-xs text-slate-400">{boardsQuery.data?.map((board) => `${board.name}: ${board.status === "AVAILABLE" ? "frei" : board.status === "IN_USE" ? "belegt" : "offline"}`).join(" · ") || "Noch kein Board vorhanden."}</p>
          </form>
          <form className="grid gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); createMatch.mutate(); }}>
            <select aria-label="Erster Spieler" className={inputClassName} value={resolvedPlayerOneId} onChange={(event) => { setPlayerOneId(event.target.value); setStartingPlayerId(event.target.value); }}><option value="">Erster Spieler</option>{activePlayers.map((player) => <option key={player.id} value={player.id}>{player.displayName}</option>)}</select>
            <select aria-label="Zweiter Spieler" className={inputClassName} value={resolvedPlayerTwoId} onChange={(event) => setPlayerTwoId(event.target.value)}><option value="">Zweiter Spieler</option>{activePlayers.map((player) => <option key={player.id} value={player.id}>{player.displayName}</option>)}</select>
            <select aria-label="Startspieler" className={inputClassName} value={resolvedStartingPlayerId} onChange={(event) => setStartingPlayerId(event.target.value)}>{activePlayers.filter((player) => [resolvedPlayerOneId, resolvedPlayerTwoId].includes(player.id)).map((player) => <option key={player.id} value={player.id}>{player.displayName} beginnt</option>)}</select>
            <select aria-label="Best of Legs" className={inputClassName} value={bestOfLegs} onChange={(event) => setBestOfLegs(Number(event.target.value))}><option value={1}>Best of 1</option><option value={3}>Best of 3</option><option value={5}>Best of 5</option><option value={7}>Best of 7</option></select>
            <select aria-label="Board" className={inputClassName} value={boardId} onChange={(event) => setBoardId(event.target.value)}><option value="">Kein Board</option>{boardsQuery.data?.filter((board) => board.status === "AVAILABLE").map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}</select>
            <Button disabled={!resolvedPlayerOneId || !resolvedPlayerTwoId || resolvedPlayerOneId === resolvedPlayerTwoId || createMatch.isPending} type="submit">Match starten</Button>
            {createMatch.isError ? <p className="text-sm text-rose-300 sm:col-span-2" role="alert">{mutationMessage(createMatch.error)}</p> : null}
          </form>
        </div>
      ) : null}
      {matchesQuery.data?.length ? (
        <div className="flex gap-2 overflow-x-auto pb-1">{matchesQuery.data.map((match) => <button className={cn("min-h-11 shrink-0 rounded-lg border px-3 text-sm", match.id === selectedMatch?.id ? "border-emerald-400 text-white" : "border-slate-700 text-slate-400")} key={match.id} onClick={() => setSelectedMatchId(match.id)} type="button">{match.participants[0].displayName} – {match.participants[1].displayName}</button>)}</div>
      ) : null}
      {selectedMatch === null ? <p className="rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-400">Erstelle zwei aktive Spieler und starte das erste Match.</p> : <Scoreboard canScore={canScore} match={selectedMatch} organizationId={organization.id} />}
    </div>
  );
}

function Scoreboard({ organizationId, match, canScore }: { readonly organizationId: string; readonly match: MatchStateResponse; readonly canScore: boolean }) {
  const queryClient = useQueryClient();
  const lock = useBoardControllerLock(organizationId, match.id, canScore && match.status === "IN_PROGRESS");
  const [points, setPoints] = useState("");
  const [dartsThrown, setDartsThrown] = useState<1 | 2 | 3>(3);
  const [checkoutDouble, setCheckoutDouble] = useState("");
  const [checkoutAttempts, setCheckoutAttempts] = useState(0);
  const [queued, setQueued] = useState<readonly OfflineCommand[]>([]);
  const [replaying, setReplaying] = useState(false);
  const replayingRef = useRef(false);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const scope = `match:${organizationId}:${match.id}`;
  const refresh = useCallback(async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["matches", organizationId] }), queryClient.invalidateQueries({ queryKey: ["boards", organizationId] })]); }, [organizationId, queryClient]);
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
    mutationFn: async () => {
      const commandId = crypto.randomUUID();
      const path = `/organizations/${organizationId}/matches/${match.id}/visits`;
      const body = { commandId, expectedVersion: match.version, playerId: match.currentPlayerId, points: Number(points), dartsThrown, checkoutDouble: checkoutDouble ? Number(checkoutDouble) : null, checkoutAttempts, controllerId: lock.controllerId };
      if (!navigator.onLine) {
        await saveOfflineCommand({ commandId, scope, path, body, label: `${points} Punkte`, createdAt: new Date().toISOString(), status: "PENDING", error: null });
        await refreshQueue();
        return null;
      }
      try {
        return await apiRequest({ path, method: "POST", body, schema: matchStateSchema });
      } catch (error) {
        if (!(error instanceof ApiClientError)) {
          await saveOfflineCommand({ commandId, scope, path, body, label: `${points} Punkte`, createdAt: new Date().toISOString(), status: "PENDING", error: null });
          await refreshQueue();
          return null;
        }
        throw error;
      }
    },
    onSuccess: async (serverState) => {
      setPoints("");
      setCheckoutDouble("");
      setCheckoutAttempts(0);
      if (serverState !== null) await refresh();
    },
    onError: async (error) => { if (error instanceof ApiClientError && error.code === "MATCH_VERSION_CONFLICT") await refresh(); },
  });
  const undo = useMutation({
    mutationFn: () => apiRequest({ path: `/organizations/${organizationId}/matches/${match.id}/undo`, method: "POST", body: { commandId: crypto.randomUUID(), expectedVersion: match.version, controllerId: lock.controllerId }, schema: matchStateSchema }),
    onSuccess: refresh,
    onError: async (error) => { if (error instanceof ApiClientError && error.code === "MATCH_VERSION_CONFLICT") await refresh(); },
  });
  const error = submit.error ?? undo.error;
  const hasPending = queued.length > 0;
  const mayControl = canScore && match.status === "IN_PROGRESS" && lock.state === "EIGEN" && !hasPending;
  return (
    <section aria-label="Match-Scoreboard" className="overflow-hidden rounded-2xl border border-emerald-400/30 bg-slate-950 shadow-2xl shadow-emerald-950/20">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3 text-xs font-semibold tracking-wider text-slate-400 uppercase"><span>Set {match.currentSetNumber} · Leg {match.currentLegNumber} · Best of {match.bestOfLegs}</span><span>{match.boardName ?? "Nicht zugewiesen"} · v{match.version}</span></div>
      <div className="grid grid-cols-2 divide-x divide-slate-800">
        {match.participants.map((participant) => <div className={cn("p-4 text-center sm:p-7", participant.isActive && match.status === "IN_PROGRESS" ? "bg-emerald-400/10" : "")} key={participant.playerId}><p className="truncate text-sm font-semibold text-slate-300">{participant.displayName}</p><p aria-label={`${participant.displayName}, Restscore`} className="mt-2 text-5xl font-black tabular-nums text-white sm:text-7xl">{participant.remaining}</p><p className="mt-2 text-sm text-slate-400">{participant.legsWonInSet} / {match.legsToWin} Legs · {participant.setsWon} / {match.setsToWin} Sets</p></div>)}
      </div>
      {canScore && match.status === "IN_PROGRESS" ? <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-900 px-4 py-3 text-sm"><span>{lock.state === "EIGEN" ? "Dieses Gerät steuert das Board · Verbindung aktiv" : lock.state === "FREMD" ? "Ein anderes Gerät steuert dieses Board" : "Board-Steuerung wird übernommen …"}</span>{lock.state === "FREMD" ? <Button onClick={lock.takeOver} variant="outline">Steuerung übernehmen</Button> : null}</div> : null}
      {hasPending ? <div className="border-t border-amber-400/40 bg-amber-300/10 p-4" role="status"><p className="font-semibold text-amber-100">{queued.length} Aufnahme wartet dauerhaft gespeichert auf die Übertragung.</p>{queued.map((command) => <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-sm text-amber-100" key={command.commandId}><span>{command.label} · {command.status === "CONFLICT" ? command.error : online ? "Wiederholung läuft" : "Offline"}</span>{command.status === "CONFLICT" ? <Button onClick={() => void removeOfflineCommand(command.commandId).then(refreshQueue).then(refresh)} variant="outline">Verwerfen und synchronisieren</Button> : <Button disabled={!online || replaying} onClick={() => void replay()} variant="outline">Jetzt übertragen</Button>}</div>)}</div> : null}
      {match.status === "COMPLETED" ? <div className="border-t border-emerald-400/30 bg-emerald-400/10 p-5 text-center"><p className="text-sm uppercase tracking-widest text-emerald-300">Match beendet</p><p className="mt-1 text-2xl font-bold text-white">{match.participants.find((player) => player.playerId === match.winnerPlayerId)?.displayName} gewinnt</p></div> : canScore ? (
        <form className="grid gap-3 border-t border-slate-800 p-4 sm:grid-cols-[1fr_0.7fr_0.8fr_0.8fr_auto]" onSubmit={(event) => { event.preventDefault(); submit.mutate(); }}>
          <input aria-label="Aufnahmescore" autoFocus className={inputClassName} disabled={!mayControl} inputMode="numeric" min="0" max="180" placeholder="Score" required type="number" value={points} onChange={(event) => setPoints(event.target.value)} />
          <select aria-label="Geworfene Darts" className={inputClassName} value={dartsThrown} onChange={(event) => setDartsThrown(Number(event.target.value) as 1 | 2 | 3)}><option value={3}>3 Darts</option><option value={2}>2 Darts</option><option value={1}>1 Dart</option></select>
          <input aria-label="Checkout-Double" className={inputClassName} inputMode="numeric" max="25" min="1" placeholder="Double (optional)" type="number" value={checkoutDouble} onChange={(event) => setCheckoutDouble(event.target.value)} />
          <input aria-label="Doppelversuche" className={inputClassName} inputMode="numeric" max={dartsThrown} min="0" placeholder="Doppelversuche" type="number" value={checkoutAttempts} onChange={(event) => setCheckoutAttempts(Number(event.target.value))} />
          <Button disabled={submit.isPending || !mayControl} type="submit">Erfassen</Button>
        </form>
      ) : null}
      <div className="border-t border-slate-800 p-4">
        <div className="flex items-center justify-between"><h4 className="text-sm font-semibold text-slate-200">Letzte Aufnahmen</h4>{mayControl && match.visits.some((visit) => !visit.reverted) ? <Button disabled={undo.isPending || !online} onClick={() => undo.mutate()} variant="outline">Letzte Aufnahme zurücknehmen</Button> : null}</div>
        {error ? <p className="mt-3 text-sm text-rose-300" role="alert">{mutationMessage(error)}</p> : null}
        <div className="mt-3 space-y-2">{match.visits.slice(0, 8).map((visit) => <div className={cn("flex min-h-11 items-center justify-between rounded-lg bg-slate-900 px-3 text-sm", visit.reverted && "opacity-40 line-through")} key={visit.id}><span className="text-slate-300">{visit.playerDisplayName} · {visit.dartsThrown} Darts</span><span className="font-bold text-white">{visit.outcome === "BUST" ? `BUST (${visit.points})` : `${visit.appliedPoints} → ${visit.scoreAfter}`}</span></div>)}</div>
      </div>
    </section>
  );
}
