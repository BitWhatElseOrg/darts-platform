"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { boardDeviceSelfSchema, matchStateSchema, type MatchStateResponse } from "@darts-platform/schemas";

import { apiRequest } from "@/lib/api-client";
import { ApiClientError } from "@/lib/api-error";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DeviceCredentialProvider, useDeviceSecret } from "@/lib/device-credential-context";
import {
  forgetBoardDevice,
  getBoardDeviceSnapshot,
  subscribeBoardDeviceChanges,
  type StoredBoardDevice,
} from "@/lib/device-key-storage";
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

function isRevoked(error: unknown): boolean {
  return isApiError(error) && error.code === "DEVICE_REVOKED";
}

/**
 * Widerrufen: kein weiterer Poll lohnt sich mit einem Schluessel, den dieses
 * Tablet gleich vergisst (Task-Review IMPORTANT 3). Die Funktion liest den
 * Fehler des `query`-Objekts selbst statt eines aeusseren `revoked`, damit sie
 * als `refetchInterval`-Callback direkt in dieselbe `useQuery`-Definition
 * passt, deren Ergebnis `revoked` erst danach berechnet.
 */
function selfRefetchInterval(error: unknown): number | false {
  return isRevoked(error) ? false : KIOSK_POLL_MS;
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
    refetchInterval: (query) => selfRefetchInterval(query.state.error),
    // Nur Netzfehler wiederholen: ein Fehlercode ist ein Urteil des Servers
    // (etwa `DEVICE_REVOKED`), das eine Wiederholung nicht aendert.
    retry: (failureCount, error) => !isApiError(error) && failureCount < 3,
  });
  const { refetch: refetchSelf } = selfQuery;
  const revoked = isRevoked(selfQuery.error);

  const [organizationId, setOrganizationId] = useState<string | null>(null);
  if (selfQuery.data !== undefined && selfQuery.data.organization.id !== organizationId) {
    setOrganizationId(selfQuery.data.organization.id);
  }
  const boardName = selfQuery.data?.board.name ?? stored.boardName;
  const organizationName = selfQuery.data?.organization.name ?? stored.organizationName;

  // Einmaliges Vergessen bei Widerruf: ein echter Seiteneffekt (Schreiben in
  // `localStorage`), kein abgeleiteter Zustand -- deshalb im Effect, nicht in
  // der Render-Anpassung unten.
  const forgottenRef = useRef(false);
  useEffect(() => {
    if (!revoked || forgottenRef.current) return;
    forgottenRef.current = true;
    forgetBoardDevice();
  }, [revoked]);

  // `currentMatchId`: das laufende Match der Scheibe, wie zuletzt von `/me`
  // gemeldet. Bleibt ueber einen einzelnen ausgefallenen Poll hinweg
  // bestehen (siehe unten).
  //
  // `endedMatch`: ein Match, dessen Ausgang noch zu klaeren oder bereits
  // geklaert ist. `completedAt === null` heisst "unklar, wird gerade
  // nachgeladen" (Task-Review IMPORTANT 2); erst ein beobachteter
  // COMPLETED-Uebergang traegt eine Zeit ein, ab der `kioskView` den
  // Endstand zeigt. Ein einziges Objekt statt zweier Felder, damit beide
  // immer gemeinsam (atomar) geloescht werden -- getrennte States liefen
  // sonst auseinander, wenn ein voellig ANDERES Match abgelehnt wird,
  // waehrend noch ein frueherer Endstand steht (siehe Kommentar beim
  // Ablehnungs-Effect unten).
  const [currentMatchId, setCurrentMatchId] = useState<string | null>(null);
  const [endedMatch, setEndedMatch] = useState<{ readonly matchId: string; readonly completedAt: number | null } | null>(
    null,
  );
  // Ein Match, das auf dem Lesepfad als fuer dieses Geraet ungueltig erkannt
  // wurde (404/403/409) -- und wie viele Aufnahmen dafuer noch in der
  // Warteschlange lagen (Task-Review GAP 4). Bleibt stehen, bis ein neues
  // Match beginnt.
  const [rejectedMatchId, setRejectedMatchId] = useState<string | null>(null);
  const [rejectedQueueCount, setRejectedQueueCount] = useState<number | null>(null);

  // Reine Anpassung waehrend des Renders (`react-hooks/set-state-in-effect`),
  // kein Effect: `/me` treibt drei Faelle.
  if (selfQuery.data !== undefined) {
    const reported = selfQuery.data.currentMatchId;
    // Meldet `/me` noch immer dasselbe (nicht-leere) Match, das der Lesepfad
    // GERADE als ungueltig abgelehnt hat, ist das kein neuer Stand, sondern
    // derselbe veraltete Poll, der den Server noch nicht eingeholt hat. Ihn
    // trotzdem zu uebernehmen setzte `currentMatchId` sofort wieder auf diese
    // ID, der naechste Render lehnt sie ueber die (weiterhin gecachte) 404
    // erneut ab -- eine synchrone Render-Schleife ("Too many re-renders",
    // Task-Review CRITICAL 1). `null` ist dagegen NIE "derselbe abgelehnte
    // Stand": ein `/me` ohne laufendes Match ist ein eigener, legitimer
    // Zustand (etwa der ganz normale Uebergang in den Endstand, IMPORTANT 2)
    // und muss immer verarbeitet werden, auch wenn `rejectedMatchId` zufaellig
    // ebenfalls `null` ist.
    const isStaleRejectedReport = reported !== null && reported === rejectedMatchId;
    if (!isStaleRejectedReport && reported !== currentMatchId) {
      if (currentMatchId !== null && reported === null) {
        // Das bisher laufende Match ist nicht mehr "aktuell" -- ob es
        // regulaer beendet oder abgebrochen wurde, weiss noch niemand hier.
        // Vormerken (`completedAt: null`) und ueber denselben
        // Match-Query-Schluessel noch einmal laden (Task-Review IMPORTANT 2):
        // ohne diesen Schritt spraenge die Flaeche sofort in den Leerlauf,
        // bevor sie je einen COMPLETED-Status gesehen hat, und der Endstand
        // erschiene nie.
        //
        // Task 12, Review-Fix: der `seenMatch`-Effekt unten setzt den echten
        // Endstand ueblicherweise ZUERST -- `useMatchScoring` invalidiert die
        // Match-Query direkt nach einem erfolgreichen Checkout, dieser Poll
        // hier (alle `KIOSK_POLL_MS`) faellt fast immer spaeter. Ohne die
        // Wache unten ueberschrieb dieser Zweig einen bereits aufgeloesten
        // Endstand (`completedAt: <Zeitpunkt>`) wieder mit dem unaufgeloesten
        // Platzhalter (`completedAt: null`) -- der „Weiter"-Knopf erschien
        // dann nie, die Flaeche sprang direkt in den Leerlauf (E2E-Befund
        // Task 12: `board-device-kiosk.spec.ts`).
        if (endedMatch === null || endedMatch.matchId !== currentMatchId || endedMatch.completedAt === null) {
          setEndedMatch({ matchId: currentMatchId, completedAt: null });
        }
      } else if (endedMatch !== null) {
        // Ein neues, anderes Match (oder der Wechsel von "kein Match" auf ein
        // neues) macht einen noch offenen oder ungeklaerten Endstand
        // hinfaellig.
        setEndedMatch(null);
      }
      if (reported !== null && rejectedMatchId !== null) {
        // Ein neues Match beginnt -- eine gemeldete Ablehnung des vorigen ist
        // damit erledigt. Bewusst NICHT bei `reported === null` geloescht:
        // die Meldung (Task-Review GAP 4) soll im Leerlauf stehen bleiben,
        // nicht schon beim naechsten Poll ohne neues Match verschwinden.
        setRejectedMatchId(null);
        setRejectedQueueCount(null);
      }
      setCurrentMatchId(reported);
    }
  }

  // Wie viele Aufnahmen des zuletzt gezeigten Matches bei Widerruf noch in
  // der Warteschlange lagen -- best effort, `null` solange unbekannt oder
  // nicht zutreffend.
  const lastMatchId = endedMatch?.matchId ?? null;
  const lastMatchCompletedAt = endedMatch?.completedAt ?? null;
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
  const [dismissedMatchId, setDismissedMatchId] = useState<string | null>(null);
  const view = kioskView({ currentMatchId, lastMatchId, lastMatchCompletedAt, dismissedMatchId, now });
  useEffect(() => {
    if (view.kind !== "ended") return;
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      clearInterval(interval);
    };
  }, [view.kind]);

  // Im Leerlauf, aber mit einem noch ungeklaerten Match (`completedAt ===
  // null`): genau dieses Match weiter laden, um seinen Ausgang zu erfahren
  // (Task-Review IMPORTANT 2). Derselbe Query-Schluessel wie im Zustand
  // "match" -- die Abfrage laeuft ununterbrochen weiter, unabhaengig davon,
  // wie `kioskView` den Zwischenstand gerade einordnet.
  const pendingRecheckId = lastMatchCompletedAt === null ? lastMatchId : null;
  const matchId = view.kind === "idle" ? pendingRecheckId : view.matchId;
  const matchQuery = useQuery({
    queryKey: ["match", organizationId, matchId],
    queryFn: ({ signal }) =>
      apiRequest({
        path: `/organizations/${organizationId ?? ""}/matches/${matchId ?? ""}`,
        schema: matchStateSchema,
        signal,
        deviceSecret,
      }),
    // Widerrufen: auch die Match-Query stellt ein -- ein Geraet ohne
    // gueltigen Schluessel hat nichts mehr zu laden (Task-Review IMPORTANT 3).
    enabled: !revoked && organizationId !== null && matchId !== null,
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
    const isTransition =
      previous !== null &&
      previous.matchId === matchQuery.data.id &&
      previous.status === "IN_PROGRESS" &&
      matchQuery.data.status === "COMPLETED";
    // Abschlussreview-Befund 2 (final-fix-findings.md): im Nachladezustand
    // (`endedMatch.completedAt === null`, siehe oben) kann die allererste
    // Antwort fuer genau dieses Match bereits COMPLETED sein -- etwa wenn das
    // Tablet neu laedt oder `/me` schneller pollt als die Match-Query einen
    // IN_PROGRESS-Stand je gesehen hat. `isTransition` greift dann nie, weil
    // kein vorheriger IN_PROGRESS-Stand existiert. Ohne diesen zweiten Zweig
    // bliebe `completedAt` fuer immer `null`: `kioskView` zeigt dauerhaft
    // "idle", der Endstand erscheint nie. `endedMatch` steht bewusst in den
    // Deps: der Render-Zweig oben setzt `completedAt: null` oft, NACHDEM die
    // Match-Query ihre (gecachte) COMPLETED-Antwort schon hat -- ohne diese
    // Abhaengigkeit liefe der Effect dann nicht erneut.
    const isUnresolvedEndAlreadyComplete =
      endedMatch !== null &&
      endedMatch.matchId === matchQuery.data.id &&
      endedMatch.completedAt === null &&
      matchQuery.data.status === "COMPLETED";
    if (isTransition || isUnresolvedEndAlreadyComplete) {
      setEndedMatch({ matchId: matchQuery.data.id, completedAt: Date.now() });
    }
  }, [matchQuery.data, endedMatch]);

  // Das Match ist fuer dieses Geraet nicht mehr gueltig (abgebrochen, auf
  // eine andere Scheibe verschoben, nicht mehr aktiv): zurueck in den
  // Leerlauf. Ein Effect mit Einmal-Wache (`handledRejectionRef`) statt einer
  // Render-Anpassung: ein `.refetch()` ist ein echter Seiteneffekt (Netzwerk),
  // und ohne die ID-gebundene Wache wuerde dieselbe, weiterhin gecachte 404
  // bei jedem Render erneut greifen (Task-Review CRITICAL 1). Zusaetzlich
  // wird gezaehlt, wie viele Aufnahmen dieses Matches noch in der
  // Warteschlange lagen -- sichtbar gemeldet, nicht geloescht
  // (Task-Review GAP 4).
  const handledRejectionRef = useRef<string | null>(null);
  useEffect(() => {
    if (matchId === null || organizationId === null || !matchNoLongerValid(matchQuery.error)) return;
    if (handledRejectionRef.current === matchId) return;
    handledRejectionRef.current = matchId;
    const rejected = matchId;
    setRejectedMatchId(rejected);
    setRejectedQueueCount(null);
    setCurrentMatchId((current) => (current === rejected ? null : current));
    setEndedMatch((current) => (current !== null && current.matchId === rejected ? null : current));
    // Die naechste `/me`-Antwort soll nicht erst in bis zu `KIOSK_POLL_MS`
    // ankommen -- ein sofortiger, gezielter Refetch beschleunigt die
    // Rueckkehr in einen stimmigen Zustand (Spec §5).
    void refetchSelf();
    listOfflineCommands(`match:${organizationId}:${rejected}`)
      .then((commands) => setRejectedQueueCount(commands.length))
      .catch(() => setRejectedQueueCount(0));
  }, [matchId, matchQuery.error, organizationId, refetchSelf]);

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
      {/* Abschlussreview-Befund 5 (final-fix-findings.md): `MatchScoreboard`
          (unten) bringt seine eigene `ScoreboardStatus`-Leiste mit -- diese
          hier also nur zeigen, solange kein `MatchScoreboard` rendert
          (Leerlauf oder "Match wird geladen"), sonst stehen zwei
          Statuszeilen uebereinander, von denen die aeussere ohnehin nie
          etwas anzeigt (Kiosk kennt weder Board-Sperre noch Warteschlange).
          Dieselbe Bedingung wie unten, unter der `MatchScoreboard` tatsaechlich
          rendert (dritter Zweig der Ternary). */}
      {view.kind === "idle" || matchQuery.data === undefined || organizationId === null ? (
        <ScoreboardStatus
          busy={null}
          lockState="EIGEN"
          message={null}
          online={online}
          onTakeOver={() => {}}
          queuedCount={0}
        />
      ) : null}
      <div className="flex flex-1 flex-col">
        {view.kind === "idle" ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
            <p className="font-numerals text-title font-bold text-chalk">{boardName} – wartet auf nächstes Match</p>
            {rejectedMatchId !== null && rejectedQueueCount !== null && rejectedQueueCount > 0 ? (
              <p className="text-body text-spider" role="alert">
                {rejectedQueueCount} Aufnahme{rejectedQueueCount === 1 ? "" : "n"} des abgebrochenen Matches{" "}
                {rejectedQueueCount === 1 ? "konnte" : "konnten"} nicht mehr übertragen werden.
              </p>
            ) : null}
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
 * Waehrend der Server-Render und der allererste Client-Render (Hydration)
 * gilt der Geraeteschluessel als unbekannt -- `getBoardDeviceSnapshot` liest
 * `window.localStorage`, das es auf dem Server nicht gibt. Ein fester Wert
 * statt eines Zugriffsversuchs: React zieht diese Funktion beim Hydrieren
 * heran, um den allerersten Client-Render deckungsgleich mit dem
 * Server-Render zu halten (`react-dom-client.development.js`,
 * `mountSyncExternalStore`), sonst meldet React einen Hydration-Mismatch
 * (Task-12-Review-Befund).
 */
function getServerBoardDeviceSnapshot(): StoredBoardDevice | null | undefined {
  return undefined;
}

/**
 * Kiosk-Wurzel (`/scheibe`, Spec 2026-09-30-scheiben-tablet, Task 11). Ohne
 * gespeicherten Geraeteschluessel gibt es nichts zu zeigen -- kein
 * `DeviceCredentialProvider`, keine Anfragen.
 *
 * `useSyncExternalStore` statt eines rohen `useState(() => recallBoardDevice())`:
 * der Server rendert (mangels `localStorage`) immer `undefined` ("wird
 * geladen"), der erste Client-Render muss damit uebereinstimmen, sonst
 * verwirft React den Baum wegen eines Hydration-Mismatch und baut ihn neu
 * auf (sichtbares Aufblitzen des falschen Bildschirms, Task-12-Review-Befund
 * -- Muster wie `isStandaloneDisplay`/`subscribeStandaloneDisplay` in
 * `board-devices-section.tsx`). Gleich nach dem Mount korrigiert React selbst
 * auf den echten Wert aus `getBoardDeviceSnapshot`.
 *
 * `subscribeBoardDeviceChanges` meldet nur Aenderungen aus ANDEREN
 * Tabs/Fenstern (siehe dort) -- ein `forgetBoardDevice()` im Widerrufs-Zweig
 * von `KioskContent` bleibt dadurch ohne Rueckwirkung auf diese Komponente
 * und unmountet nicht mitten in der bewusst weiter angezeigten
 * Widerrufsmeldung.
 */
export function KioskRoute() {
  const stored = useSyncExternalStore(
    subscribeBoardDeviceChanges,
    getBoardDeviceSnapshot,
    getServerBoardDeviceSnapshot,
  );

  if (stored === undefined) {
    return (
      <main className="sektorenring flex min-h-screen items-center justify-center bg-sisal-200 px-4 py-6 text-chalk">
        <p className="text-body text-spider" role="status">
          Wird geladen …
        </p>
      </main>
    );
  }

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
