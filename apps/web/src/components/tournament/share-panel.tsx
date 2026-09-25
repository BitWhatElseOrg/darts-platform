"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { tournamentDashboardSchema, type TournamentVisibility } from "@darts-platform/schemas";
import { cn, Control, MarkCheck, SheetLabel, StateTag, Wedge } from "@darts-platform/ui";
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

/**
 * Wohin der Navigationslink «Live-Ansicht» der Kommandozentrale zeigt. Die
 * oeffentliche Route antwortet fuer ein nicht freigegebenes Turnier bewusst
 * mit 404 (ADR 0013); ein Link dorthin endete in «Turnier nicht gefunden».
 * Solange das Turnier privat ist, fuehrt der Eintrag deshalb zur Freigabe.
 */
export function liveNavTarget(
  visibility: TournamentVisibility,
  publicId: string,
): { readonly href: string; readonly label: string } {
  return visibility === "PUBLIC"
    ? { href: `/live/${publicId}`, label: "Öffentliche Live-Ansicht" }
    : { href: "#share-heading", label: "Live-Ansicht: noch nicht freigegeben" };
}

interface SharePanelProps {
  readonly organizationId: string;
  readonly tournamentId: string;
  readonly publicId: string;
  readonly visibility: TournamentVisibility;
  /**
   * `tournament:update`, wie `canCorrect`/`canWithdraw` in
   * `tournament-dashboard-route.tsx` bereits fuer diesen Bereich berechnen.
   * Die serverseitige Pruefung bleibt unveraendert massgeblich -- ohne die
   * Berechtigung soll der Schalter aber erst gar keine Handlung vortaeuschen.
   */
  readonly canShare: boolean;
}

/**
 * Schaltet die Sichtbarkeit eines Turniers um und zeigt bei Freigabe die
 * oeffentliche Adresse samt Kopieren-Knopf. Ruft `PATCH …/visibility` und
 * schreibt die Antwort (das vollstaendige Dashboard) direkt in den
 * Abfrage-Cache der Kommandozentrale zurueck -- derselbe Weg wie jedes
 * andere Kommando dort (`command-centre.tsx`, `queryClient.setQueryData`).
 */
export function SharePanel({ canShare, organizationId, publicId, tournamentId, visibility }: SharePanelProps) {
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
      // Gestapelt statt `flex-wrap`: mit `flex-1` (Basis 0) brach die Zeile nie
      // um, der Schalter drueckte den Text auf 390 px auf ein Wort je Zeile
      // (Probelauf 25.09.2026, Befund 2). Ab `sm` nebeneinander.
      className="mt-5 flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"
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
          // grid-cols-2 statt flex: die beiden Marken sind unterschiedlich
          // breit ("NEIN" gegen "JA") und ergaben als Flex-Elemente zwei
          // ungleiche Hälften. Zwei 1fr-Spalten sind beide so breit wie die
          // breitere Marke; das Füllen der Höhe übernimmt die Streckung des
          // Grids, deshalb tragen die Marken kein eigenes py mehr.
          //
          // Der Aus-Zustand lag auf `bg-wedge-900` und damit 1,22:1 über der
          // ungewählten Hälfte -- gemessen, und im Screenshot als "noch nicht
          // geladen" lesbar. Er trägt jetzt dieselbe Chalk-Rendition wie die
          // Pille im Einstellungs-Modal, dazu ein gezeichnetes Häkchen
          // (Never-Only-Colour Rule).
          className="grid min-h-11 grid-cols-2 overflow-hidden rounded-full border border-sisal-400 font-plate text-label font-bold uppercase tracking-[0.12em] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green disabled:opacity-40"
          disabled={!canShare || mutation.isPending}
          onClick={() => {
            setCopied(false);
            mutation.mutate(state.next);
          }}
          role="switch"
          type="button"
        >
          <span className={cn("flex items-center justify-center gap-1 px-3", visibility !== "PUBLIC" && "bg-chalk text-sisal-200")}>
            {visibility !== "PUBLIC" ? <MarkCheck className="h-3 w-3" /> : null}
            NEIN
          </span>
          <span className={cn("flex items-center justify-center gap-1 px-3", visibility === "PUBLIC" && "bg-ring-green text-chalk")}>
            {visibility === "PUBLIC" ? <MarkCheck className="h-3 w-3" /> : null}
            JA
          </span>
        </button>
      </div>
    </Wedge>
  );
}
