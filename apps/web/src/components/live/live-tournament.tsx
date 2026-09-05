"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { publicTournamentDashboardSchema, type BoardSlot } from "@darts-platform/schemas";
import QRCode from "qrcode";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { apiRequest } from "@/lib/api-client";
import { buildBracketRounds, knockoutLeadsLiveView, type BracketNode, type BracketRound, type BracketSlot } from "@/lib/bracket-tree";
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
  // Ab der K.-o.-Phase steht das Tableau vor den Gruppenranglisten.
  const knockoutFirst = knockoutLeadsLiveView(dashboard.tournament.status);
  const groupsSection = dashboard.groups.length > 0 ? (
    <LiveSection title="Gruppenranglisten">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {dashboard.groups.map((group) => (
          <div className="overflow-hidden rounded-xl border border-slate-800" key={group.groupLabel}>
            <h3 className="bg-slate-900 px-4 py-3 font-numerals text-title-sm font-bold">Gruppe {group.groupLabel}</h3>
            <ol>{group.rows.map((row) => <li className="grid grid-cols-[2rem_1fr_3rem] border-t border-slate-800 px-4 py-2 text-body tabular" key={row.playerId}><span>{row.position}.</span><span>{row.displayName}{row.withdrawn ? " · Ausgefallen" : ""}</span><span className="text-right font-bold">{row.points}</span></li>)}</ol>
          </div>
        ))}
      </div>
    </LiveSection>
  ) : null;
  const bracketSection = dashboard.bracket.length > 0 ? (
    <LiveSection title="K.-o.-Tableau">
      <BracketTree rounds={buildBracketRounds(dashboard.bracket)} />
    </LiveSection>
  ) : null;

  return (
    <main className={`min-h-screen bg-slate-950 text-white ${mode === "tv" ? "p-8 xl:p-12" : "p-4 sm:p-7"}`}>
      <header className="mx-auto flex max-w-[1500px] flex-wrap items-end justify-between gap-4 border-b border-emerald-400/40 pb-5">
        <div>
          <h1 className="font-numerals text-headline font-bold">{dashboard.tournament.name}</h1>
          <p className="mt-2 text-body text-slate-400">{dashboard.tournament.stageLabel} · {dashboard.tournament.playedMatches} von {dashboard.tournament.totalMatches} Matches gespielt</p>
        </div>
        <div className="flex items-center gap-3 text-body">
          <span aria-label={`Live-Verbindung ${connection}`} className={`h-3 w-3 rounded-full ${connection === "verbunden" ? "bg-emerald-400" : "bg-amber-400"}`} />
          <span>{connection === "verbunden" ? "Live verbunden" : "Verbindung wird wiederhergestellt"}</span>
          {mode === "publikum" ? <Link className="rounded border border-slate-600 px-3 py-2" href={`/live/${tournamentId}/tv`}>TV-Modus</Link> : null}
        </div>
      </header>

      <LiveSection title="Boards">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {boards.map((board) => <LiveBoard board={board} key={board.boardId} mode={mode} tournamentId={tournamentId} />)}
        </div>
      </LiveSection>

      {mode !== "board" ? (
        <>
          {knockoutFirst ? <>{bracketSection}{groupsSection}</> : <>{groupsSection}{bracketSection}</>}
          <details className="mx-auto mt-7 max-w-[1500px] overflow-hidden rounded-xl border border-slate-800">
            <summary className="cursor-pointer px-4 py-3 text-caption font-semibold uppercase tracking-[0.12em] text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400">
              Teilnehmende ({dashboard.participants.length})
            </summary>
            <ul className="grid gap-2 border-t border-slate-800 p-4 sm:grid-cols-2 xl:grid-cols-4">
              {dashboard.participants.map((participant) => (
                <li className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-3 text-body" key={participant.playerId}>
                  {participant.displayName}{participant.status === "WITHDRAWN" ? " · Ausgefallen" : ""}
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : null}
    </main>
  );
}

function LiveSection({ children, title }: { readonly children: ReactNode; readonly title: string }) {
  return (
    <section className="mx-auto mt-7 max-w-[1500px]">
      <h2 className="mb-3 text-caption font-semibold uppercase tracking-[0.12em] text-slate-400">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Bis `lg` stehen die Runden untereinander — auf dem Handy soll niemand
 * seitwärts scrollen müssen. Erst ab `lg` werden daraus Spalten, in denen die
 * Folgerunde durch `justify-around` mittig zwischen ihren beiden Zubringern
 * sitzt.
 */
function BracketTree({ rounds }: { readonly rounds: readonly BracketRound[] }) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch lg:gap-4 lg:overflow-x-auto lg:pb-2">
      {rounds.map((round) => (
        <div className="flex flex-col lg:min-w-[13rem] lg:flex-1" key={round.round}>
          <h3 className="mb-3 text-caption font-semibold uppercase tracking-[0.12em] text-emerald-300 lg:text-center">{round.label}</h3>
          <ol className="flex flex-col gap-3 lg:flex-1 lg:justify-around lg:gap-4">
            {round.matches.map((match) => <li key={match.matchId}><BracketCard match={match} /></li>)}
          </ol>
        </div>
      ))}
    </div>
  );
}

function BracketCard({ match }: { readonly match: BracketNode }) {
  return (
    <article className={`rounded-lg border bg-slate-900 p-3 text-body ${match.status === "IN_PROGRESS" ? "border-emerald-400" : "border-slate-800"}`}>
      {match.note !== null ? <p className="mb-2 text-caption uppercase tracking-[0.12em] text-slate-400">{match.note}</p> : null}
      {match.slots.map((slot, index) => <BracketSlotLine key={index} slot={slot} />)}
    </article>
  );
}

function BracketSlotLine({ slot }: { readonly slot: BracketSlot }) {
  const tone = slot.state === "WINNER"
    ? "font-bold text-emerald-300"
    : slot.state === "OPEN"
      ? "italic text-slate-500"
      : slot.state === "LOSER"
        ? "text-slate-400"
        : "text-white";
  return (
    <p className={`flex items-center justify-between gap-2 ${tone}`}>
      <span className="truncate" title={slot.displayName}>{slot.displayName}</span>
      {slot.state === "WINNER" ? <span className="shrink-0"><span aria-hidden="true">&#x2713;</span><span className="sr-only">Sieger</span></span> : null}
    </p>
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
    <div className="flex items-start justify-between gap-4"><div><p className="text-caption font-semibold uppercase tracking-[0.12em] text-emerald-300">{board.boardName}</p><p className="mt-1 text-caption text-slate-400">{board.state === "PLAYING" ? "Match läuft" : board.state === "FREE" ? "Frei" : "Nicht verfügbar"}</p></div>{qrCode !== null ? <Image alt={`QR-Code für ${board.boardName}`} className="h-20 w-20 rounded bg-white p-1" height={80} src={qrCode} unoptimized width={80} /> : null}</div>
    {board.match === null ? <p className="mt-8 font-numerals text-title text-slate-400">Kein aktives Match</p> : <div className="mt-5 grid grid-cols-2 gap-3">{board.match.participants.map((participant) => <div className={participant.isActive ? "rounded-xl bg-emerald-400/10 p-3" : "p-3"} key={participant.playerId}><p className="truncate text-body" title={participant.displayName}>{participant.displayName}</p><p className={participant.isActive ? "mt-2 font-numerals text-display font-bold tabular" : "mt-2 font-numerals text-data font-bold tabular text-slate-400"}>{participant.remaining}</p><p className="mt-1 text-body text-slate-400">{participant.legsWon} Legs · {participant.setsWon} Sets</p></div>)}</div>}
  </article>;
}

function LiveNotice({ text }: { readonly text: string }) {
  return <main className="min-h-screen bg-slate-950 p-8 text-slate-200">{text}</main>;
}
