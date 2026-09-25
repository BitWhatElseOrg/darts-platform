"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { hasOrganizationPermission, type OrganizationRole } from "@darts-platform/domain";
import {
  createdInvitationSchema,
  invitationListSchema,
  organizationMemberListSchema,
  organizationMemberSchema,
  playerListSchema,
  type CreatedInvitation,
  type Invitation,
  type OrganizationMember,
  type OrganizationSummary,
} from "@darts-platform/schemas";
import { Button } from "@darts-platform/ui";
import { z } from "zod";

import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";
import { authClient } from "@/lib/auth-client";
import {
  activeOwnerCount,
  assignableRoles,
  membershipRowActions,
} from "@/lib/membership-actions";
import {
  defaultMemberFilter,
  filterMembers,
  type MemberFilter,
} from "@/lib/list-filter";
import { buildInvitationLink } from "@/lib/invitation-link";
import { roleLabel } from "@/lib/roles";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ListFilterBar } from "@/components/list-filter-bar";
import { WorkspaceShell } from "@/components/workspace-shell";

import { InvitationDeliveryBadge } from "./invitation-delivery-badge";
import { MemberPlayerLink } from "./member-player-link";

const cancelledSchema = z.object({ cancelled: z.literal(true) });
const selectClassName =
  "min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-body text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30";

const statusLabels: Readonly<Record<string, string>> = {
  ACTIVE: "aktiv",
  SUSPENDED: "deaktiviert",
  INVITED: "eingeladen",
};

function messageFrom(error: unknown): string {
  return userFacingErrorMessage(error);
}

const dateFormat = new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeStyle: "short" });

export function MembersRoute({ requestedOrganizationId }: {
  readonly requestedOrganizationId: string | undefined;
}) {
  // Die eigene Kennung entscheidet, welche Zeile ohne Bedienelemente bleibt
  // (`SELF_MEMBERSHIP_CHANGE_FORBIDDEN`). Sie kommt aus der Sitzung, nicht aus
  // der Liste: die Liste nennt keine handelnde Person.
  const session = authClient.useSession();

  return (
    <WorkspaceShell
      lead="Rollen vergeben, Zugänge deaktivieren und offene Einladungen verwalten."
      requestedOrganizationId={requestedOrganizationId}
      title="Mitglieder"
    >
      {(organization) =>
        session.isPending ? (
          <p className="text-body text-slate-400" role="status">Sitzung wird geladen …</p>
        ) : session.data === null ? (
          <p className="text-body text-slate-300" role="status">Melde dich an, um Mitglieder zu verwalten.</p>
        ) : (
          <Members currentUserId={session.data.user.id} organization={organization} />
        )
      }
    </WorkspaceShell>
  );
}

