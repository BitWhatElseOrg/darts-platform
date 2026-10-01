"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { z } from "zod";

import { hasOrganizationPermission, type OrganizationRole } from "@darts-platform/domain";
import {
  boardDeviceListSchema,
  boardListSchema,
  createdBoardDeviceSchema,
  type BoardDeviceResponse,
  type BoardResponse,
} from "@darts-platform/schemas";
import { Button } from "@darts-platform/ui";

import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";
import { authClient } from "@/lib/auth-client";
import { recallBoardDevice, rememberBoardDevice } from "@/lib/device-key-storage";
import { isStandaloneDisplay } from "@/lib/standalone-display";
import { ConfirmDialog } from "@/components/confirm-dialog";

const STORAGE_FAILED_MESSAGE =
  "Dieses Tablet konnte die Kopplung nicht speichern. Erlaube Website-Daten für DartBase und richte das Tablet erneut ein.";
const SIGN_OUT_FAILED_MESSAGE =
  "Die Anmeldung auf diesem Tablet konnte nicht beendet werden. Melde dich ab, bevor du das Tablet im Raum lässt.";

const relativeTime = new Intl.RelativeTimeFormat("de-CH", { numeric: "auto" });
const dateFormat = new Intl.DateTimeFormat("de-CH");

/**
 * "zuletzt gesehen" in drei Stufen (Task 10): Minuten unter einer Stunde,
 * sonst Stunden unter einem Tag, sonst das Datum. `Intl.RelativeTimeFormat`
 * deckt nur die ersten beiden Stufen sinnvoll ab -- darueber hinaus liest
 * sich ein festes Datum verlaesslicher als "vor 3 Tagen".
 */
function lastSeenLabel(lastSeenAt: Date | null): string {
  if (lastSeenAt === null) return "noch nie gesehen";
  const diffMinutes = Math.round((lastSeenAt.getTime() - Date.now()) / 60_000);
  if (Math.abs(diffMinutes) < 60) return relativeTime.format(diffMinutes, "minute");
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return relativeTime.format(diffHours, "hour");
  return dateFormat.format(lastSeenAt);
}

/**
 * Der Anzeigemodus aendert sich nicht waehrend die Seite offen bleibt --
 * `subscribe` meldet deshalb nie ein Update, `useSyncExternalStore` liest den
 * Schnappschuss nur einmal beim Mount neu ein. Das haelt Server- und ersten
 * Client-Render identisch (`getServerSnapshot` liefert `false`) und vermeidet
 * das direkte `setState` in einem Effekt, das `react-hooks/set-state-in-effect`
 * beanstandet.
 */
function subscribeStandaloneDisplay(): () => void {
  return () => {};
}

/**
 * Scheiben-Tablets in der Organisationsverwaltung einrichten und entkoppeln
 * (Spec 2026-09-30-scheiben-tablet, Task 10). Ein Tablet richtet sich nur auf
 * sich selbst ein: die Einrichtung laeuft in der installierten App, deren
 * `localStorage` von einem Browser-Tab getrennt ist (`isStandaloneDisplay`,
 * `device-key-storage.ts`) -- danach verlaesst das Geraet die Admin-Sitzung
 * (`authClient.signOut`) und wechselt in den Kiosk (`/scheibe`, Task 11).
 *
 * Vor dem Abmelden wird `recallBoardDevice()` gegengeprueft (Task-Review-Fix):
 * schlaegt das Schreiben in `localStorage` fehl, bleibt die Sitzung bestehen,
 * die eben angelegte Kopplung wird best effort zurueckgezogen, und die Person
 * sieht eine sichtbare Meldung statt unbemerkt abgemeldet im Kiosk zu landen.
 *
 * Nach dem Speichern bestaetigt `attemptSignOut()` auch das Abmelden selbst
 * (Abschlussreview-Befund 1, final-fix-findings.md): Better-Auth wirft bei
 * `signOut()` nicht, sondern liefert `{ error }` -- ein ungeprueftes
 * `await authClient.signOut()` navigierte trotz gescheitertem Abmelden nach
 * `/scheibe`, das Admin-Session-Cookie lebte auf dem oeffentlichen Tablet
 * weiter. Zusaetzlich prueft `getSession()` nach einem fehlerfreien
 * `signOut()` gegen, ob tatsaechlich keine Sitzung mehr besteht (etwa bei
 * einem Race mit einer parallelen Anfrage). Schlaegt eine der beiden Pruefungen
 * fehl, bleibt die Seite stehen, zeigt eine Meldung und erlaubt eine gezielte
 * Wiederholung -- die Kopplung selbst bleibt dabei gueltig.
 */
