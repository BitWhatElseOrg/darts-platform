"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  organizationMemberSchema,
  type OrganizationMember,
  type PlayerResponse,
} from "@darts-platform/schemas";
import { Button } from "@darts-platform/ui";
import { z } from "zod";

import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";

const selectClassName =
  "min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-body text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30";

/**
 * Ordnet einem Mitglied ein Spielerprofil zu oder loest die Zuordnung. Die
 * Auswahl bietet nur aktive Profile ohne Konto an, dazu das aktuell
 * zugeordnete — dieselbe Bedingung, die der Server prueft (ADR 0015). Die
 * Sichtbarkeit dieser Bedienelemente ist Bedienhilfe; die Berechtigung
 * entscheidet der Server.
 */
export function MemberPlayerLink({
  organizationId,
  member,
  players,
}: {
  readonly organizationId: string;
  readonly member: OrganizationMember;
  readonly players: readonly PlayerResponse[];
}) {
  const queryClient = useQueryClient();
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  const assignable = players.filter(
    (player) =>
      (player.status === "ACTIVE" && !player.hasAccount) ||
      player.id === member.player?.id,
  );

  // Die Kontomarkierung der Spielerliste aendert sich mit, deshalb werden
  // beide Abfragen verworfen.
  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ["organization-members", organizationId] });
    await queryClient.invalidateQueries({ queryKey: ["players", organizationId] });
  };

  const linkPlayer = useMutation({
    mutationFn: (playerId: string) =>
      apiRequest({
        path: `/organizations/${organizationId}/members/${member.userId}/player`,
        method: "PUT",
        body: { playerId },
        schema: organizationMemberSchema,
      }),
    onSuccess: refresh,
  });
  const unlinkPlayer = useMutation({
    mutationFn: () =>
      apiRequest({
        path: `/organizations/${organizationId}/members/${member.userId}/player`,
        method: "DELETE",
        // Der Endpunkt antwortet planmaessig mit 204 ohne Koerper.
        schema: z.void(),
      }),
    onSuccess: async () => {
      setConfirmUnlink(false);
      await refresh();
    },
  });

  const selectId = `member-player-${member.userId}`;
  const pending = linkPlayer.isPending || unlinkPlayer.isPending;

  return (
    <div className="space-y-2">
      <label className="block space-y-1" htmlFor={selectId}>
        <span className="text-caption font-semibold tracking-[0.14em] text-slate-500 uppercase">
          Spielerprofil
        </span>
        <select
          className={selectClassName}
          disabled={pending}
          id={selectId}
          onChange={(event) => {
            const playerId = event.target.value;
            if (playerId.length === 0 || playerId === member.player?.id) return;
            linkPlayer.mutate(playerId);
          }}
          value={member.player?.id ?? ""}
        >
          <option value="">Nicht zugeordnet</option>
          {assignable.map((player) => (
            <option key={player.id} value={player.id}>{player.displayName}</option>
          ))}
        </select>
      </label>

      {member.player !== null ? (
        confirmUnlink ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <Button disabled={pending} onClick={() => unlinkPlayer.mutate()} type="button" variant="danger">
              Zuordnung wirklich lösen
            </Button>
            <Button disabled={pending} onClick={() => setConfirmUnlink(false)} type="button" variant="outline">
              Abbrechen
            </Button>
          </div>
        ) : (
          <Button disabled={pending} onClick={() => setConfirmUnlink(true)} type="button" variant="outline">
            Zuordnung lösen
          </Button>
        )
      ) : null}

      {linkPlayer.error !== null ? (
        <p className="text-caption text-rose-300" role="alert">{userFacingErrorMessage(linkPlayer.error)}</p>
      ) : null}
      {unlinkPlayer.error !== null ? (
        <p className="text-caption text-rose-300" role="alert">{userFacingErrorMessage(unlinkPlayer.error)}</p>
      ) : null}
    </div>
  );
}