function Members({ currentUserId, organization }: {
  readonly currentUserId: string;
  readonly organization: OrganizationSummary;
}) {
  const queryClient = useQueryClient();
  const mayManageMembers = hasOrganizationPermission(organization.role, "organization:manage_members");
  const membersQuery = useQuery({
    queryKey: ["organization-members", organization.id],
    enabled: mayManageMembers,
    queryFn: ({ signal }) =>
      apiRequest({ path: `/organizations/${organization.id}/members`, schema: organizationMemberListSchema, signal }),
  });
  // Dieselbe Abfrage wie die Spielerseite; die Auswahl der Zuordnung braucht
  // Anzeigename und Kontomarkierung.
  const playersQuery = useQuery({
    queryKey: ["players", organization.id],
    enabled: mayManageMembers,
    queryFn: ({ signal }) =>
      apiRequest({ path: `/organizations/${organization.id}/players`, schema: playerListSchema, signal }),
  });
  const invitationsQuery = useQuery({
    queryKey: ["organization-invitations", organization.id],
    enabled: mayManageMembers,
    queryFn: ({ signal }) =>
      apiRequest({ path: `/organizations/${organization.id}/invitations`, schema: invitationListSchema, signal }),
  });

  const invalidateMembers = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ["organization-members", organization.id] });
  };

  const updateMember = useMutation({
    mutationFn: (input: {
      readonly userId: string;
      readonly data: { readonly role?: OrganizationRole; readonly status?: "ACTIVE" | "SUSPENDED" };
    }) =>
      apiRequest({
        path: `/organizations/${organization.id}/members/${input.userId}`,
        method: "PATCH",
        body: input.data,
        schema: organizationMemberSchema,
      }),
    onSuccess: invalidateMembers,
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) =>
      apiRequest({
        path: `/organizations/${organization.id}/members/${userId}`,
        method: "DELETE",
        schema: z.undefined(),
      }),
  });

  // Aufrufgebundenes `onSuccess` statt eines globalen (wie
  // `runArchive`/`runDelete` in `player-list.tsx`, Task 1): `removeTarget`
  // aus dem Komponenten-State koennte sich zwischen dem Absenden und der
  // Antwort schon auf ein anderes Mitglied verschieben (Dialog geschlossen,
  // neu geoeffnet) -- der Name in der Meldung und das bedingte Schliessen
  // sollen aber zu GENAU diesem Aufruf gehoeren.
  const runRemove = (target: OrganizationMember) => {
    removeMember.mutate(target.userId, {
      onSuccess: async () => {
        await invalidateMembers();
        setRemoveTarget((current) => (current !== null && current.userId === target.userId ? null : current));
        setRemovedAnnouncement(`${target.displayName} wurde aus der Organisation entfernt.`);
      },
    });
  };
  const cancelInvitation = useMutation({
    mutationFn: (invitationId: string) =>
      apiRequest({
        path: `/organizations/${organization.id}/invitations/${invitationId}`,
        method: "DELETE",
        schema: cancelledSchema,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["organization-invitations", organization.id] });
    },
  });
  // Der neue Code wird genau einmal gezeigt — wie beim Erstellen. Er ist
  // der Fallback, falls auch die zweite Mail nicht ankommt.
  const [resent, setResent] = useState<CreatedInvitation | null>(null);
  const resendInvitation = useMutation({
    mutationFn: (invitationId: string) =>
      apiRequest({
        path: `/organizations/${organization.id}/invitations/${invitationId}/resend`,
        method: "POST",
        schema: createdInvitationSchema,
      }),
    onSuccess: async (invitation) => {
      setResent(invitation);
      await queryClient.invalidateQueries({ queryKey: ["organization-invitations", organization.id] });
    },
  });

  // Die Eigentumsübertragung wird nicht nebenbei aus einer Auswahlliste
  // erledigt: Sie nimmt der handelnden Person die höchste Rolle und lässt
  // sich nur von der neuen Inhaberschaft rückgängig machen.
  const [ownerTransfer, setOwnerTransfer] = useState<OrganizationMember | null>(null);
  const [removeTarget, setRemoveTarget] = useState<OrganizationMember | null>(null);
  const [removedAnnouncement, setRemovedAnnouncement] = useState<string | null>(null);
  const [filter, setFilter] = useState<MemberFilter>(defaultMemberFilter);
  // Vor dem Frühausstieg, damit die Hook-Reihenfolge stabil bleibt.
  const visibleMembers = useMemo(
    () => filterMembers(membersQuery.data ?? [], filter),
    [membersQuery.data, filter],
  );

  // Fokusziel nach erfolgreichem Entfernen: die Zeile samt Entfernen-Button
  // verschwindet mit ihr, `useDialogFocusReturn` faende also kein
  // Rueckgabeziel mehr vor. Laeuft erst NACHDEM `ConfirmDialog` seinen
  // eigenen schliessenden Effekt (Fokus-Rueckgabe an den bereits entfernten
  // Button) durchlaufen hat: React fuehrt Effekte von Kindern vor denen der
  // Elternkomponente aus (wie in `player-list.tsx`, Task 1).
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (removedAnnouncement !== null) headingRef.current?.focus();
  }, [removedAnnouncement]);

  if (!mayManageMembers) {
    return (
      <p className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 text-body text-slate-300" role="status">
        Für die Mitgliederverwaltung fehlt dir die Berechtigung. Wende dich an die Inhaberschaft der Organisation.
      </p>
    );
  }

  const members = membersQuery.data ?? [];
  // Der Schutz des letzten aktiven OWNER zaehlt ueber ALLE Mitglieder, nicht
  // ueber die gefilterte Sicht: sonst liesse ein gesetzter Filter die
  // Bedienelemente aufgehen, die er sperren soll.
  const owners = activeOwnerCount(members);
  const isFiltered =
    filter.search.length > 0 ||
    filter.role !== "ALL" ||
    filter.status !== "ALL" ||
    filter.link !== "ALL";

  return (
    <div className="space-y-8">
      <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 sm:p-6">
        <h2 className="font-numerals text-title font-bold text-white" ref={headingRef} tabIndex={-1}>
          Mitglieder
        </h2>
        {updateMember.error !== null ? (
          <p className="text-body text-rose-300" role="alert">{messageFrom(updateMember.error)}</p>
        ) : null}
        {/*
          Immer gemountet (Whole-Branch-Review, Befund 2, wie in
          `player-list.tsx`): eine `role="status"`-Region, die erst nach dem
          Einhaengen befuellt wird, kuendigt Screenreadern nicht zuverlaessig
          an. Leer statt fehlend, solange nichts zu melden ist.
        */}
        <p className="text-body text-slate-300" role="status">{removedAnnouncement ?? ""}</p>
        {membersQuery.isPending ? (
          <p className="text-body text-slate-400">Mitglieder werden geladen …</p>
        ) : membersQuery.isError ? (
          <p className="text-body text-rose-300" role="alert">{messageFrom(membersQuery.error)}</p>
        ) : members.length === 0 ? (
          <p className="text-body text-slate-400">Diese Organisation hat noch keine Mitglieder.</p>
        ) : (
          <>
            <ListFilterBar
              isFiltered={isFiltered}
              onReset={() => setFilter(defaultMemberFilter)}
              onSearchChange={(search) => setFilter((current) => ({ ...current, search }))}
              resultLabel={`${visibleMembers.length} von ${members.length} Mitgliedern`}
              search={filter.search}
              searchId="member-search"
              searchLabel="Mitglied suchen"
              searchPlaceholder="Name oder E-Mail"
              selects={[
                {
                  id: "member-role-filter",
                  label: "Rolle",
                  value: filter.role,
                  onChange: (value) =>
                    setFilter((current) => ({ ...current, role: value as MemberFilter["role"] })),
                  options: [
                    { value: "ALL", label: "Alle" },
                    ...assignableRoles(organization.role).map((role) => ({
                      value: role,
                      label: roleLabel(role),
                    })),
                  ],
                },
                {
                  id: "member-status-filter",
                  label: "Status",
                  value: filter.status,
                  onChange: (value) =>
                    setFilter((current) => ({ ...current, status: value as MemberFilter["status"] })),
                  options: [
                    { value: "ALL", label: "Alle" },
                    { value: "ACTIVE", label: "aktiv" },
                    { value: "SUSPENDED", label: "deaktiviert" },
                    { value: "INVITED", label: "eingeladen" },
                  ],
                },
                {
                  id: "member-link-filter",
                  label: "Spielerprofil",
                  value: filter.link,
                  onChange: (value) =>
                    setFilter((current) => ({ ...current, link: value as MemberFilter["link"] })),
                  options: [
                    { value: "ALL", label: "Alle" },
                    { value: "LINKED", label: "zugeordnet" },
                    { value: "UNLINKED", label: "offen" },
                  ],
                },
              ]}
            />
            {visibleMembers.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-700 p-5 text-body text-slate-400">
                Kein Mitglied passt zu diesen Filtern.
              </p>
            ) : null}
          <ul className="space-y-3">
            {visibleMembers.map((member) => {
              const actions = membershipRowActions({
                actorUserId: currentUserId,
                actorRole: organization.role,
                member,
                activeOwnerCount: owners,
              });
              const pending = updateMember.isPending && updateMember.variables?.userId === member.userId;
              return (
                <li
                  className="grid gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-4 sm:grid-cols-[1fr_auto] sm:items-center"
                  key={member.userId}
                >
                  <div className="min-w-0">
                    <p className="truncate text-body font-semibold text-white">{member.displayName}</p>
                    <p className="truncate text-caption text-slate-400">{member.email}</p>
                    <p className="text-caption text-slate-400">
                      {roleLabel(member.role)} · {statusLabels[member.status] ?? member.status}
                    </p>
                    {actions.blockedReason !== null ? (
                      <p className="mt-1 text-caption text-slate-500">{actions.blockedReason}</p>
                    ) : null}
                    <p className="mt-1 text-caption text-slate-400">
                      {member.player === null
                        ? "Kein Spielerprofil zugeordnet"
                        : `Spielerprofil: ${member.player.displayName}`}
                    </p>
                  </div>
                  <div className="grid gap-2 sm:w-64">
                    {actions.canChangeRole || actions.canChangeStatus ? (
                      <>
                        <label className="block space-y-1">
                          <span className="text-caption font-semibold tracking-[0.14em] text-slate-500 uppercase">
                            Rolle
                          </span>
                          <select
                            className={selectClassName}
                            disabled={!actions.canChangeRole || pending}
                            onChange={(event) => {
                              const role = event.target.value as OrganizationRole;
                              if (role === member.role) return;
                              if (role === "OWNER") {
                                setOwnerTransfer(member);
                                return;
                              }
                              updateMember.mutate({ userId: member.userId, data: { role } });
                            }}
                            value={member.role}
                          >
                            {assignableRoles(organization.role).map((role) => (
                              <option key={role} value={role}>{roleLabel(role)}</option>
                            ))}
                          </select>
                        </label>
                        <Button
                          disabled={!actions.canChangeStatus || pending}
                          onClick={() =>
                            updateMember.mutate({
                              userId: member.userId,
                              data: { status: member.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED" },
                            })
                          }
                          type="button"
                          variant="outline"
                        >
                          {member.status === "SUSPENDED" ? "Zugang reaktivieren" : "Zugang deaktivieren"}
                        </Button>
                      </>
                    ) : null}
                    <MemberPlayerLink
                      member={member}
                      organizationId={organization.id}
                      players={playersQuery.data ?? []}
                    />
                    {actions.canRemove ? (
                      <Button
                        onClick={() => {
                          removeMember.reset();
                          setRemovedAnnouncement(null);
                          setRemoveTarget(member);
                        }}
                        type="button"
                        variant="outline"
                      >
                        Entfernen
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          </>
        )}
      </section>

      <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 sm:p-6">
        <h2 className="font-numerals text-title font-bold text-white">Offene Einladungen</h2>
        <p className="text-body text-slate-400">
          Neue Einladungen verschickst du auf der Seite <span className="text-slate-300">Spieler</span>.
        </p>
        {cancelInvitation.error !== null ? (
          <p className="text-body text-rose-300" role="alert">{messageFrom(cancelInvitation.error)}</p>
        ) : null}
        {resendInvitation.error !== null ? (
          <p className="text-body text-rose-300" role="alert">{messageFrom(resendInvitation.error)}</p>
        ) : null}
        {invitationsQuery.isPending ? (
          <p className="text-body text-slate-400">Einladungen werden geladen …</p>
        ) : invitationsQuery.isError ? (
          <p className="text-body text-rose-300" role="alert">{messageFrom(invitationsQuery.error)}</p>
        ) : (invitationsQuery.data ?? []).length === 0 ? (
          <p className="text-body text-slate-400">Keine offene Einladung.</p>
        ) : (
          <ul className="space-y-3">
            {(invitationsQuery.data ?? []).map((invitation: Invitation) => (
              <li
                className="grid gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-4"
                key={invitation.id}
              >
                <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-body font-semibold text-white">{invitation.email}</p>
                    <p className="text-caption text-slate-400">
                      {roleLabel(invitation.role)} · gültig bis {dateFormat.format(invitation.expiresAt)}
                    </p>
                    <p className="mt-1"><InvitationDeliveryBadge delivery={invitation.lastDelivery} /></p>
                  </div>
                  <div className="grid gap-2 sm:w-64">
                    <Button
                      disabled={resendInvitation.isPending && resendInvitation.variables === invitation.id}
                      onClick={() => resendInvitation.mutate(invitation.id)}
                      type="button"
                    >
                      Erneut senden
                    </Button>
                    <Button
                      disabled={cancelInvitation.isPending && cancelInvitation.variables === invitation.id}
                      onClick={() => cancelInvitation.mutate(invitation.id)}
                      type="button"
                      variant="outline"
                    >
                      Einladung zurückziehen
                    </Button>
                  </div>
                </div>
                {resent?.id === invitation.id ? (
                  <div className="space-y-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4">
                    <p className="text-body text-emerald-100">
                      Neue Mail an {resent.email} ist unterwegs. Der bisherige Code ist damit ungültig. Falls die Mail
                      nicht ankommt, kannst du diesen Link oder Code weitergeben.
                    </p>
                    <label
                      className="block text-caption font-semibold tracking-[0.14em] text-slate-400 uppercase"
                      htmlFor={`resent-link-${invitation.id}`}
                    >
                      Neuer Einladungslink
                    </label>
                    <input
                      id={`resent-link-${invitation.id}`}
                      className={`${selectClassName} font-mono`}
                      readOnly
                      value={buildInvitationLink(window.location.origin, resent.id, resent.claimToken)}
                    />
                    <label
                      className="block text-caption font-semibold tracking-[0.14em] text-slate-400 uppercase"
                      htmlFor={`resent-code-${invitation.id}`}
                    >
                      Neuer Einladungscode
                    </label>
                    <input
                      id={`resent-code-${invitation.id}`}
                      className={`${selectClassName} font-mono`}
                      readOnly
                      value={resent.claimToken}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <OwnerTransferDialog
        member={ownerTransfer}
        onCancel={() => setOwnerTransfer(null)}
        onConfirm={() => {
          if (ownerTransfer === null) return;
          updateMember.mutate({ userId: ownerTransfer.userId, data: { role: "OWNER" } });
          setOwnerTransfer(null);
        }}
        pending={updateMember.isPending}
      />

      <ConfirmDialog
        confirmLabel="Entfernen"
        confirmVariant="danger"
        description={
          removeTarget === null
            ? ""
            : `${removeTarget.displayName} verliert den Zugang zu dieser Organisation. Eine Spieler-Verknüpfung wird gelöst. Das Konto bleibt bestehen, und du kannst die Person später wieder einladen. Wenn du den Zugang nur vorübergehend sperren willst, nutze «Zugang deaktivieren».`
        }
        error={removeMember.isError ? userFacingErrorMessage(removeMember.error) : null}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => {
          if (removeTarget === null) return;
          runRemove(removeTarget);
        }}
        open={removeTarget !== null}
        pending={removeMember.isPending}
        title="Mitglied entfernen"
      />
    </div>
  );
}

/**
 * Die Übertragung des Eigentums bekommt eine eigene Bestätigung, die
 * ausspricht, was sie bedeutet: die Zielperson erhält jedes Recht der
 * Organisation, und zurücknehmen kann das nur noch eine Inhaberschaft.
 */
function OwnerTransferDialog({ member, onCancel, onConfirm, pending }: {
  readonly member: OrganizationMember | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly pending: boolean;
}) {
  if (member === null) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
      <div
        aria-describedby="owner-transfer-description"
        aria-labelledby="owner-transfer-title"
        aria-modal="true"
        className="w-full max-w-lg space-y-5 rounded-2xl border border-ring-red-deep/50 bg-slate-950 p-5 text-white shadow-2xl sm:p-6"
        role="dialog"
      >
        <div>
          <h3 className="font-numerals text-title font-bold" id="owner-transfer-title">Eigentum übertragen</h3>
          <p className="mt-2 text-body text-slate-300" id="owner-transfer-description">
            {member.displayName} wird Inhaberin oder Inhaber dieser Organisation und erhält damit jedes Recht,
            einschliesslich der Mitgliederverwaltung. Deine eigene Rolle bleibt bestehen; zurücknehmen lässt sich
            die Übertragung nur durch eine Inhaberschaft.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Button disabled={pending} onClick={onCancel} type="button" variant="outline">Abbrechen</Button>
          <Button disabled={pending} onClick={onConfirm} type="button" variant="danger">
            Eigentum übertragen
          </Button>
        </div>
      </div>
    </div>
  );
}
