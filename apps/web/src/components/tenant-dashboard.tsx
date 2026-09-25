"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { hasOrganizationPermission } from "@darts-platform/domain";
import {
  createOrganizationSchema,
  invitationListSchema,
  matchListSchema,
  organizationCapabilitiesSchema,
  organizationListSchema,
  organizationSummarySchema,
  type OrganizationSummary,
} from "@darts-platform/schemas";
import { Button, buttonVariants, cn } from "@darts-platform/ui";

import {
  readOrganizationSelection,
  readServerOrganizationSelection,
  resolveOrganization,
  subscribeOrganizationSelection,
  writeOrganizationSelection,
} from "@/lib/organization-selection";

import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";
import { ApiClientError } from "@/lib/api-error";
import { roleLabel } from "@/lib/roles";
import { MatchList } from "@/components/match/match-list";

const organizationFormSchema = createOrganizationSchema.pick({
  name: true,
  slug: true,
});

type OrganizationFormData = z.infer<typeof organizationFormSchema>;

const acceptedSchema = z.object({ accepted: z.literal(true) });
const inputClassName =
  "min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-body text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30";
const labelClassName = "block text-body font-medium text-slate-300";

function messageFrom(error: unknown): string {
  return userFacingErrorMessage(error);
}

/**
 * Was ueber den Weg zur Neuanlage bekannt ist. `pending` und `unknown`
 * bleiben getrennt: beim Warten gibt es nichts zu melden, bei einer
 * gescheiterten Abfrage dagegen sehr wohl — sonst verschwindet der Weg
 * stillschweigend und die Uebersicht rät zu einem Anruf beim Betrieb, den
 * niemand verlangt hat.
 */
type SelfServiceState = "pending" | "unknown" | "open" | "closed";

interface TenantDashboardProps {
  readonly userName: string;
  readonly userEmail: string;
  readonly onSignOut: () => Promise<void>;
}

