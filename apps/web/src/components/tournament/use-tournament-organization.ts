"use client";

import { useQuery } from "@tanstack/react-query";
import { organizationListSchema } from "@darts-platform/schemas";

import { apiRequest } from "@/lib/api-client";

export function useTournamentOrganization(requestedId?: string) {
  const query = useQuery({
    queryKey: ["organizations"],
    queryFn: ({ signal }) =>
      apiRequest({ path: "/organizations", schema: organizationListSchema, signal }),
  });
  const organization =
    query.data?.find((candidate) => candidate.id === requestedId) ?? query.data?.[0] ?? null;
  return { query, organization };
}
