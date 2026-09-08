"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { publicTournamentDashboardSchema, type PublicBoardSlot } from "@darts-platform/schemas";
import QRCode from "qrcode";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { apiRequest } from "@/lib/api-client";
import { ApiClientError } from "@/lib/api-error";
import { buildBracketRounds, knockoutLeadsLiveView, type BracketNode, type BracketRound, type BracketSlot } from "@/lib/bracket-tree";
import { recallDisplayKey, rememberDisplayKey } from "@/lib/display-key-storage";
import { resolvePublicId } from "@/lib/live-address";
import { connectTournamentRealtime, type RealtimeConnection } from "@/lib/realtime";

interface LiveTournamentProps {
  readonly publicId: string;
  readonly mode: "publikum" | "tv" | "board";
  readonly boardId?: string;
  /**
   * Der Anzeige-Schluessel aus der Adresse (`?k=`), von der Server-Seite
   * gelesen (Task 6, Board- und TV-Seite). Nur beim allerersten Aufruf mit
   * dieser Adresse gesetzt: die Komponente merkt ihn sich dann im Browser
   * (`rememberDisplayKey`) und entfernt ihn wieder aus der Adresszeile --
   * ein Lesezeichen oder ein weitergereichter Verlauf soll den Klartext
   * nicht dauerhaft mitschleppen. Fehlt er (z. B. bei einem spaeteren
   * Neuladen), fragt die Komponente stattdessen `recallDisplayKey` nach dem
   * zuvor gemerkten Schluessel.
   */
  readonly displayKeySecret?: string | null;
}

/**
 * Zielseite fuer denselben Modus, aber mit der aufgeloesten `publicId` an der
 * Stelle, an der `publicId` heute steht (Befund B, Folgereview
 * oeffentliche-turnier-ids).
 */
function legacyRedirectTarget(
  mode: LiveTournamentProps["mode"],
  boardId: string | undefined,
  resolvedPublicId: string,
): string {
  if (mode === "tv") return `/live/${resolvedPublicId}/tv`;
  if (mode === "board") return `/live/${resolvedPublicId}/board/${boardId ?? ""}`;
  return `/live/${resolvedPublicId}`;
}

