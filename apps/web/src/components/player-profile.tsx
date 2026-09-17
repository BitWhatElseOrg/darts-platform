"use client";

import { useQuery } from "@tanstack/react-query";
import { hasOrganizationPermission } from "@darts-platform/domain";
import { playerSchema, playerStatisticsProfileSchema } from "@darts-platform/schemas";
import { Rule, SheetLabel } from "@darts-platform/ui";
import { useMemo } from "react";

import { NavLink, PageNav } from "@/components/page-nav";
import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";
import { calendarDateNumeric } from "@/lib/tournament-format";
import { PlayerAvatar } from "@/components/players/player-avatar";
import { PlayerAvatarControl } from "@/components/players/player-avatar-control";
import { useTournamentOrganization } from "./tournament/use-tournament-organization";

export function PlayerProfile({ playerId, requestedOrganizationId }: { readonly playerId: string; readonly requestedOrganizationId: string | undefined }) {
  const { query: organizationsQuery, organization } = useTournamentOrganization(requestedOrganizationId);
  const profileQuery = useQuery({
    queryKey: ["player-statistics", organization?.id, playerId],
    queryFn: ({ signal }) => apiRequest({ path: `/organizations/${organization?.id ?? ""}/players/${playerId}/statistics`, schema: playerStatisticsProfileSchema, signal }),
    enabled: organization !== null,
  });
  // Zwischenstand: `playerStatisticsProfileSchema.player` traegt noch kein
  // `avatarChecksum` (das braeuchte den Statistik-Join und ist ein eigener
  // Vorgang, kein Teil dieses Tasks). Bis dahin holt eine zweite, gezielt
  // auf diesen einen Spieler zugeschnittene Abfrage die Pruefsumme — nicht
  // die ganze Organisationsliste, die bei dreihundert Spielern dreihundert
  // Datensaetze fuer ein einziges Feld laden wuerde. Eigener Schluessel
  // ["player-avatar", organizationId, playerId]: ein Bildwechsel muss ihn
  // beim Invalidieren treffen, sonst zeigt der Kopf das alte Bild weiter.
  const avatarQuery = useQuery({
    queryKey: ["player-avatar", organization?.id, playerId],
    queryFn: ({ signal }) => apiRequest({ path: `/organizations/${organization?.id ?? ""}/players/${playerId}`, schema: playerSchema, signal }),
    enabled: organization !== null,
  });
  if (organizationsQuery.isPending || profileQuery.isPending) return <Notice text="Spielerprofil wird geladen …" />;
  if (organization === null) return <Notice text="Keine zugängliche Organisation gefunden." />;
  if (profileQuery.data === undefined) return <Notice text={userFacingErrorMessage(profileQuery.error, "Spielerprofil konnte nicht geladen werden.")} />;
  const profile = profileQuery.data;
  const stats = profile.career;
  const avatarChecksum = avatarQuery.data?.avatarChecksum ?? null;
  const avatarPlayer = { id: profile.player.id, displayName: profile.player.displayName, avatarChecksum };
  // Serverseitig entscheidet `PlayersService.requireAvatarWrite`: erlaubt ist
  // `player:update` ODER die Verknüpfung mit dem eigenen Konto. Die zweite
  // Bedingung bildet `organization.playerId` ab — dasselbe Feld, über das
  // `workspace-shell.tsx` den Link „Mein Profil" führt, also genau der Weg,
  // über den verknüpfte Personen überhaupt hierher kommen. Das Ausblenden
  // ist reine Bequemlichkeit; die Berechtigung selbst bleibt serverseitig
  // geprüft (AGENTS.md §13).
  const canEditAvatar =
    hasOrganizationPermission(organization.role, "player:update") ||
    organization.playerId === profile.player.id;
  return <main className="sektorenring min-h-screen">
    <div className="mx-auto max-w-6xl px-5 py-8">
      <PageNav>
        <NavLink href="/">Übersicht</NavLink>
      </PageNav>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          {canEditAvatar ? (
            <PlayerAvatarControl organizationId={organization.id} player={avatarPlayer} />
          ) : (
            <PlayerAvatar decorative organizationId={organization.id} player={avatarPlayer} size={96} />
          )}
          <div><h1 className="font-numerals text-headline font-bold text-wedge-900">{profile.player.displayName}</h1>{profile.player.nickname ? <p className="mt-1 font-plate text-body text-sisal-500">«{profile.player.nickname}»</p> : null}</div>
        </div>
        <p className="font-plate text-body text-sisal-500">{stats.matchesPlayed} Matches · {stats.wins} Siege · {stats.losses} Niederlagen</p>
      </header>
      <Rule className="mt-6" />

      <section aria-label="Karrierestatistik" className="mt-5 flex flex-col gap-6">
        <div>
          <SheetLabel as="h2">Scoring</SheetLabel>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Statistic label="Average" value={stats.threeDartAverage.toFixed(2)} />
            <Statistic label="First 9" value={stats.firstNineAverage.toFixed(2)} />
            <Statistic label="180er" value={String(stats.oneEighties)} />
            <Statistic label="High Finish" value={String(stats.highFinish)} />
          </div>
        </div>
        <div>
          <SheetLabel as="h2">Finish &amp; Form</SheetLabel>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Statistic
              label="Checkout-Quote"
              value={stats.checkoutPercentage === null ? "–" : `${stats.checkoutPercentage.toFixed(1)} %`}
              note={stats.checkouts === null || stats.checkoutAttempts === null ? "Unter Straight Out nicht anwendbar" : `${stats.checkouts} von ${stats.checkoutAttempts}`}
            />
            <Statistic label="Best Leg" value={stats.bestLeg === null ? "–" : `${stats.bestLeg} Darts`} />
            <Statistic label="Darts pro Leg" value={stats.dartsPerLeg.toFixed(2)} />
            <Statistic label="Siegquote" value={stats.matchesPlayed === 0 ? "0 %" : `${(stats.wins / stats.matchesPlayed * 100).toFixed(1)} %`} />
          </div>
        </div>
      </section>

      <div className="mt-9 grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <section><SheetLabel as="h2">Matchverlauf</SheetLabel><Rule className="mt-2" />
          {profile.matchHistory.length === 0 ? <p className="mt-4 font-plate text-body text-sisal-500">Noch keine abgeschlossenen Matches.</p> : <ol>{profile.matchHistory.map((match) => <li className="grid grid-cols-[6rem_1fr_auto] gap-3 border-b border-sisal-300 py-3 font-plate text-body" key={match.matchId}><time>{calendarDateNumeric(match.playedAt)}</time><span>{match.won ? "Sieg" : "Niederlage"} gegen {match.opponentDisplayName}</span><strong>{match.legsWon}:{match.legsLost} · Ø {match.threeDartAverage.toFixed(2)}</strong></li>)}</ol>}
        </section>
        <section><SheetLabel as="h2">Direkter Vergleich</SheetLabel><Rule className="mt-2" /><ol>{profile.headToHead.map((opponent) => <li className="flex justify-between gap-3 border-b border-sisal-300 py-3 font-plate text-body" key={opponent.opponentPlayerId}><span>{opponent.opponentDisplayName}</span><strong>{opponent.wins}:{opponent.losses}</strong></li>)}</ol></section>
      </div>

      <section className="mt-9"><SheetLabel as="h2">Rankingverlauf</SheetLabel><Rule className="mt-2" /><RankingChart history={profile.rankingHistory} /></section>
    </div>
  </main>;
}

