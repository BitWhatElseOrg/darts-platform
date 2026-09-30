"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { boardDeviceSelfSchema, matchStateSchema, type MatchStateResponse } from "@darts-platform/schemas";

import { apiRequest } from "@/lib/api-client";
import { ApiClientError } from "@/lib/api-error";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DeviceCredentialProvider, useDeviceSecret } from "@/lib/device-credential-context";
import { forgetBoardDevice, recallBoardDevice, type StoredBoardDevice } from "@/lib/device-key-storage";
import { matchRefetchInterval, shouldRetryMatchLoad } from "@/lib/match-load-state";
import { listOfflineCommands } from "@/lib/offline-command-queue";
import { MatchScoreboard } from "@/components/match/match-scoreboard";
import { ScoreboardStatus } from "@/components/match/scoreboard-status";

import { KIOSK_POLL_MS, kioskView } from "./kiosk-view";

const LONG_PRESS_MS = 800;

/** Fehler der Selbstauskunft, die (noch) keine Reaktion der Fläche auslösen. */
function isApiError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}

/**
 * Ob ein Fehler beim Lesen des Matches bedeutet, dass es fuer dieses Geraet
 * nicht mehr gueltig ist: abgebrochen (404), auf eine andere Scheibe
 * verschoben (403 `DEVICE_BOARD_MISMATCH`) oder nicht mehr aktiv
 * (409 `DEVICE_MATCH_NOT_ACTIVE`, ueblicherweise eine Mutation, vorsorglich
 * auch hier behandelt). In jedem Fall gilt: zurueck in den Leerlauf, die
 * naechste `/me`-Antwort entscheidet ueber das naechste Match.
 */
function matchNoLongerValid(error: unknown): boolean {
  if (!isApiError(error)) return false;
  return error.status === 404 || error.code === "DEVICE_BOARD_MISMATCH" || error.code === "DEVICE_MATCH_NOT_ACTIVE";
}

/**
 * Innerer Baum, erst gemountet wenn ein Geraeteschluessel vorliegt. Alle
 * Hooks hier duerfen `useDeviceSecret()` erwarten: `KioskRoute` mountet diese
 * Komponente ausschliesslich innerhalb von `DeviceCredentialProvider`.
 */
