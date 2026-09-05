"use client";

import { useQuery } from "@tanstack/react-query";
import { frequentScoresSchema, type FrequentScores } from "@darts-platform/schemas";
import { apiRequest } from "@/lib/api-client";

/** Ohne Historie der Person oder der Organisation greift dieser feste Satz. */
export const defaultQuickScores: readonly number[] = [26, 41, 45, 60, 81, 85];

export interface QuickScores {
  readonly scores: readonly number[];
  readonly source: FrequentScores["source"];
}

/**
 * Schnellwerte der werfenden Person für den Runden-Modus, gestuft über
 * Person, Organisation und Standardsatz (Task 6). Ein Ausfall der Abfrage
 * (kein Netz, Serverfehler, Person ohne Historie) fällt auf
 * `defaultQuickScores`/`"DEFAULT"` zurück, damit die Eingabe nie anhängt.
 */
export function useQuickScores({ organizationId, playerId, enabled }: {
  readonly organizationId: string;
  readonly playerId: string | null;
  readonly enabled: boolean;
}): QuickScores {
  const query = useQuery({
    queryKey: ["frequent-scores", organizationId, playerId],
    queryFn: ({ signal }) => apiRequest({
      path: `/organizations/${organizationId}/players/${playerId ?? ""}/statistics/frequent-scores`,
      schema: frequentScoresSchema,
      signal,
    }),
    enabled: playerId !== null && enabled,
    staleTime: 10 * 60 * 1000,
  });
  return {
    scores: query.data?.scores ?? defaultQuickScores,
    source: query.data?.source ?? "DEFAULT",
  };
}
