"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

import type { OrganizationSummary } from "@darts-platform/schemas";

import { userFacingErrorMessage } from "@/lib/api-client";
import { useTournamentOrganization } from "./tournament/use-tournament-organization";

const selectClassName =
  "min-h-11 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30";

export function WorkspaceShell({
  requestedOrganizationId,
  title,
  lead,
  children,
}: {
  readonly requestedOrganizationId: string | undefined;
  readonly title: string;
  readonly lead: string;
  readonly children: (organization: OrganizationSummary) => ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { query, organization } = useTournamentOrganization(requestedOrganizationId);
  const organizations = query.data ?? [];

  const message = query.isPending
    ? "Organisation wird geladen …"
    : query.error
      ? userFacingErrorMessage(query.error, "Organisationen konnten nicht geladen werden.")
      : organization === null
        ? "Erstelle zuerst auf der Übersicht eine Organisation."
        : null;

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-10 sm:px-6">
      <div className="min-w-0">
        <Link
          className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-emerald-300 transition hover:text-emerald-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-300"
          href="/"
        >
          ‹ Übersicht
        </Link>

        <header className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">{title}</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">{lead}</p>
          </div>
          {organization !== null && organizations.length > 1 ? (
            <label className="text-sm text-slate-400" htmlFor="workspace-organization">
              <span className="mb-1 block text-xs font-semibold tracking-[0.14em] text-slate-500 uppercase">
                Organisation
              </span>
              <select
                className={selectClassName}
                id="workspace-organization"
                onChange={(event) => router.push(`${pathname}?organisation=${event.target.value}`)}
                value={organization.id}
              >
                {organizations.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </header>

        <div className="mt-8">
          {message !== null || organization === null ? (
            <p
              className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 text-sm text-slate-300"
              role="status"
            >
              {message}
            </p>
          ) : (
            children(organization)
          )}
        </div>
      </div>
    </main>
  );
}