export function BoardDevicesSection({ organizationId, organizationName, role }: {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly role: OrganizationRole;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();

  // Server-Render und erster Client-Render muessen identisch bleiben, sonst
  // meldet React eine Hydration-Abweichung: der Anzeigemodus ist erst nach
  // dem Mount bekannt (`window.matchMedia`/`navigator.standalone` existieren
  // serverseitig nicht) -- siehe `subscribeStandaloneDisplay` oben.
  const standalone = useSyncExternalStore(subscribeStandaloneDisplay, isStandaloneDisplay, () => false);

  const mayManage = hasOrganizationPermission(role, "board:manage");

  const boardsQuery = useQuery({
    queryKey: ["boards", organizationId],
    enabled: mayManage,
    queryFn: ({ signal }) =>
      apiRequest({ path: `/organizations/${organizationId}/boards`, schema: boardListSchema, signal }),
  });
  const devicesQuery = useQuery({
    queryKey: ["board-devices", organizationId],
    enabled: mayManage,
    queryFn: ({ signal }) =>
      apiRequest({ path: `/organizations/${organizationId}/board-devices`, schema: boardDeviceListSchema, signal }),
  });

  const invalidateDevices = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ["board-devices", organizationId] });
  };

  const [signOutFailed, setSignOutFailed] = useState(false);

  /**
   * Abmelden und erst danach in den Kiosk wechseln -- siehe JSDoc oben.
   * Wird sowohl nach erfolgreicher Einrichtung als auch vom
   * «Abmelden wiederholen»-Knopf aufgerufen.
   */
  const attemptSignOut = async (): Promise<void> => {
    const signOutResult = await authClient.signOut();
    if (signOutResult.error !== null) {
      setSignOutFailed(true);
      return;
    }
    // Best effort: schlaegt diese Nachfrage selbst fehl, blockiert sie den
    // ansonsten erfolgreichen Abmelde-Vorgang nicht zusaetzlich.
    const sessionResult = await authClient.getSession().catch(() => null);
    if (sessionResult !== null && sessionResult.error === null && sessionResult.data !== null) {
      setSignOutFailed(true);
      return;
    }
    setSignOutFailed(false);
    router.replace("/scheibe");
  };

  const pairDevice = useMutation({
    mutationFn: (board: BoardResponse) =>
      apiRequest({
        path: `/organizations/${organizationId}/boards/${board.id}/devices`,
        method: "POST",
        body: { label: `Tablet ${board.name}` },
        schema: createdBoardDeviceSchema,
      }),
    onSuccess: async ({ secret, device }, board) => {
      rememberBoardDevice({ secret, boardName: board.name, organizationName });
      // `rememberBoardDevice` schluckt Schreibfehler intern (privates Fenster,
      // gesperrte Website-Daten, voller Speicher) -- ungeprueft weiter zu
      // fahren hiesse: die Person wird abgemeldet und landet im Kiosk, ohne
      // dass das Tablet den Schluessel je hatte, waehrend der Server das neue
      // Geraet schon gekoppelt und ein etwaiges altes widerrufen hat. Ein
      // unsichtbarer Datenverlust (AGENTS.md §18). Deshalb erst verifizieren.
      const stored = recallBoardDevice();
      if (stored === null || stored.secret !== secret) {
        try {
          await apiRequest({
            path: `/organizations/${organizationId}/boards/${board.id}/devices/${device.id}`,
            method: "DELETE",
            schema: z.undefined(),
          });
        } catch {
          // Best effort: selbst wenn der Widerruf scheitert, bricht die
          // Einrichtung sichtbar ab, statt die Person unbemerkt abzumelden.
        }
        await invalidateDevices();
        setStorageFailed(true);
        return;
      }
      setSignOutFailed(false);
      await attemptSignOut();
    },
  });
  const revokeDevice = useMutation({
    mutationFn: (input: { readonly board: BoardResponse; readonly device: BoardDeviceResponse }) =>
      apiRequest({
        path: `/organizations/${organizationId}/boards/${input.board.id}/devices/${input.device.id}`,
        method: "DELETE",
        schema: z.undefined(),
      }),
  });

  // Das Einrichten mit vorhandenem Geraet entkoppelt das bisherige Tablet --
  // eine eigene Bestaetigung neben der fuer "Entkoppeln" (unten), denn hier
  // geschieht der Entzug als Nebeneffekt eines anderen Knopfs.
  const [replaceTarget, setReplaceTarget] = useState<BoardResponse | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{
    readonly board: BoardResponse;
    readonly device: BoardDeviceResponse;
  } | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);

  if (!mayManage) return null;

  const boards = boardsQuery.data ?? [];
  const devices = devicesQuery.data ?? [];
  const deviceFor = (board: BoardResponse): BoardDeviceResponse | undefined =>
    devices.find((device) => device.boardId === board.id);

  const startPairing = (board: BoardResponse) => {
    setStorageFailed(false);
    setSignOutFailed(false);
    pairDevice.reset();
    pairDevice.mutate(board);
  };

  return (
    <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 sm:p-6">
      <h2 className="font-numerals text-title font-bold text-white">Scheiben-Tablets</h2>
      <p className="text-body text-slate-300">
        Ein Tablet an der Scheibe scort die dort zugewiesenen Matches ohne Anmeldung. Richte es direkt auf dem
        Tablet ein, in der installierten App.
      </p>
      {storageFailed ? (
        <p className="text-body text-rose-300" role="alert">{STORAGE_FAILED_MESSAGE}</p>
      ) : signOutFailed ? (
        <div className="space-y-2">
          <p className="text-body text-rose-300" role="alert">{SIGN_OUT_FAILED_MESSAGE}</p>
          <Button onClick={() => void attemptSignOut()} type="button" variant="outline">
            Abmelden wiederholen
          </Button>
        </div>
      ) : pairDevice.isError ? (
        <p className="text-body text-rose-300" role="alert">{userFacingErrorMessage(pairDevice.error)}</p>
      ) : null}
      {boardsQuery.isPending || devicesQuery.isPending ? (
        <p className="text-body text-slate-400">Scheiben werden geladen …</p>
      ) : boardsQuery.isError ? (
        <p className="text-body text-rose-300" role="alert">{userFacingErrorMessage(boardsQuery.error)}</p>
      ) : devicesQuery.isError ? (
        <p className="text-body text-rose-300" role="alert">{userFacingErrorMessage(devicesQuery.error)}</p>
      ) : boards.length === 0 ? (
        <p className="text-body text-slate-400">Diese Organisation hat noch keine Scheibe angelegt.</p>
      ) : (
        <ul className="space-y-3">
          {boards.map((board) => {
            const device = deviceFor(board);
            const pairingThisBoard = pairDevice.isPending && pairDevice.variables?.id === board.id;
            return (
              <li
                className="grid gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-4 sm:grid-cols-[1fr_auto] sm:items-center"
                key={board.id}
              >
                <div className="min-w-0">
                  <p className="truncate text-body font-semibold text-white">{board.name}</p>
                  <p className="text-caption text-slate-400">
                    {device === undefined ? "Kein Gerät" : `Gekoppelt · zuletzt gesehen ${lastSeenLabel(device.lastSeenAt)}`}
                  </p>
                </div>
                <div className="grid gap-2 sm:w-64">
                  <Button
                    disabled={!standalone || pairingThisBoard}
                    onClick={() => (device === undefined ? startPairing(board) : setReplaceTarget(board))}
                    type="button"
                  >
                    {device === undefined ? "Dieses Gerät einrichten" : "Dieses Gerät als Ersatz einrichten"}
                  </Button>
                  {!standalone ? (
                    <p className="text-caption text-slate-500">
                      Öffne DartBase zuerst als App vom Home-Bildschirm
                    </p>
                  ) : null}
                  {device !== undefined ? (
                    <Button
                      disabled={revokeDevice.isPending && revokeTarget?.device.id === device.id}
                      onClick={() => {
                        revokeDevice.reset();
                        setRevokeTarget({ board, device });
                      }}
                      type="button"
                      variant="outline"
                    >
                      Entkoppeln
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        confirmLabel="Als Ersatz einrichten"
        description="Das bisherige Tablet dieser Scheibe wird dabei entkoppelt."
        error={null}
        onCancel={() => setReplaceTarget(null)}
        onConfirm={() => {
          if (replaceTarget === null) return;
          const board = replaceTarget;
          setReplaceTarget(null);
          startPairing(board);
        }}
        open={replaceTarget !== null}
        pending={false}
        title="Tablet ersetzen"
      />

      <ConfirmDialog
        confirmLabel="Entkoppeln"
        confirmVariant="danger"
        description={
          revokeTarget === null
            ? ""
            : `Das Tablet an ${revokeTarget.board.name} verliert den Zugriff und muss neu eingerichtet werden.`
        }
        error={revokeDevice.isError ? userFacingErrorMessage(revokeDevice.error) : null}
        onCancel={() => setRevokeTarget(null)}
        onConfirm={() => {
          if (revokeTarget === null) return;
          const target = revokeTarget;
          revokeDevice.mutate(target, {
            onSuccess: async () => {
              await invalidateDevices();
              setRevokeTarget((current) => (current !== null && current.device.id === target.device.id ? null : current));
            },
          });
        }}
        open={revokeTarget !== null}
        pending={revokeDevice.isPending}
        title="Tablet entkoppeln"
      />
    </section>
  );
}