function KioskContent({ stored }: { readonly stored: StoredBoardDevice }) {
  const router = useRouter();
  const deviceSecret = useDeviceSecret();

  const selfQuery = useQuery({
    queryKey: ["board-device-self"],
    queryFn: ({ signal }) =>
      apiRequest({ path: "/board-devices/me", schema: boardDeviceSelfSchema, signal, deviceSecret }),
    refetchInterval: KIOSK_POLL_MS,
    // Nur Netzfehler wiederholen: ein Fehlercode ist ein Urteil des Servers
    // (etwa `DEVICE_REVOKED`), das eine Wiederholung nicht aendert.
    retry: (failureCount, error) => !isApiError(error) && failureCount < 3,
  });
  const revoked = isApiError(selfQuery.error) && selfQuery.error.code === "DEVICE_REVOKED";

  // Bleibt ueber transiente Fehler der Selbstauskunft hinweg bestehen: ein
  // einzelner ausgefallener Poll soll die Flaeche nicht zurueck in den
  // Leerlauf werfen, waehrend ein Match laeuft. Aktualisiert nur bei einer
  // tatsaechlich NEUEN Antwort -- reine Anpassung waehrend des Renders
  // (`react-hooks/set-state-in-effect`), kein Effect.
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [currentMatchId, setCurrentMatchId] = useState<string | null>(null);
  if (selfQuery.data !== undefined && selfQuery.data.organization.id !== organizationId) {
    setOrganizationId(selfQuery.data.organization.id);
  }
  if (selfQuery.data !== undefined && selfQuery.data.currentMatchId !== currentMatchId) {
    setCurrentMatchId(selfQuery.data.currentMatchId);
  }
  const boardName = selfQuery.data?.board.name ?? stored.boardName;
  const organizationName = selfQuery.data?.organization.name ?? stored.organizationName;

  // Einmaliges Vergessen bei Widerruf: ein echter Seiteneffekt (Schreiben in
  // `localStorage`), kein abgeleiteter Zustand -- deshalb im Effect, nicht in
  // der Render-Anpassung oben.
  const forgottenRef = useRef(false);
  useEffect(() => {
    if (!revoked || forgottenRef.current) return;
    forgottenRef.current = true;
    forgetBoardDevice();
  }, [revoked]);

  // Zustand des Endstands: wann das zuletzt gezeigte Match beendet wurde, und
  // ob die Person schon "Weiter" getippt hat.
  const [lastMatchId, setLastMatchId] = useState<string | null>(null);
  const [lastMatchCompletedAt, setLastMatchCompletedAt] = useState<number | null>(null);
  const [dismissedMatchId, setDismissedMatchId] = useState<string | null>(null);

  // Meldet `/me` ein ANDERES laufendes Match, ist ein fruehrer Endstand
  // hinfaellig -- sonst koennte ein spaeterer Ausfall dieses neuen Matches
  // faelschlich den alten Endstand wieder zeigen.
  if (currentMatchId !== null && currentMatchId !== lastMatchId) {
    if (lastMatchId !== null) setLastMatchId(null);
    if (lastMatchCompletedAt !== null) setLastMatchCompletedAt(null);
  }

  // Wie viele Aufnahmen des zuletzt gezeigten Matches bei Widerruf noch in
  // der Warteschlange lagen -- best effort, `null` solange unbekannt oder
  // nicht zutreffend.
  const [revokedQueueCount, setRevokedQueueCount] = useState<number | null>(null);
  const lastShownMatchId = currentMatchId ?? lastMatchId;
  useEffect(() => {
    if (!revoked || organizationId === null || lastShownMatchId === null) return;
    let cancelled = false;
    listOfflineCommands(`match:${organizationId}:${lastShownMatchId}`)
      .then((commands) => {
        if (!cancelled) setRevokedQueueCount(commands.length);
      })
      .catch(() => {
        if (!cancelled) setRevokedQueueCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [revoked, organizationId, lastShownMatchId]);

  // Tickt nur im Zustand "ended" (siehe Effect unten), haelt aber immer einen
  // Wert bereit.
  const [now, setNow] = useState(() => Date.now());
  const view = kioskView({ currentMatchId, lastMatchId, lastMatchCompletedAt, dismissedMatchId, now });
  useEffect(() => {
    if (view.kind !== "ended") return;
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      clearInterval(interval);
    };
  }, [view.kind]);

  const matchId = view.kind === "idle" ? null : view.matchId;
  const matchQuery = useQuery({
    queryKey: ["match", organizationId, matchId],
    queryFn: ({ signal }) =>
      apiRequest({
        path: `/organizations/${organizationId ?? ""}/matches/${matchId ?? ""}`,
        schema: matchStateSchema,
        signal,
        deviceSecret,
      }),
    enabled: organizationId !== null && matchId !== null,
    refetchInterval: (query) => matchRefetchInterval(query.state.error),
    retry: shouldRetryMatchLoad,
  });

  // Erkennt den Uebergang IN_PROGRESS -> COMPLETED fuer GENAU dieses Match.
  // Ein echter Seiteneffekt (haelt den Zeitpunkt des Ereignisses fest,
  // `Date.now()`) gehoert in einen Effect, nicht in die Render-Anpassung wie
  // oben -- ein waehrend des Renders aufgerufenes `Date.now()` waere nicht
  // idempotent (ESLint `react-hooks/purity`). Gleiches Muster wie
  // `seenStatus`/`seenAbort` in `match-scoreboard.tsx`.
  const seenMatch = useRef<{ readonly matchId: string; readonly status: MatchStateResponse["status"] } | null>(null);
  useEffect(() => {
    if (matchQuery.data === undefined) return;
    const previous = seenMatch.current;
    seenMatch.current = { matchId: matchQuery.data.id, status: matchQuery.data.status };
    if (
      previous !== null &&
      previous.matchId === matchQuery.data.id &&
      previous.status === "IN_PROGRESS" &&
      matchQuery.data.status === "COMPLETED"
    ) {
      setLastMatchId(matchQuery.data.id);
      setLastMatchCompletedAt(Date.now());
    }
  }, [matchQuery.data]);

  // Das Match ist fuer dieses Geraet nicht mehr gueltig (abgebrochen, auf
  // eine andere Scheibe verschoben, nicht mehr aktiv): zurueck in den
  // Leerlauf, ohne Fehlermeldung -- die naechste `/me`-Antwort entscheidet.
  if (matchNoLongerValid(matchQuery.error)) {
    if (currentMatchId === matchId) setCurrentMatchId(null);
    if (lastMatchId === matchId) {
      setLastMatchId(null);
      setLastMatchCompletedAt(null);
    }
  }

  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // Langes Druecken auf den Scheibennamen: Geraet auf diesem Tablet
  // zuruecksetzen (nur lokal -- Entkoppeln geschieht in der
  // Organisationsverwaltung).
  const [resetOpen, setResetOpen] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearPressTimer = () => {
    if (pressTimer.current !== null) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };
  const startPress = () => {
    clearPressTimer();
    pressTimer.current = setTimeout(() => setResetOpen(true), LONG_PRESS_MS);
  };

  if (revoked) {
    return (
      <main className="sektorenring flex min-h-screen items-center justify-center bg-sisal-200 px-4 py-6 text-chalk">
        <div className="flex max-w-md flex-col gap-2 rounded-xl border border-sisal-400 bg-sisal-100/80 p-5 text-body text-spider">
          <p role="alert">
            Dieses Tablet ist nicht mehr gekoppelt – bitte in der Organisationsverwaltung unter «Scheiben-Tablets» neu
            einrichten.
          </p>
          {revokedQueueCount !== null && revokedQueueCount > 0 ? (
            <p>{revokedQueueCount} Aufnahmen konnten nicht mehr übertragen werden.</p>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <main className="sektorenring flex min-h-screen flex-col bg-sisal-200 text-chalk">
      <header className="flex items-center justify-between gap-3 border-b border-sisal-300 bg-sisal-200 px-4 py-2">
        <button
          className="min-h-12 rounded-lg px-2 text-body font-semibold text-chalk"
          onContextMenu={(event) => event.preventDefault()}
          onPointerCancel={clearPressTimer}
          onPointerDown={startPress}
          onPointerLeave={clearPressTimer}
          onPointerUp={clearPressTimer}
          type="button"
        >
          {boardName}
        </button>
        <p className="truncate text-caption text-spider-dim">{organizationName}</p>
      </header>
      <ScoreboardStatus
        busy={null}
        lockState="EIGEN"
        message={null}
        online={online}
        onTakeOver={() => {}}
        queuedCount={0}
      />
      <div className="flex flex-1 flex-col">
        {view.kind === "idle" ? (
          <div className="flex flex-1 items-center justify-center px-4 text-center">
            <p className="font-numerals text-title font-bold text-chalk">{boardName} – wartet auf nächstes Match</p>
          </div>
        ) : matchQuery.data === undefined || organizationId === null ? (
          <div className="flex flex-1 items-center justify-center px-4 text-center">
            <p className="text-body text-spider" role="status">
              Match wird geladen …
            </p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col">
            <MatchScoreboard
              canAbort={false}
              canScore={true}
              match={matchQuery.data}
              organizationId={organizationId}
              showHeaderLinks={false}
            />
            {view.kind === "ended" ? (
              <div className="border-t border-sisal-300 bg-sisal-100 p-4">
                <button
                  className="min-h-12 w-full rounded-lg bg-ring-green px-4 text-body font-semibold text-sisal-900"
                  onClick={() => setDismissedMatchId(view.matchId)}
                  type="button"
                >
                  Weiter
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
      <ConfirmDialog
        confirmLabel="Zurücksetzen"
        confirmVariant="danger"
        description="Löscht die Kopplung nur auf diesem Tablet. Entkoppeln kannst du es in der Organisationsverwaltung."
        error={null}
        onCancel={() => setResetOpen(false)}
        onConfirm={() => {
          setResetOpen(false);
          forgetBoardDevice();
          router.replace("/");
        }}
        open={resetOpen}
        pending={false}
        title="Gerät zurücksetzen?"
      />
    </main>
  );
}

/**
 * Kiosk-Wurzel (`/scheibe`, Spec 2026-09-30-scheiben-tablet, Task 11). Ohne
 * gespeicherten Geraeteschluessel gibt es nichts zu zeigen -- kein
 * `DeviceCredentialProvider`, keine Anfragen.
 *
 * `useState(() => recallBoardDevice())` liest genau EINMAL beim Mount: der
 * Schluessel aendert sich nicht waehrend die Seite offen bleibt (ausser durch
 * eigenes Handeln dieser Komponente, das ohnehin zur Startseite navigiert).
 */
export function KioskRoute() {
  const [stored] = useState(() => recallBoardDevice());

  if (stored === null) {
    return (
      <main className="sektorenring flex min-h-screen items-center justify-center bg-sisal-200 px-4 py-6 text-chalk">
        <div className="flex max-w-md flex-col items-start gap-3 rounded-xl border border-sisal-400 bg-sisal-100/80 p-5 text-body text-spider">
          <p>Dieses Tablet ist nicht gekoppelt.</p>
          <a className="underline underline-offset-2" href="/">
            Zur Startseite
          </a>
        </div>
      </main>
    );
  }

  return (
    <DeviceCredentialProvider secret={stored.secret}>
      <KioskContent stored={stored} />
    </DeviceCredentialProvider>
  );
}
