import type { Metadata } from "next";

import { CompetitionList } from "@/components/league/competition-list";

export const metadata: Metadata = {
  title: "Liga",
  description: "Ligawettbewerbe, Begegnungen und Spielrapporte.",
};

interface PageProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

export default async function LeaguePage({ searchParams }: PageProps) {
  const query = await searchParams;
  const organizationId = typeof query.organisation === "string" ? query.organisation : undefined;
  return <CompetitionList requestedOrganizationId={organizationId} />;
}