function Statistic({ label, value, note }: { readonly label: string; readonly value: string; readonly note?: string }) { return <article className="border border-sisal-400 bg-sisal-50 p-4"><p className="font-plate text-label font-semibold uppercase text-sisal-500">{label}</p><p className="mt-2 font-numerals text-data font-bold tabular text-wedge-900">{value}</p>{note ? <p className="font-plate text-caption text-sisal-500">{note}</p> : null}</article>; }

function RankingChart({ history }: { readonly history: readonly { readonly rating: number; readonly recordedAt: Date }[] }) {
  const points = useMemo(() => {
    if (history.length === 0) return "";
    const ratings = history.map((entry) => entry.rating);
    const minimum = Math.min(...ratings) - 10;
    const maximum = Math.max(...ratings) + 10;
    return ratings.map((rating, index) => `${history.length === 1 ? 50 : index / (history.length - 1) * 100},${90 - (rating - minimum) / Math.max(maximum - minimum, 1) * 80}`).join(" ");
  }, [history]);
  if (history.length === 0) return <p className="mt-4 font-plate text-body text-sisal-500">Der Verlauf beginnt nach dem ersten abgeschlossenen Match.</p>;
  return <div className="mt-4 border border-sisal-400 bg-sisal-50 p-4"><svg aria-label="Ratingverlauf" className="h-48 w-full" preserveAspectRatio="none" role="img" viewBox="0 0 100 100"><path d="M0 90H100" stroke="#c2b280" strokeWidth="1"/><polyline fill="none" points={points} stroke="#057a55" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg><div className="flex justify-between font-plate text-caption text-sisal-500"><span>{history[0]?.rating}</span><span>Aktuell {history.at(-1)?.rating}</span></div></div>;
}

function Notice({ text }: { readonly text: string }) { return <main className="sektorenring min-h-screen p-10 font-plate">{text}</main>; }
