"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { encounterDetailSchema, type EncounterDetail } from "@darts-platform/schemas";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiClientError, apiRequest, userFacingErrorMessage } from "@/lib/api-client";
import { generateId } from "@/lib/id";
import { busyPlayersMessage } from "@/lib/encounter-view";
import { connectEncounterRealtime, type RealtimeConnection } from "@/lib/realtime";

export interface EncounterConflict {
  readonly expected: number;
  readonly server: number;
  readonly currentState: EncounterDetail;
}

export interface EncounterCommands {
  readonly encounter: EncounterDetail | undefined;
  readonly isPending: boolean;
  readonly loadError: string | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly conflict: EncounterConflict | null;
  readonly announcement: string;
  readonly realtime: RealtimeConnection;
  readonly acceptServerState: () => void;
  readonly run: (input: {
    readonly path: string;
    readonly body: Readonly<Record<string, unknown>>;
    readonly announce: string;
  }) => Promise<boolean>;
}

/**
 * Ein 409 trägt den Serverzustand im Fehler mit; er wird nicht neu geladen,
 * sondern angeboten. Dasselbe Muster benutzt die Turnier-Kommandozentrale.
 */
function conflictFrom(error: unknown, expected: number): EncounterConflict | null {
  if (!(error instanceof ApiClientError) || error.code !== "ENCOUNTER_VERSION_CONFLICT") return null;
  const details = error.details as { readonly currentState?: unknown } | undefined;
  const parsed = encounterDetailSchema.safeParse(details?.currentState);
  return parsed.success
    ? { expected, server: parsed.data.version, currentState: parsed.data }
    : null;
}

/**
 * Jede Mutation an einer Begegnung geht denselben Weg: frische `commandId`
 * (AGENTS.md §11), `expectedVersion` aus dem zuletzt gesehenen Zustand
 * (§12), Antwort ist der neue Zustand. Deshalb steht sie einmal hier.
 */
export function useEncounterCommand(input: {
  readonly organizationId: string;
  readonly encounterId: string;
}): EncounterCommands {
  const { encounterId, organizationId } = input;
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ["encounter", organizationId, encounterId] as const,
    [encounterId, organizationId],
  );
  const [realtime, setRealtime] = useState<RealtimeConnection>("verbindet");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<EncounterConflict | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      apiRequest({
        path: `/organizations/${organizationId}/encounters/${encounterId}`,
        schema: encounterDetailSchema,
        signal,
      }),
    // Polling nur, solange die Echtzeitverbindung fehlt.
    refetchInterval: realtime === "verbunden" ? false : 5_000,
  });
  const encounter = query.data;

  // Der Raum haengt an der `publicId` der Begegnung, nicht an der internen
  // `encounterId` (die bleibt fuer den authentifizierten REST-Weg oben
  // richtig). Sie kommt erst mit der geladenen Begegnung -- vorher gibt es
  // keinen Raum, mit dem sich verbinden liesse.
  const encounterPublicId = encounter?.publicId;
  useEffect(() => {
    if (encounterPublicId === undefined) return;
    return connectEncounterRealtime({
      publicId: encounterPublicId,
      onChange: () => void queryClient.invalidateQueries({ queryKey }),
      onConnection: setRealtime,
    });
  }, [encounterPublicId, queryClient, queryKey]);

  const run = useCallback(
    async (command: {
      readonly path: string;
      readonly body: Readonly<Record<string, unknown>>;
      readonly announce: string;
    }): Promise<boolean> => {
      const current = queryClient.getQueryData<EncounterDetail>(queryKey);
      if (current === undefined || busy) return false;
      const expectedVersion = current.version;
      setBusy(true);
      try {
        const next = await apiRequest({
          path: command.path,
          method: "POST",
          body: { commandId: generateId(), expectedVersion, ...command.body },
          schema: encounterDetailSchema,
        });
        queryClient.setQueryData(queryKey, next);
        setConflict(null);
        setError(null);
        setAnnouncement(command.announce);
        return true;
      } catch (thrown) {
        const versionConflict = conflictFrom(thrown, expectedVersion);
        if (versionConflict !== null) setConflict(versionConflict);
        const named =
          thrown instanceof ApiClientError && thrown.code === "PLAYER_BUSY"
            ? busyPlayersMessage(thrown.details)
            : null;
        setError(named ?? userFacingErrorMessage(thrown, "Der Befehl wurde nicht ausgeführt."));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, queryClient, queryKey],
  );

  const acceptServerState = useCallback(() => {
    if (conflict === null) return;
    queryClient.setQueryData(queryKey, conflict.currentState);
    setConflict(null);
    setError(null);
    setAnnouncement("Serverzustand übernommen.");
  }, [conflict, queryClient, queryKey]);

  return {
    encounter,
    isPending: query.isPending,
    loadError:
      encounter === undefined && query.error
        ? userFacingErrorMessage(query.error, "Die Begegnung konnte nicht geladen werden.")
        : null,
    busy,
    error,
    conflict,
    announcement,
    realtime,
    acceptServerState,
    run,
  };
}
