"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { hasOrganizationPermission, type MatchMode } from "@darts-platform/domain";
import {
  boardListSchema, boardSchema, matchListSchema, matchStateSchema,
  type OrganizationSummary, type PlayerResponse,
} from "@darts-platform/schemas";
import { Button } from "@darts-platform/ui";
import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";
import { bestOfOptions, describeMatchFormat } from "@/lib/match-format";
import { MatchList } from "@/components/match/match-list";

const inputClassName = "min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-body text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30";
const labelClassName = "block text-body font-medium text-slate-300";
const mutationMessage = (error: unknown) => userFacingErrorMessage(error);

export function MatchWorkspace({ organization, players }: { readonly organization: OrganizationSummary; readonly players: readonly PlayerResponse[] }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const activePlayers = useMemo(() => players.filter((player) => player.status === "ACTIVE"), [players]);
  const [boardName, setBoardName] = useState("");
  const [playerOneId, setPlayerOneId] = useState("");
  const [playerTwoId, setPlayerTwoId] = useState("");
  const [boardId, setBoardId] = useState("");
  // Der Modus ist reine Eingabehilfe: gesendet werden weiterhin `bestOfLegs`
  // und `bestOfSets`, und genau ein Satz heisst Matchplay
  // (`matchModeOf` in der Domaene).
  const [mode, setMode] = useState<MatchMode>("MATCHPLAY");
  const [bestOfLegs, setBestOfLegs] = useState(3);
  const [bestOfSets, setBestOfSets] = useState(3);
  const format = { bestOfLegs, bestOfSets: mode === "MATCHPLAY" ? 1 : bestOfSets };

  const resolvedPlayerOneId = activePlayers.some((player) => player.id === playerOneId) ? playerOneId : (activePlayers[0]?.id ?? "");
  const resolvedPlayerTwoId = activePlayers.some((player) => player.id === playerTwoId && player.id !== resolvedPlayerOneId)
    ? playerTwoId
    : (activePlayers.find((player) => player.id !== resolvedPlayerOneId)?.id ?? "");

  const boardsQuery = useQuery({ queryKey: ["boards", organization.id], queryFn: ({ signal }) => apiRequest({ path: `/organizations/${organization.id}/boards`, schema: boardListSchema, signal }) });
  const matchesQuery = useQuery({ queryKey: ["matches", organization.id], queryFn: ({ signal }) => apiRequest({ path: `/organizations/${organization.id}/matches`, schema: matchListSchema, signal }) });
  const canManageBoards = hasOrganizationPermission(organization.role, "board:manage");
  const canCreateMatches = hasOrganizationPermission(organization.role, "match:create");

  const createBoard = useMutation({
    mutationFn: () => apiRequest({ path: `/organizations/${organization.id}/boards`, method: "POST", body: { name: boardName }, schema: boardSchema }),
    onSuccess: async (board) => { setBoardName(""); setBoardId(board.id); await queryClient.invalidateQueries({ queryKey: ["boards", organization.id] }); },
  });
  const createMatch = useMutation({
    mutationFn: () => apiRequest({ path: `/organizations/${organization.id}/matches`, method: "POST", body: { playerOneId: resolvedPlayerOneId, playerTwoId: resolvedPlayerTwoId, bestOfLegs: format.bestOfLegs, bestOfSets: format.bestOfSets, boardId: boardId || null }, schema: matchStateSchema }),
    onSuccess: async (match) => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["matches", organization.id] }), queryClient.invalidateQueries({ queryKey: ["boards", organization.id] })]);
      router.push(`/matches/${match.id}?organisation=${organization.id}`);
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-numerals text-title font-bold text-white">Match starten</h2>
        <p className="mt-1 text-body text-slate-400">501 · Double Out · Anwurf wird ausgebullt</p>
      </div>
      {canManageBoards || canCreateMatches ? (
        <div className="grid gap-4 xl:grid-cols-[0.7fr_1.3fr]">
          {canManageBoards ? (
            <form className="rounded-xl border border-slate-800 bg-slate-950/40 p-4" onSubmit={(event) => { event.preventDefault(); createBoard.mutate(); }}>
              <h3 className="text-body font-semibold text-slate-200">Boards</h3>
              <div className="mt-3 space-y-1.5">
                <label className={labelClassName} htmlFor="board-name">Neues Board</label>
                <div className="flex gap-2"><input id="board-name" className={inputClassName} placeholder="Board 1" value={boardName} onChange={(event) => setBoardName(event.target.value)} /><Button disabled={!boardName.trim() || createBoard.isPending} type="submit">Hinzufügen</Button></div>
              </div>
              {boardsQuery.data?.length ? (
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {boardsQuery.data.map((board) => {
                    const label = board.status === "AVAILABLE" ? "frei" : board.status === "IN_USE" ? "belegt" : "offline";
                    const tone = board.status === "AVAILABLE" ? "text-emerald-300" : board.status === "IN_USE" ? "text-slate-300" : "text-slate-500";
                    return <li className="rounded-md border border-slate-800 px-2 py-1 text-caption text-slate-400" key={board.id}>{board.name} · <span className={tone}>{label}</span></li>;
                  })}
                </ul>
              ) : (
                <p className="mt-3 text-caption text-slate-400">Noch kein Board vorhanden.</p>
              )}
            </form>
          ) : null}
          {canCreateMatches ? (
            <form className="grid gap-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); createMatch.mutate(); }}>
              <div className="space-y-1.5">
                <label className={labelClassName} htmlFor="match-player-one">Spieler 1</label>
                <select id="match-player-one" className={inputClassName} value={resolvedPlayerOneId} onChange={(event) => setPlayerOneId(event.target.value)}><option value="">Spieler wählen</option>{activePlayers.map((player) => <option key={player.id} value={player.id}>{player.displayName}</option>)}</select>
              </div>
              <div className="space-y-1.5">
                <label className={labelClassName} htmlFor="match-player-two">Spieler 2</label>
                <select id="match-player-two" className={inputClassName} value={resolvedPlayerTwoId} onChange={(event) => setPlayerTwoId(event.target.value)}><option value="">Spieler wählen</option>{activePlayers.map((player) => <option key={player.id} value={player.id}>{player.displayName}</option>)}</select>
              </div>
              <fieldset className="space-y-1.5 sm:col-span-2">
                <legend className={labelClassName}>Spielmodus</legend>
                <div className="flex gap-2">
                  {([["MATCHPLAY", "Matchplay"], ["SETS", "Sets"]] as const).map(([value, label]) => (
                    <label
                      className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 text-body transition ${mode === value ? "border-emerald-400 bg-emerald-400/10 text-white" : "border-slate-700 bg-slate-950 text-slate-300"}`}
                      key={value}
                    >
                      <input
                        checked={mode === value}
                        className="size-4 accent-emerald-400"
                        name="match-mode"
                        onChange={() => setMode(value)}
                        type="radio"
                        value={value}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
              {mode === "SETS" ? (
                <div className="space-y-1.5">
                  <label className={labelClassName} htmlFor="match-best-of-sets">Sätze (Best of)</label>
                  <select id="match-best-of-sets" className={inputClassName} value={bestOfSets} onChange={(event) => setBestOfSets(Number(event.target.value))}>{bestOfOptions.map((count) => <option key={count} value={count}>Best of {count}</option>)}</select>
                </div>
              ) : null}
              <div className="space-y-1.5">
                <label className={labelClassName} htmlFor="match-best-of-legs">{mode === "SETS" ? "Legs je Satz (Best of)" : "Legs (Best of)"}</label>
                <select id="match-best-of-legs" className={inputClassName} value={bestOfLegs} onChange={(event) => setBestOfLegs(Number(event.target.value))}>{bestOfOptions.map((count) => <option key={count} value={count}>Best of {count}</option>)}</select>
              </div>
              <p className="text-caption text-slate-400 sm:col-span-2">{describeMatchFormat(format)}</p>
              <div className="space-y-1.5 sm:col-span-2">
                <label className={labelClassName} htmlFor="match-board">Board (optional)</label>
                <select id="match-board" className={inputClassName} value={boardId} onChange={(event) => setBoardId(event.target.value)}><option value="">Kein Board</option>{boardsQuery.data?.filter((board) => board.status === "AVAILABLE").map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}</select>
              </div>
              <Button className="sm:col-span-2" disabled={!resolvedPlayerOneId || !resolvedPlayerTwoId || resolvedPlayerOneId === resolvedPlayerTwoId || createMatch.isPending} type="submit">Match starten</Button>
              {createMatch.isError ? <p className="text-body text-rose-300 sm:col-span-2" role="alert">{mutationMessage(createMatch.error)}</p> : null}
            </form>
          ) : null}
        </div>
      ) : null}
      <div className="space-y-3">
        <h3 className="text-body font-semibold text-slate-200">Matches</h3>
        {matchesQuery.isPending ? (
          <p className="text-body text-slate-400">Matches werden geladen …</p>
        ) : (
          <MatchList limit={30} matches={matchesQuery.data ?? []} organizationId={organization.id} variant="full" />
        )}
      </div>
    </div>
  );
}
