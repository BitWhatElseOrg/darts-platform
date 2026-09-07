"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { tournamentDashboardSchema, type TournamentVisibility } from "@darts-platform/schemas";
import { cn, Control, SheetLabel, StateTag, Wedge } from "@darts-platform/ui";
import { useState } from "react";

import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";

export interface ShareState {
  readonly label: string;
  readonly hint: string;
  readonly next: TournamentVisibility;
}

/** Reine Ableitung, ohne DOM: die Bausteine des Freigabe-Bereichs. */
export function shareState(visibility: TournamentVisibility): ShareState {
  return visibility === "PUBLIC"
    ? {
        label: "Freigegeben",
        hint: "Wer den Link hat, sieht zu. Das Turnier steht in keinem Verzeichnis.",
        next: "PRIVATE",
      }
    : {
        label: "Nicht freigegeben",
        hint: "Nur angemeldete Mitglieder sehen dieses Turnier.",
        next: "PUBLIC",
      };
}

/** Die oeffentliche Adresse eines freigegebenen Turniers. */
export function shareLink(origin: string, publicId: string): string {
  return `${origin}/live/${publicId}`;
}

interface SharePanelProps {
  readonly organizationId: string;
  readonly tournamentId: string;
  readonly publicId: string;
  readonly visibility: TournamentVisibility;
}

/**
 * Schaltet die Sichtbarkeit eines Turniers um und zeigt bei Freigabe die
 * oeffentliche Adresse samt Kopieren-Knopf. Ruft `PATCH …/visibility` und
 * schreibt die Antwort (das vollstaendige Dashboard) direkt in den
 * Abfrage-Cache der Kommandozentrale zurueck -- derselbe Weg wie jedes
 * andere Kommando dort (`command-centre.tsx`, `queryClient.setQueryData`).
 */
export function SharePanel({ organizationId, publicId, tournamentId, visibility }: SharePanelProps) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const state = shareState(visibility);
  const mutation = useMutation({
    mutationFn: (next: TournamentVisibility) =>
      apiRequest({
        path: `/organizations/${organizationId}/tournaments/${tournamentId}/visibility`,
        method: "PATCH",
        body: { visibility: next },
        schema: tournamentDashboardSchema,
      }),
    onSuccess: (dashboard) => {
      queryClient.setQueryData(["tournament-dashboard", organizationId, tournamentId], dashboard);
    },
  });

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const link = visibility === "PUBLIC" && typeof window !== "undefined"
    ? shareLink(window.location.origin, publicId)
    : null;

  return (
    <Wedge
      aria-labelledby="share-heading"
      as="section"
      className="mt-5 flex flex-wrap items-center justify-between gap-4 p-4"
      tone="plate"
    >
      <div className="min-w-0 flex-1">
        <SheetLabel as="h2" id="share-heading">Öffentliche Freigabe</SheetLabel>
        <p className="mt-1.5 font-plate text-body text-wedge-900">{state.hint}</p>
        {link !== null ? (
          <p className="mt-2 flex flex-wrap items-center gap-3 font-plate text-body text-wedge-900">
            <a className="underline underline-offset-2" href={link}>
              {link}
            </a>
            <Control
              density="tight"
              onClick={() => void copyLink(link)}
              variant="wire"
            >
              {copied ? "Kopiert" : "Link kopieren"}
            </Control>
          </p>
        ) : null}
        {mutation.isError ? (
          <p className="mt-2 font-plate text-body text-ring-red-deep">
            {userFacingErrorMessage(mutation.error, "Freigabe konnte nicht geändert werden.")}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <StateTag label={state.label} tone={visibility === "PUBLIC" ? "free" : "waiting"} />
        <button
          aria-checked={visibility === "PUBLIC"}
          aria-label={`Öffentliche Freigabe: ${visibility === "PUBLIC" ? "JA" : "NEIN"}`}
          className="flex min-h-11 items-center overflow-hidden rounded-full border border-sisal-400 font-plate text-label font-bold uppercase tracking-[0.08em] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green disabled:opacity-40"
          disabled={mutation.isPending}
          onClick={() => {
            setCopied(false);
            mutation.mutate(state.next);
          }}
          role="switch"
          type="button"
        >
          <span className={cn("px-3 py-2.5", visibility !== "PUBLIC" && "bg-wedge-900 text-chalk")}>NEIN</span>
          <span className={cn("px-3 py-2.5", visibility === "PUBLIC" && "bg-ring-green text-chalk")}>JA</span>
        </button>
      </div>
    </Wedge>
  );
}