export function TenantDashboard({
  userName,
  userEmail,
  onSignOut,
}: TenantDashboardProps) {
  const queryClient = useQueryClient();
  const [activeOrganizationId, setActiveOrganizationId] = useState<string | null>(
    null,
  );
  const [invitationClaims, setInvitationClaims] = useState<
    Readonly<Record<string, string>>
  >({});
  const organizationsQuery = useQuery({
    queryKey: ["organizations"],
    queryFn: ({ signal }) =>
      apiRequest({ path: "/organizations", schema: organizationListSchema, signal }),
  });
  const invitationsQuery = useQuery({
    queryKey: ["invitations"],
    queryFn: ({ signal }) =>
      apiRequest({ path: "/invitations", schema: invitationListSchema, signal }),
  });
  // Ob es den Weg zur Neuanlage ueberhaupt gibt, entscheidet der Server
  // (`ALLOW_SELF_SERVICE_ORGANIZATIONS`). Das kostet eine eigene Abfrage je
  // Seitenaufruf, und das bleibt so: Der Schalter steht in der Umgebung der
  // API. Ihn zusaetzlich als `NEXT_PUBLIC_...` zu fuehren, hiesse denselben
  // Betriebszustand an zwei Orten zu pflegen, und die Startseite rendert
  // statisch (ADR 0014), kann ihn also nicht beim Rendern holen. Die
  // Abfrage laeuft parallel zu den beiden anderen und bleibt fuenf Minuten
  // gueltig.
  //
  // Solange die Antwort aussteht, gilt «gesperrt»: ein Bedienelement, das
  // gleich wieder verschwindet, ist schlimmer als eines, das kurz spaeter
  // erscheint. Scheitert die Abfrage,
  // ist das kein Bescheid: dann sagt die Oberflaeche, dass sie es nicht
  // weiss, statt eine Sperre zu behaupten, die niemand verhaengt hat.
  const capabilitiesQuery = useQuery({
    queryKey: ["organization-capabilities"],
    queryFn: ({ signal }) =>
      apiRequest({
        path: "/organizations/capabilities",
        schema: organizationCapabilitiesSchema,
        signal,
      }),
    staleTime: 5 * 60_000,
  });
  const selfService: SelfServiceState = capabilitiesQuery.isError
    ? "unknown"
    : capabilitiesQuery.data === undefined
      ? "pending"
      : capabilitiesQuery.data.selfServiceEnabled
        ? "open"
        : "closed";

  // Dieselbe gemerkte Auswahl wie auf den Arbeitsflächen
  // (`use-tournament-organization.ts`). Vorher hielt die Startseite sie nur
  // im lokalen Zustand: wer von hier wegnavigierte und über «Übersicht»
  // zurückkam, sah wieder die erste Organisation der Liste.
  const rememberedId = useSyncExternalStore(
    subscribeOrganizationSelection,
    readOrganizationSelection,
    readServerOrganizationSelection,
  );
  const activeOrganization = resolveOrganization({
    organizations: organizationsQuery.data,
    requestedId: activeOrganizationId ?? undefined,
    rememberedId,
  });
  const resolvedActiveOrganizationId = activeOrganization?.id ?? null;
  useEffect(() => {
    if (resolvedActiveOrganizationId !== null) writeOrganizationSelection(resolvedActiveOrganizationId);
  }, [resolvedActiveOrganizationId]);
  const tournamentOrganization =
    activeOrganization !== null &&
    hasOrganizationPermission(activeOrganization.role, "tournament:update")
      ? activeOrganization
      : organizationsQuery.data?.find((organization) =>
          hasOrganizationPermission(organization.role, "tournament:update"),
        );

  const acceptInvitation = useMutation({
    mutationFn: (input: { readonly invitationId: string; readonly claimToken: string }) =>
      apiRequest({
        path: `/invitations/${input.invitationId}/accept`,
        method: "POST",
        body: { claimToken: input.claimToken },
        schema: acceptedSchema,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["organizations"] }),
        queryClient.invalidateQueries({ queryKey: ["invitations"] }),
      ]);
    },
  });

  return (
    <div className="w-full space-y-6">
      <section className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-body font-semibold text-white">{userName}</p>
          <p className="text-body text-slate-400">{userEmail}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {tournamentOrganization !== undefined ? (
            <Link
              className={buttonVariants({ variant: "outline" })}
              href={`/turniere?organisation=${tournamentOrganization.id}`}
            >
              Turnierleitung
            </Link>
          ) : null}
          <Button variant="outline" onClick={() => void onSignOut()}>
            Abmelden
          </Button>
        </div>
      </section>

      {invitationsQuery.data?.length ? (
        <section className="rounded-2xl border border-amber-300/30 bg-amber-300/10 p-5">
          <h2 className="font-semibold text-amber-100">Offene Einladungen</h2>
          <div className="mt-3 space-y-3">
            {invitationsQuery.data.map((invitation) => (
              <div
                className="grid gap-3 rounded-xl bg-slate-950/40 p-4 sm:grid-cols-[1fr_minmax(16rem,1fr)_auto] sm:items-end"
                key={invitation.id}
              >
                <p className="text-body text-slate-200">
                  {invitation.organizationName ?? "Organisation"} · {roleLabel(invitation.role)}
                </p>
                <div className="space-y-2">
                  <label
                    className={labelClassName}
                    htmlFor={`invitation-claim-${invitation.id}`}
                  >
                    Einladungscode
                  </label>
                  <input
                    id={`invitation-claim-${invitation.id}`}
                    className={`${inputClassName} font-mono`}
                    autoComplete="off"
                    onChange={(event) =>
                      setInvitationClaims((current) => ({
                        ...current,
                        [invitation.id]: event.target.value,
                      }))
                    }
                    value={invitationClaims[invitation.id] ?? ""}
                  />
                </div>
                <Button
                  disabled={acceptInvitation.isPending}
                  onClick={() =>
                    acceptInvitation.mutate({
                      invitationId: invitation.id,
                      claimToken: invitationClaims[invitation.id] ?? "",
                    })
                  }
                >
                  Annehmen
                </Button>
              </div>
            ))}
          </div>
          {acceptInvitation.isError ? (
            <p role="alert" className="mt-3 text-body text-rose-200">
              Einladungscode ungültig oder Einladung nicht mehr verfügbar.
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(18rem,0.75fr)_minmax(0,1.5fr)]">
        <OrganizationsPanel
          activeOrganizationId={resolvedActiveOrganizationId}
          organizations={organizationsQuery.data ?? []}
          onSelect={setActiveOrganizationId}
          selfService={selfService}
          onRetryCapabilities={() => {
            void capabilitiesQuery.refetch();
          }}
        />

        {activeOrganization === null ? (
          <section className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">
            {/* Nur ein Bescheid des Servers darf den Weg zur
                Plattformverwaltung schicken. Solange die Abfrage laeuft
                (`pending`) oder gescheitert ist (`unknown`), bleibt der
                Satz neutral. */}
            {selfService === "open"
              ? "Erstelle eine Organisation, um Spieler und Matches zu verwalten."
              : selfService === "closed"
                ? "Du gehörst noch keiner Organisation an. Nimm eine Einladung an oder wende dich an die Plattformverwaltung."
                : "Du gehörst noch keiner Organisation an. Nimm eine Einladung an."}
          </section>
        ) : (
          <OrganizationOverview organization={activeOrganization} />
        )}
      </div>
    </div>
  );
}

function OrganizationsPanel({
  organizations,
  activeOrganizationId,
  onSelect,
  selfService,
  onRetryCapabilities,
}: {
  readonly organizations: readonly OrganizationSummary[];
  readonly activeOrganizationId: string | null;
  readonly onSelect: (id: string) => void;
  readonly selfService: SelfServiceState;
  readonly onRetryCapabilities: () => void;
}) {
  const queryClient = useQueryClient();
  // Eine Organisation legt man einmal an, nicht bei jedem Besuch. Das
  // Formular bleibt darum eingeklappt und gibt den Platz der Liste, die
  // taeglich gebraucht wird.
  const [formOpen, setFormOpen] = useState(false);
  const form = useForm<OrganizationFormData>({
    resolver: zodResolver(organizationFormSchema),
    defaultValues: { name: "", slug: "" },
  });
  const createOrganization = useMutation({
    mutationFn: (data: OrganizationFormData) =>
      apiRequest({
        path: "/organizations",
        method: "POST",
        body: data,
        schema: organizationSummarySchema,
      }),
    onSuccess: async (organization) => {
      form.reset();
      setFormOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["organizations"] });
      onSelect(organization.id);
    },
  });
  const submit = form.handleSubmit((data) => createOrganization.mutate(data));
  // Der Server entscheidet, ob es diesen Weg gibt. Ein Formular, das
  // zuverlaessig scheitert, ist schlechter als ein ehrlicher Satz.
  const selfServiceDisabled =
    createOrganization.error instanceof ApiClientError &&
    createOrganization.error.code === "SELF_SERVICE_ORGANIZATIONS_DISABLED";

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
      <h2 className="font-numerals text-title-sm font-bold text-white">Organisationen</h2>
      <div className="mt-4 space-y-2">
        {organizations.map((organization) => (
          <button
            className={cn(
              "min-h-12 w-full rounded-xl border px-4 text-left text-body transition",
              organization.id === activeOrganizationId
                ? "border-emerald-400 bg-emerald-400/10 text-white"
                : "border-slate-800 text-slate-300 hover:border-slate-600",
            )}
            key={organization.id}
            onClick={() => onSelect(organization.id)}
            type="button"
          >
            <span className="block font-semibold">{organization.name}</span>
            <span className="text-caption text-slate-400">{roleLabel(organization.role)}</span>
          </button>
        ))}
      </div>

      {selfService === "unknown" ? (
        <div className="mt-4 border-t border-slate-800 pt-4">
          <p className="text-body text-slate-400" role="alert">
            Ob du eine Organisation anlegen kannst, liess sich nicht laden.
          </p>
          <Button
            className="mt-3 w-full"
            onClick={onRetryCapabilities}
            type="button"
            variant="outline"
          >
            Erneut versuchen
          </Button>
        </div>
      ) : selfService === "open" ? (
        <div className="mt-4 border-t border-slate-800 pt-4">
          <button
            aria-controls="organization-create"
            aria-expanded={formOpen}
            className="flex min-h-11 w-full items-center gap-2 rounded-xl text-left text-body font-medium text-slate-400 transition hover:text-emerald-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
            onClick={() => setFormOpen((open) => !open)}
            type="button"
          >
            <span aria-hidden="true" className="text-title-sm leading-none">
              {formOpen ? "−" : "+"}
            </span>
            Neue Organisation
          </button>

          <div id="organization-create">
            {!formOpen ? null : selfServiceDisabled ? (
              // Zwischen Laden der Faehigkeiten und Absenden kann der
              // Betrieb den Weg geschlossen haben. Dann zaehlt die Antwort
              // des Servers, nicht der zuvor geholte Bescheid.
              <p className="pb-2 text-body text-slate-400" role="status">
                {messageFrom(createOrganization.error)}
              </p>
            ) : (
              <form className="space-y-3 pt-2" onSubmit={(event) => void submit(event)}>
                <div className="space-y-2">
                  <label className={labelClassName} htmlFor="organization-name">Organisationsname</label>
                  {/* Kein `autoFocus`: anders als in einem Dialog bleibt der
                      Ausloeser sichtbar, der Fokus gehoert also dorthin. Auf
                      dem Telefon fuhr sonst beim Aufklappen die Tastatur
                      hoch und verdeckte die halbe Liste. */}
                  <input id="organization-name" className={inputClassName} placeholder="Vereinsname" {...form.register("name")} />
                </div>
                <div className="space-y-2">
                  <label className={labelClassName} htmlFor="organization-slug">Organisationskürzel</label>
                  <input id="organization-slug" className={inputClassName} placeholder="club-slug" {...form.register("slug")} />
                </div>
                {createOrganization.isError ? (
                  <p role="alert" className="text-body text-rose-300">
                    {messageFrom(createOrganization.error)}
                  </p>
                ) : null}
                <Button className="w-full" disabled={createOrganization.isPending} type="submit">
                  Erstellen
                </Button>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function OrganizationOverview({
  organization,
}: {
  readonly organization: OrganizationSummary;
}) {
  const matchesQuery = useQuery({
    queryKey: ["matches", organization.id],
    queryFn: ({ signal }) =>
      apiRequest({ path: `/organizations/${organization.id}/matches`, schema: matchListSchema, signal }),
    refetchInterval: 10_000,
  });
  const organisationParam = `?organisation=${organization.id}`;

  return (
    <section className="space-y-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 sm:p-6">
      <div className="border-b border-slate-800 pb-5">
        <h2 className="font-numerals text-title font-bold text-white">{organization.name}</h2>
        <p className="mt-1 text-body text-slate-400">{organization.slug} · {roleLabel(organization.role)}</p>
      </div>

      <nav className="grid gap-3 sm:grid-cols-2">
        <OverviewLink
          href={`/spieler${organisationParam}`}
          title="Spieler"
          description="Kader pflegen und Profile öffnen"
        />
        <OverviewLink
          href={`/teams${organisationParam}`}
          title="Teams"
          description="Mannschaften und Kader für den Ligabetrieb"
        />
        <OverviewLink
          href={`/matches${organisationParam}`}
          title="Matches"
          description="Boards anlegen, Match starten, Partien verfolgen"
        />
        <OverviewLink
          href={`/liga${organisationParam}`}
          title="Liga"
          description="Wettbewerbe, Begegnungen und Spielrapporte"
        />
        {/* Nur fuer Rollen, die Mitglieder verwalten duerfen — der Endpunkt
            weist alle anderen ohnehin ab, und ein Link ins Leere hilft
            niemandem. Die Autorisierung bleibt serverseitig. */}
        {hasOrganizationPermission(organization.role, "organization:manage_members") ? (
          <OverviewLink
            href={`/mitglieder${organisationParam}`}
            title="Mitglieder"
            description="Rollen, Zugänge und Einladungen"
          />
        ) : null}
        {hasOrganizationPermission(organization.role, "organization:update") ? (
          <OverviewLink
            href={`/organisation${organisationParam}`}
            title="Organisation"
            description="Name, Zeitzone, Sprache und Löschen"
          />
        ) : null}
      </nav>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-body font-semibold text-slate-200">Laufende Matches</h3>
          <Link
            className="text-caption font-semibold text-emerald-300 transition hover:text-emerald-200"
            href={`/matches${organisationParam}`}
          >
            Alle Matches
          </Link>
        </div>
        {matchesQuery.isPending ? (
          <p className="text-body text-slate-400">Matches werden geladen …</p>
        ) : matchesQuery.isError ? (
          <p className="text-body text-rose-300" role="alert">{messageFrom(matchesQuery.error)}</p>
        ) : (
          <MatchList limit={5} matches={matchesQuery.data ?? []} organizationId={organization.id} variant="compact" />
        )}
      </div>
    </section>
  );
}

function OverviewLink({
  href,
  title,
  description,
}: {
  readonly href: string;
  readonly title: string;
  readonly description: string;
}) {
  return (
    <Link
      className="flex min-h-16 flex-col justify-center gap-0.5 rounded-xl border border-slate-800 bg-slate-950/50 px-4 py-3 transition hover:border-emerald-400/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
      href={href}
    >
      <span className="text-body font-semibold text-white">{title}</span>
      <span className="text-caption text-slate-400">{description}</span>
    </Link>
  );
}