export function LiveTournament({ boardId, displayKeySecret, mode, publicId }: LiveTournamentProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Nur beim allerersten Client-Mount ausgewertet (Lazy-Initializer): kommt
  // ein frischer Schluessel ueber die Adresse, wird er sofort gemerkt und ist
  // ab hier der geltende Wert fuer diese Sitzung. Sonst zaehlt, was fuer
  // dieses Turnier zuvor schon gemerkt wurde -- so uebersteht ein Neuladen
  // ohne `?k=` in der Adresse (Task 6, Step 4).
  const [secret] = useState<string | null>(() => {
    if (typeof window === "undefined") return displayKeySecret ?? null;
    if (displayKeySecret) {
      rememberDisplayKey(publicId, displayKeySecret);
      return displayKeySecret;
    }
    return recallDisplayKey(publicId);
  });

  // Der Klartext soll nicht dauerhaft in der Adresse stehen -- ein
  // Lesezeichen oder ein weitergereichter Link braucht ihn nicht mehr, sobald
  // er im Browser gemerkt ist. `router.replace` statt `push`: kein zweiter
  // Verlaufseintrag fuer denselben Aufruf.
  useEffect(() => {
    if (!displayKeySecret || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("k");
    router.replace(`${url.pathname}${url.search}`);
    // Nur beim Mount mit einem frischen Schluessel in der Adresse -- ein
    // spaeterer Rerender (etwa nach genau dieser Umleitung) soll nicht
    // erneut ausloesen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [connection, setConnection] = useState<RealtimeConnection>("verbindet");
  const queryKey = useMemo(() => ["public-live", publicId] as const, [publicId]);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => apiRequest({
      path: `/public/tournaments/${publicId}/live${secret === null ? "" : `?k=${encodeURIComponent(secret)}`}`,
      schema: publicTournamentDashboardSchema,
      signal,
    }),
    // Polling nur, solange die Echtzeitverbindung fehlt.
    refetchInterval: connection === "verbunden" ? false : 5_000,
  });

  useEffect(
    () => connectTournamentRealtime({
      publicId,
      displayKey: secret,
      onChange: () => void queryClient.invalidateQueries({ queryKey }),
      onConnection: setConnection,
    }),
    [publicId, queryClient, queryKey, secret],
  );

  // Wie `live-encounter.tsx`: die oeffentliche Route antwortet mit 404 sowohl
  // fuer ein nicht existierendes als auch fuer ein privates Turnier (Task 4,
  // Datenschutz vor Auskunft), und `apiRequest`s generische Fehlermeldung
  // fuer einen unbekannten Fehlercode waere hier nur verwirrend.
  const initialLoadFailed = !query.isPending && query.data === undefined;

  // PR-Review, Folgebefund: `initialLoadFailed` allein sagt nur, dass der
  // Erstload keine Daten brachte -- ein 500er, ein Netzwerkausfall oder ein
  // Timeout sehen darin genauso aus wie ein alter oder unbekannter Link. Nur
  // eine tatsaechliche 404 der Live-Abfrage rechtfertigt den Uebergangsweg
  // ueber `/address`; jeder andere Fehlschlag bekommt eine eigene, von
  // "Turnier nicht gefunden." unterscheidbare Meldung.
  const initialLoadIsNotFound =
    initialLoadFailed && query.error instanceof ApiClientError && query.error.status === 404;

  // Befund B (Folgereview oeffentliche-turnier-ids): `resolvePublicId` zahlt
  // eine Rundreise gegen `/address`, die fuer eine echte `public_id` planmaessig
  // mit 404 endet (`live-address.ts`). Sie lohnt sich nur, wenn die
  // Live-Abfrage selbst mit der uebergebenen ID scheitert -- deshalb erst hier
  // im Client statt vor dem Rendern in der Server-Komponente. `legacyResolution`
  // ist an die aktuelle `publicId` gebunden: aendert sie sich, gilt eine
  // fruehere Aufloesung nicht mehr und wird neu versucht.
  const [legacyResolution, setLegacyResolution] = useState<{ readonly publicId: string; readonly resolved: string | null } | null>(null);
  const resolvedForCurrent = legacyResolution?.publicId === publicId ? legacyResolution.resolved : undefined;

  useEffect(() => {
    if (!initialLoadIsNotFound || resolvedForCurrent !== undefined) return;
    let cancelled = false;
    void resolvePublicId(publicId).then((resolved) => {
      if (!cancelled) setLegacyResolution({ publicId, resolved });
    });
    return () => {
      cancelled = true;
    };
  }, [initialLoadIsNotFound, publicId, resolvedForCurrent]);

  useEffect(() => {
    if (typeof resolvedForCurrent === "string") {
      router.replace(legacyRedirectTarget(mode, boardId, resolvedForCurrent));
    }
  }, [boardId, mode, resolvedForCurrent, router]);

  if (query.isPending) return <LiveNotice text="Live-Turnier wird geladen …" />;
  if (initialLoadFailed) {
    // Kein alter Link: ein Serverfehler, ein Netzwerkausfall oder ein Timeout
    // behaupten nicht, das Turnier existiere nicht -- und zahlen auch nicht
    // die Rundreise gegen `/address` (siehe `initialLoadIsNotFound` oben).
    if (!initialLoadIsNotFound) {
      return <LiveNotice text="Diese Ansicht konnte nicht geladen werden. Versuche es später erneut." />;
    }
    // Solange die Aufloesung laeuft oder eine Umleitung bevorsteht
    // (`resolvedForCurrent` ist `undefined` bzw. eine `string`), bleibt es bei
    // der Lade-Meldung -- sonst blitzt "Turnier nicht gefunden." fuer einen
    // alten Link kurz auf, bevor die Umleitung greift.
    if (resolvedForCurrent === null) return <LiveNotice text="Turnier nicht gefunden." />;
    return <LiveNotice text="Live-Turnier wird geladen …" />;
  }
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
          <span
            aria-hidden="true"
            className={`h-3 w-3 rounded-full ${query.isError ? "bg-rose-400" : "bg-slate-500"}`}
          />
          {/*
           * Ein Farbwechsel allein reicht nicht (AGENTS.md §19): der Punkt
           * begleitet nur, den Zustand traegt der Text. Ein ausgefallener
           * Nachlauf ist ein Hinweis, keine Katastrophe -- deshalb nur eine
           * ruhige Meldung statt einer Warnfarbe fuer den Text selbst.
           */}
          <span className={query.isError ? "text-rose-300" : undefined}>
            {query.isError
              ? "Aktualisierung fehlgeschlagen · letzter Stand"
              : connection === "verbunden"
                ? "Live aktualisiert"
                : "Aktualisiert alle 5 Sekunden"}
          </span>
          {mode === "publikum" ? <Link className="rounded border border-slate-600 px-3 py-2" href={`/live/${publicId}/tv`}>TV-Modus</Link> : null}
        </div>
      </header>

      <LiveSection title="Boards">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {boards.map((board) => <LiveBoard board={board} key={board.boardId} mode={mode} publicId={publicId} />)}
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

function LiveBoard({ board, mode, publicId }: { readonly board: PublicBoardSlot; readonly mode: LiveTournamentProps["mode"]; readonly publicId: string }) {
  const [qrCode, setQrCode] = useState<string | null>(null);
  useEffect(() => {
    if (mode !== "publikum") return;
    const url = `${window.location.origin}/live/${publicId}/board/${board.boardId}`;
    void QRCode.toDataURL(url, { margin: 1, width: 144 }).then(setQrCode);
  }, [board.boardId, mode, publicId]);
  return <article className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
    <div className="flex items-start justify-between gap-4"><div><p className="text-caption font-semibold uppercase tracking-[0.12em] text-emerald-300">{board.boardName}</p><p className="mt-1 text-caption text-slate-400">{board.state === "PLAYING" ? "Match läuft" : board.state === "FREE" ? "Frei" : "Nicht verfügbar"}</p></div>{qrCode !== null ? <Image alt={`QR-Code für ${board.boardName}`} className="h-20 w-20 rounded bg-white p-1" height={80} src={qrCode} unoptimized width={80} /> : null}</div>
    {board.match === null ? <p className="mt-8 font-numerals text-title text-slate-400">Kein aktives Match</p> : <div className="mt-5 grid grid-cols-2 gap-3">{board.match.participants.map((participant) => <div className={participant.isActive ? "rounded-xl bg-emerald-400/10 p-3" : "p-3"} key={participant.playerId}><p className="truncate text-body" title={participant.displayName}>{participant.displayName}</p><p className={participant.isActive ? "mt-2 font-numerals text-display font-bold tabular" : "mt-2 font-numerals text-data font-bold tabular text-slate-400"}>{participant.remaining}</p><p className="mt-1 text-body text-slate-400">{participant.legsWon} Legs · {participant.setsWon} Sets</p></div>)}</div>}
  </article>;
}

function LiveNotice({ text }: { readonly text: string }) {
  return <main className="min-h-screen bg-slate-950 p-8 text-slate-200">{text}</main>;
}
