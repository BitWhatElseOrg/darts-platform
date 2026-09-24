"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { hasOrganizationPermission } from "@darts-platform/domain";
import {
  organizationSummarySchema,
  updateOrganizationSchema,
  type OrganizationSummary,
  type UpdateOrganizationInput,
} from "@darts-platform/schemas";
import { Button } from "@darts-platform/ui";

import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { WorkspaceShell } from "@/components/workspace-shell";

const inputClassName =
  "min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-body text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30";
const labelClassName = "block text-body font-medium text-slate-300";
const readOnlyLabelClassName = "block text-caption font-semibold tracking-[0.14em] text-slate-500 uppercase";

export function OrganizationSettingsRoute({ requestedOrganizationId }: {
  readonly requestedOrganizationId: string | undefined;
}) {
  return (
    <WorkspaceShell
      lead="Stammdaten der Organisation pflegen."
      requestedOrganizationId={requestedOrganizationId}
      title="Organisation"
    >
      {(organization) => <OrganizationSettings organization={organization} />}
    </WorkspaceShell>
  );
}

function OrganizationSettings({ organization }: { readonly organization: OrganizationSummary }) {
  const canUpdate = hasOrganizationPermission(organization.role, "organization:update");
  const canDelete = hasOrganizationPermission(organization.role, "organization:delete");

  return (
    <div className="space-y-8">
      <OrganizationDetails canUpdate={canUpdate} organization={organization} />
      {canDelete ? <DangerZone organization={organization} /> : null}
    </div>
  );
}

