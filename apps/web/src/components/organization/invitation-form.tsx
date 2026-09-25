"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import {
  createdInvitationSchema,
  type PlayerResponse,
} from "@darts-platform/schemas";
import { Button } from "@darts-platform/ui";

import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";
import { buildInvitationLink } from "@/lib/invitation-link";

import { inputClassName, labelClassName } from "../players/form-styles";

const roles = [
  { value: "ADMIN", label: "Admin" },
  { value: "TOURNAMENT_DIRECTOR", label: "Turnierleitung" },
  { value: "SCORER", label: "Scorer" },
  { value: "MEMBER", label: "Mitglied" },
  { value: "VIEWER", label: "Zuschauer" },
] as const;

/**
 * Einladung mit optionalem Spielerbezug. Wird ein Profil gewaehlt, verknuepft
 * die Annahme Konto und Profil in derselben Transaktion (ADR 0015). Zur
 * Auswahl stehen nur aktive Profile ohne Konto — dieselbe Bedingung, die der
 * Server prueft.
 */
export function InvitationForm({
  organizationId,
  players,
  onCreated,
}: {
  readonly organizationId: string;
  readonly players: readonly PlayerResponse[];
  /** Nach erfolgreichem Anlegen, damit die Liste der offenen Einladungen nachlaedt. */
  readonly onCreated?: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("MEMBER");
  const [playerId, setPlayerId] = useState("");

  const assignablePlayers = players.filter(
    (player) => player.status === "ACTIVE" && !player.hasAccount,
  );

  const inviteMember = useMutation({
    mutationFn: () =>
      apiRequest({
        path: `/organizations/${organizationId}/invitations`,
        method: "POST",
        body: {
          email,
          role,
          ...(playerId.length > 0 ? { playerId } : {}),
        },
        schema: createdInvitationSchema,
      }),
    onSuccess: () => {
      setEmail("");
      setRole("MEMBER");
      setPlayerId("");
      onCreated?.();
    },
  });

  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        inviteMember.mutate();
      }}
    >
      <div className="space-y-2">
        <label className={labelClassName} htmlFor="invitation-email">E-Mail-Adresse für Einladung</label>
        <input
          id="invitation-email"
          className={inputClassName}
          type="email"
          placeholder="member@example.com"
          onChange={(event) => setEmail(event.target.value)}
          value={email}
        />
      </div>
      <div className="space-y-2">
        <label className={labelClassName} htmlFor="invitation-role">Rolle</label>
        <select
          id="invitation-role"
          className={inputClassName}
          onChange={(event) => setRole(event.target.value)}
          value={role}
        >
          {roles.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      <Button disabled={inviteMember.isPending || email.length === 0} type="submit">Einladen</Button>

      <div className="space-y-2 sm:col-span-3">
        <label className={labelClassName} htmlFor="invitation-player">Spielerprofil (optional)</label>
        <select
          id="invitation-player"
          className={inputClassName}
          onChange={(event) => setPlayerId(event.target.value)}
          value={playerId}
        >
          <option value="">Kein Profil verknüpfen</option>
          {assignablePlayers.map((player) => (
            <option key={player.id} value={player.id}>{player.displayName}</option>
          ))}
        </select>
        <p className="text-caption text-slate-400">
          Verknüpft das Konto beim Annehmen mit diesem Spielerprofil. Die Person
          sieht danach ihr eigenes Profil und ihre Statistik.
        </p>
      </div>

      {inviteMember.isSuccess ? (
        <div className="space-y-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4 sm:col-span-3">
          <p className="text-body text-emerald-100">
            Einladung erstellt, eine E-Mail an {inviteMember.data.email} ist unterwegs. Falls sie nicht ankommt,
            kannst du diesen Link oder Code auf einem anderen Weg weitergeben. Beides wird nur einmal angezeigt.
          </p>
          <label className={labelClassName} htmlFor="created-invitation-link">Einladungslink</label>
          <input
            id="created-invitation-link"
            className={`${inputClassName} font-mono`}
            readOnly
            value={buildInvitationLink(window.location.origin, inviteMember.data.id, inviteMember.data.claimToken)}
          />
          <label className={labelClassName} htmlFor="created-invitation-claim">Einladungscode</label>
          <input
            id="created-invitation-claim"
            className={`${inputClassName} font-mono`}
            readOnly
            value={inviteMember.data.claimToken}
          />
        </div>
      ) : null}
      {inviteMember.isError ? (
        <p role="alert" className="text-body text-rose-300 sm:col-span-3">{userFacingErrorMessage(inviteMember.error)}</p>
      ) : null}
    </form>
  );
}
