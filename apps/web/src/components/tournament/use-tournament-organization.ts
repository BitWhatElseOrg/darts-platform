"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { organizationListSchema } from "@darts-platform/schemas";

import { apiRequest } from "@/lib/api-client";
import {
  readOrganizationSelection,
  readServerOrganizationSelection,
  resolveOrganization,
  subscribeOrganizationSelection,
  writeOrganizationSelection,
} from "@/lib/organization-selection";

/**
 * Die Organisation der Arbeitsfläche.
 *
 * Nennt die Adresse eine (`?organisation=`), gilt sie; sonst die zuletzt
 * eingestellte. Die erste der Liste gewinnt nur beim allerersten Besuch —
 * vorher fiel jede Fläche ohne Parameter auf sie zurück, und ein Link wie
 * «Übersicht» warf die Auswahl damit um (siehe `organization-selection.ts`).
 */
export function useTournamentOrganization(requestedId?: string) {
  const query = useQuery({
    queryKey: ["organizations"],
    queryFn: ({ signal }) =>
      apiRequest({ path: "/organizations", schema: organizationListSchema, signal }),
  });
  const rememberedId = useSyncExternalStore(
    subscribeOrganizationSelection,
    readOrganizationSelection,
    readServerOrganizationSelection,
  );
  const organization = resolveOrganization({
    organizations: query.data,
    requestedId,
    rememberedId,
  });
  // Was gilt, wird gemerkt — auch die erste Wahl beim ersten Besuch. Sonst
  // bliebe sie unverbindlich und die nächste Fläche entschiede neu.
  const organizationId = organization?.id ?? null;
  useEffect(() => {
    if (organizationId !== null) writeOrganizationSelection(organizationId);
  }, [organizationId]);
  return { query, organization };
}