function OrganizationDetails({ organization, canUpdate }: {
  readonly organization: OrganizationSummary;
  readonly canUpdate: boolean;
}) {
  const queryClient = useQueryClient();
  const form = useForm<UpdateOrganizationInput>({
    resolver: zodResolver(updateOrganizationSchema),
    defaultValues: {
      name: organization.name,
      timezone: organization.timezone,
      locale: organization.locale,
    },
  });
  const updateOrganization = useMutation({
    mutationFn: (data: UpdateOrganizationInput) =>
      apiRequest({
        path: `/organizations/${organization.id}`,
        method: "PATCH",
        body: data,
        schema: organizationSummarySchema,
      }),
    onSuccess: async () => {
      // Dieselbe Abfrage, die auch die Uebersicht und `WorkspaceShell` fuellt
      // (`useTournamentOrganization`) — sie zeigt danach den neuen Namen.
      await queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
  });

  if (!canUpdate) {
    return (
      <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 sm:p-6">
        <h2 className="font-numerals text-title font-bold text-white">Stammdaten</h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className={readOnlyLabelClassName}>Name</dt>
            <dd className="text-body text-slate-200">{organization.name}</dd>
          </div>
          <div>
            <dt className={readOnlyLabelClassName}>Zeitzone</dt>
            <dd className="text-body text-slate-200">{organization.timezone}</dd>
          </div>
          <div>
            <dt className={readOnlyLabelClassName}>Sprache</dt>
            <dd className="text-body text-slate-200">{organization.locale}</dd>
          </div>
          <div>
            <dt className={readOnlyLabelClassName}>Kurzname</dt>
            <dd className="text-body text-slate-200">{organization.slug}</dd>
          </div>
        </dl>
      </section>
    );
  }

  const { name: nameError, timezone: timezoneError, locale: localeError } = form.formState.errors;

  return (
    <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 sm:p-6">
      <h2 className="font-numerals text-title font-bold text-white">Stammdaten</h2>
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(event) => void form.handleSubmit((data) => updateOrganization.mutate(data))(event)}
      >
        <div className="space-y-2">
          <label className={labelClassName} htmlFor="organization-name">Name</label>
          <input
            aria-describedby={nameError ? "organization-name-error" : undefined}
            aria-invalid={nameError ? true : undefined}
            className={inputClassName}
            id="organization-name"
            {...form.register("name")}
          />
          {nameError ? (
            <p className="text-body text-rose-300" id="organization-name-error" role="alert">
              Bitte einen Namen mit mindestens 2 Zeichen angeben.
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <label className={labelClassName} htmlFor="organization-timezone">Zeitzone</label>
          <input
            aria-describedby={timezoneError ? "organization-timezone-error" : undefined}
            aria-invalid={timezoneError ? true : undefined}
            className={inputClassName}
            id="organization-timezone"
            {...form.register("timezone")}
          />
          {timezoneError ? (
            <p className="text-body text-rose-300" id="organization-timezone-error" role="alert">
              Bitte eine Zeitzone angeben.
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <label className={labelClassName} htmlFor="organization-locale">Sprache</label>
          <input
            aria-describedby={localeError ? "organization-locale-error" : undefined}
            aria-invalid={localeError ? true : undefined}
            className={inputClassName}
            id="organization-locale"
            {...form.register("locale")}
          />
          {localeError ? (
            <p className="text-body text-rose-300" id="organization-locale-error" role="alert">
              Bitte eine Sprache mit mindestens 2 Zeichen angeben.
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <span className={readOnlyLabelClassName}>Kurzname</span>
          <p className="text-body text-slate-200">{organization.slug}</p>
          <p className="text-caption text-slate-500">
            Der Kurzname steht in Links und Einladungen und lässt sich nicht ändern.
          </p>
        </div>
        <div className="sm:col-span-2">
          <Button disabled={updateOrganization.isPending} type="submit">Speichern</Button>
        </div>
      </form>
      {updateOrganization.isError ? (
        <p className="text-body text-rose-300" role="alert">{userFacingErrorMessage(updateOrganization.error)}</p>
      ) : null}
      {updateOrganization.isSuccess ? (
        <p className="text-body text-emerald-300" role="status">Gespeichert.</p>
      ) : null}
    </section>
  );
}

/**
 * Endgueltiges Loeschen der Organisation. Das Eingabefeld mit der
 * Namensbestaetigung liegt als `children` in `ConfirmDialog`, das selbst
 * dauerhaft im DOM bleibt (siehe dessen Dokumentation) — sein `children`-Prop
 * aber wird hier nur gerendert, waehrend der Dialog offen ist. Ein staendig
 * gemountetes, nur per CSS verstecktes Feld mit einem Label, das "Namen"
 * enthaelt, waere sonst ein zweiter Treffer fuer jeden strikten Locator auf
 * das Stammdaten-Feld "Name" — genau das ist in dieser Spec schon einmal
 * passiert.
 */
function DangerZone({ organization }: { readonly organization: OrganizationSummary }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  const deleteOrganization = useMutation({
    mutationFn: (data: { readonly confirmName: string }) =>
      apiRequest({
        path: `/organizations/${organization.id}`,
        method: "DELETE",
        body: data,
        schema: z.undefined(),
      }),
    onSuccess: async () => {
      // Die Organisation und alles darunter existiert nicht mehr; jede
      // zwischengespeicherte Abfrage zu ihrer ID (Spieler, Teams,
      // Mitglieder, Matches, ...) wuerde bei einem naechsten Refetch gegen
      // ein 404 laufen und wird deshalb entfernt statt bloss invalidiert.
      queryClient.removeQueries({
        predicate: (query) => query.queryKey.includes(organization.id),
      });
      await queryClient.invalidateQueries({ queryKey: ["organizations"] });
      setOpen(false);
      // Kein explizites Zuruecksetzen der gemerkten Organisationsauswahl
      // (`lib/organization-selection.ts`): `resolveOrganization` prueft die
      // gemerkte ID bei jedem Lesen gegen die frische Serverliste. Die
      // geloeschte Organisation kommt darin nicht mehr vor, also faellt die
      // Auswahl automatisch auf eine andere zugaengliche Organisation (oder
      // `null`) zurueck, sobald die Uebersicht die Liste neu laedt.
      router.push("/");
    },
  });

  return (
    <section className="space-y-4 rounded-2xl border border-ring-red-deep/40 bg-slate-900/80 p-5 sm:p-6">
      <h2 className="font-numerals text-title font-bold text-white">Organisation löschen</h2>
      <p className="text-body text-slate-300">
        Löscht die Organisation mit allen Spielern, Turnieren, Matches, Ligen, Statistiken und
        Mitgliedschaften. Das lässt sich nicht rückgängig machen.
      </p>
      <Button
        onClick={() => {
          deleteOrganization.reset();
          setConfirmName("");
          setOpen(true);
        }}
        type="button"
        variant="danger"
      >
        Organisation löschen
      </Button>

      <ConfirmDialog
        confirmDisabled={confirmName.trim() !== organization.name}
        confirmLabel="Organisation löschen"
        confirmVariant="danger"
        description="Löscht die Organisation mit allen Spielern, Turnieren, Matches, Ligen, Statistiken und Mitgliedschaften. Das lässt sich nicht rückgängig machen."
        error={deleteOrganization.isError ? userFacingErrorMessage(deleteOrganization.error) : null}
        onCancel={() => setOpen(false)}
        onConfirm={() => deleteOrganization.mutate({ confirmName: confirmName.trim() })}
        open={open}
        pending={deleteOrganization.isPending}
        title="Organisation löschen"
      >
        {open ? (
          <div className="space-y-2">
            <label className={labelClassName} htmlFor="organization-delete-confirm-name">
              {`Zur Bestätigung den Namen „${organization.name}" eintippen`}
            </label>
            <input
              className={inputClassName}
              id="organization-delete-confirm-name"
              onChange={(event) => setConfirmName(event.target.value)}
              value={confirmName}
            />
          </div>
        ) : null}
      </ConfirmDialog>
    </section>
  );
}
