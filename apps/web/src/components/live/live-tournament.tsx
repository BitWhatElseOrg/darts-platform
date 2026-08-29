"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { publicTournamentDashboardSchema, type BoardSlot } from "@darts-platform/schemas";
import QRCode from "qrcode";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { apiRequest } from "@/lib/api-client";
import { connectTournamentRealtime, type RealtimeConnection } from "@/lib/realtime";

interface LiveTournamentProps {
  readonly tournamentId: string;
  readonly mode: "publikum" | "tv" | "board";
  readonly boardId?: string;
}

export function LiveTournament({ tournamentId, mode, boardId }: LiveTournamentProps) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["public-live", tournamentId] as const, [tournamentId]);
  const [connection, setConnection] = useState<RealtimeConnection>("verbindet");
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => apiRequest({
      path: `/public/tournaments/${tournamentId}/live`,
      schema: publicTournamentDashboardSchema,
      signal,
    }),
    refetchInterval: connection === "verbunden" ? false : 5_000,
  });
  useEffect(
    () => connectTournamentRealtime({
      tournamentId,
      onChange: () => void queryClient.invalidateQueries({ queryKey }),
      onConnection: setConnection,
    }),
    [queryClient, queryKey, tournamentId],
  );

  if (query.isPending) return <LiveNotice text="Live-Turnier wird geladen …" />;
  if (query.data === undefined) return <LiveNotice text={query.error?.message ?? "Turnier nicht gefunden."} />;
  const dashboard = query.data;
  const boards = mode === "board"
    ? dashboard.boards.filter((board) => board.boardId === boardId)
    : dashboard.boards;

  return (
    <main className={`min-h-screen bg-slate-950 text-white ${mode === "tv" ? "p-8 xl:p-12" : "p-4 sm:p-7"}`}>
      <header className="mx-auto flex max-w-[1500px] flex-wrap items-end justify-between gap-4 border-b border-emerald-400/40 pb-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">Dart Ost · Live</p>
          <h1 className={mode === "tv" ? "mt-2 text-5xl font-black" : "mt-2 text-3xl font-black"}>{dashboard.tournament.name}</h1>
          <p className="mt-2 text-slate-400">{dashboard.tournament.stageLabel} · {dashboard.tournament.playedMatches} von {dashboard.tournament.totalMatches} Matches gespielt</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span aria-label={`Live-Verbindung ${connection}`} className={`h-3 w-3 rounded-full ${connection === "verbunden" ? "bg-emerald-400" : "bg-amber-400"}`} />
          <span>{connection === "verbunden" ? "Live verbunden" : "Verbindung wird wiederhergestellt"}</span>
          {mode === "publikum" ? <Link className="rounded border border-slate-600 px-3 py-2" href={`/live/${tournamentId}/tv`}>TV-Modus</Link> : null}
        </div>
      </header>

      <div className="mx-auto mt-7 grid max-w-[1500px] gap-7 xl:grid-cols-[1.15fr_0.85fr]">
        <section>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-slate-400">Boards</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {boards.map((board) => <LiveBoard board={board} key={board.boardId} mode={mode} tournamentId={tournamentId} />)}
          </div>
        </section>
        {mode !== "board" ? (
          <div className="space-y-7">
            <section>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-slate-400">Teilnehmende</h2>
              <ul className="grid gap-2 sm:grid-cols-2">
                {dashboard.participants.map((participant) => (
                  <li className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-3 text-sm" key={participant.playerId}>
                    {participant.displayName}{participant.status === "WITHDRAWN" ? " · Ausgefallen" : ""}
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-slate-400">Gruppenranglisten</h2>
              <div className="space-y-4">{dashboard.groups.map((group) => (
                <div className="overflow-hidden rounded-xl border border-slate-800" key={group.groupLabel}>
                  <h3 className="bg-slate-900 px-4 py-3 font-bold">Gruppe {group.groupLabel}</h3>
                  <ol>{group.rows.map((row) => <li className="grid grid-cols-[2rem_1fr_3rem] border-t border-slate-800 px-4 py-2 text-sm" key={row.playerId}><span>{row.position}.</span><span>{row.displayName}{row.withdrawn ? " · Ausgefallen" : ""}</span><span className="text-right font-bold">{row.points}</span></li>)}</ol>
                </div>
              ))}</div>
            </section>
            {dashboard.bracket.length > 0 ? <section>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-slate-400">K.-o.-Tableau</h2>
              <div className="grid gap-3 sm:grid-cols-2">{dashboard.bracket.map((match) => <div className="rounded-lg border border-slate-800 bg-slate-900 p-3 text-sm" key={match.matchId}><p className="text-xs text-slate-500">{match.stageLabel}{match.resultType === "WALKOVER" ? " · Walkover" : match.resultType === "BYE" ? " · Freilos" : ""}</p><p className={match.winnerDisplayName === match.participantNames[0] ? "mt-2 font-bold text-emerald-300" : "mt-2"}>{match.participantNames[0]}</p><p className={match.winnerDisplayName === match.participantNames[1] ? "font-bold text-emerald-300" : ""}>{match.participantNames[1]}</p></div>)}</div>
            </section> : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}

function LiveBoard({ board, mode, tournamentId }: { readonly board: BoardSlot; readonly mode: LiveTournamentProps["mode"]; readonly tournamentId: string }) {
  const [qrCode, setQrCode] = useState<string | null>(null);
  useEffect(() => {
    if (mode !== "publikum") return;
    const url = `${window.location.origin}/live/${tournamentId}/board/${board.boardId}`;
    void QRCode.toDataURL(url, { margin: 1, width: 144 }).then(setQrCode);
  }, [board.boardId, mode, tournamentId]);
  return <article className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
    <div className="flex items-start justify-between gap-4"><div><p className="text-sm font-bold uppercase tracking-wider text-emerald-300">{board.boardName}</p><p className="mt-1 text-xs text-slate-500">{board.state === "PLAYING" ? "Match läuft" : board.state === "FREE" ? "Frei" : "Nicht verfügbar"}</p></div>{qrCode !== null ? <Image alt={`QR-Code für ${board.boardName}`} className="h-20 w-20 rounded bg-white p-1" height={80} src={qrCode} unoptimized width={80} /> : null}</div>
    {board.match === null ? <p className="mt-8 text-xl text-slate-500">Kein aktives Match</p> : <div className="mt-5 grid grid-cols-2 gap-3">{board.match.participants.map((participant) => <div className={participant.isActive ? "rounded-xl bg-emerald-400/10 p-3" : "p-3"} key={participant.playerId}><p className="truncate text-sm">{participant.displayName}</p><p className="mt-2 text-5xl font-black tabular-nums">{participant.remaining}</p><p className="mt-1 text-sm text-slate-400">{participant.legsWon} Legs · {participant.setsWon} Sets</p></div>)}</div>}
  </article>;
}

function LiveNotice({ text }: { readonly text: string }) {
  return <main className="min-h-screen bg-slate-950 p-8 text-slate-200">{text}</main>;
}
