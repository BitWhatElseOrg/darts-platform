"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";

import { Button, Rule, SheetLabel, Wedge } from "@darts-platform/ui";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";

interface DeleteTournamentPanelProps {
  readonly organizationId: string;
  readonly tournamentId: string;
  readonly tournamentName: string;
  /** Grund aus `tournamentDeletionBlocker`; `null` heisst: loeschbar. */
  readonly blockedReason: string | null;
}

/**
 * Abschnitt "Turnier loeschen" am Ende der Kommandozentrale (Spec
 * 2026-09-25-lease-karenz-turnier-loeschen, Befund 7). Nur fuer
 * `tournament:delete` gerendert (Route). Kein Bestaetigungsname wie beim
 * Loeschen der Organisation: geloescht wird nur, was keine Ergebnisse hat
 * und in Sekunden neu angelegt waere -- der Dialog reicht.
 */
export function DeleteTournamentPanel({
  blockedReason,
  organizationId,
  tournamentId,
  tournamentName,
}: DeleteTournamentPanelProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const deletion = useMutation({
    mutationFn: () =>
      apiRequest({
        path: `/organizations/${organizationId}/tournaments/${tournamentId}`,
        method: "DELETE",
        schema: z.undefined(),
      }),
    onSuccess: async () => {
      // Das Turnier existiert nicht mehr: jede Abfrage zu seiner ID wuerde
      // beim naechsten Refetch gegen 404 laufen und wird deshalb entfernt.
      queryClient.removeQueries({ predicate: (query) => query.queryKey.includes(tournamentId) });
      await queryClient.invalidateQueries({ queryKey: ["tournaments"] });
      setOpen(false);
      router.push(`/turniere?organisation=${organizationId}`);
    },
  });

  return (
    <Wedge aria-labelledby="delete-tournament-heading" as="section" className="mt-9 p-4" tone="plate">
      <SheetLabel as="h2" id="delete-tournament-heading">Turnier löschen</SheetLabel>
      <Rule className="mt-2" tone="faint" />
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-plate text-body text-wedge-900">
          {blockedReason ??
            "Entfernt das Turnier mit Spielplan, Gruppen und Board-Zuordnung. Möglich, solange nichts gespielt wurde."}
        </p>
        <Button
          className="shrink-0"
          disabled={blockedReason !== null}
          onClick={() => {
            deletion.reset();
            setOpen(true);
          }}
          type="button"
          variant="danger"
        >
          Turnier löschen
        </Button>
      </div>
      <ConfirmDialog
        confirmLabel="Turnier löschen"
        confirmVariant="danger"
        description={`Löscht «${tournamentName}» mit Spielplan, Gruppen und Board-Zuordnung. Das lässt sich nicht rückgängig machen.`}
        error={deletion.isError ? userFacingErrorMessage(deletion.error) : null}
        onCancel={() => setOpen(false)}
        onConfirm={() => deletion.mutate()}
        open={open}
        pending={deletion.isPending}
        title="Turnier löschen"
      />
    </Wedge>
  );
}
