import type { Metadata } from "next";

import { TeamRoster } from "@/components/league/team-roster";

export const metadata: Metadata = {
  title: "Teams",
  description: "Mannschaften und ihre Kader für den Ligabetrieb.",
};

interface PageProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

export default async function TeamsPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const organizationId = typeof query.organisation === "string" ? query.organisation : undefined;
  return <TeamRoster requestedOrganizationId={organizationId} />;
}
