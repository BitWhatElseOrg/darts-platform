"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { hasOrganizationPermission, type OrganizationRole } from "@darts-platform/domain";
import {
  invitationListSchema,
  organizationMemberListSchema,
  organizationMemberSchema,
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
import { roleLabel } from "@/lib/roles";
import { WorkspaceShell } from "@/components/workspace-shell";

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

  // Die Eigentumsübertragung wird nicht nebenbei aus einer Auswahlliste
  // erledigt: Sie nimmt der handelnden Person die höchste Rolle und lässt
  // sich nur von der neuen Inhaberschaft rückgängig machen.
  const [ownerTransfer, setOwnerTransfer] = useState<OrganizationMember | null>(null);

  if (!mayManageMembers) {
    return (
      <p className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 text-body text-slate-300" role="status">
        Für die Mitgliederverwaltung fehlt dir die Berechtigung. Wende dich an die Inhaberschaft der Organisation.
      </p>
    );
  }

  const members = membersQuery.data ?? [];
  const owners = activeOwnerCount(members);

  return (
    <div className="space-y-8">
      <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 sm:p-6">
        <h2 className="font-numerals text-title font-bold text-white">Mitglieder</h2>
        {updateMember.error !== null ? (
          <p className="text-body text-rose-300" role="alert">{messageFrom(updateMember.error)}</p>
        ) : null}
        {membersQuery.isPending ? (
          <p className="text-body text-slate-400">Mitglieder werden geladen …</p>
        ) : membersQuery.isError ? (
          <p className="text-body text-rose-300" role="alert">{messageFrom(membersQuery.error)}</p>
        ) : members.length === 0 ? (
          <p className="text-body text-slate-400">Diese Organisation hat noch keine Mitglieder.</p>
        ) : (
          <ul className="space-y-3">
            {members.map((member) => {
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
                  </div>
                  {actions.canChangeRole || actions.canChangeStatus ? (
                    <div className="grid gap-2 sm:w-64">
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
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
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
                className="grid gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-4 sm:grid-cols-[1fr_auto] sm:items-center"
                key={invitation.id}
              >
                <div className="min-w-0">
                  <p className="truncate text-body font-semibold text-white">{invitation.email}</p>
                  <p className="text-caption text-slate-400">
                    {roleLabel(invitation.role)} · gültig bis {dateFormat.format(invitation.expiresAt)}
                  </p>
                </div>
                <Button
                  disabled={cancelInvitation.isPending && cancelInvitation.variables === invitation.id}
                  onClick={() => cancelInvitation.mutate(invitation.id)}
                  type="button"
                  variant="outline"
                >
                  Einladung zurückziehen
                </Button>
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
        className="w-full max-w-lg space-y-5 rounded-2xl border border-amber-400/50 bg-slate-950 p-5 text-white shadow-2xl sm:p-6"
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
          <Button className="bg-amber-500 text-slate-950 hover:bg-amber-400" disabled={pending} onClick={onConfirm} type="button">
            Eigentum übertragen
          </Button>
        </div>
      </div>
    </div>
  );
}
