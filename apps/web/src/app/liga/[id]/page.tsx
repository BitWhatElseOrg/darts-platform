import type { Metadata } from "next";

import { CompetitionDetail } from "@/components/league/competition-detail";

export const metadata: Metadata = {
  title: "Wettbewerb",
  description: "Begegnungsvorlage, Begegnungen und Ansetzung eines Ligawettbewerbs.",
};

interface PageProps {
  readonly params: Promise<{ readonly id: string }>;
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

export default async function CompetitionPage({ params, searchParams }: PageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const organizationId = typeof query.organisation === "string" ? query.organisation : undefined;
  return <CompetitionDetail competitionId={id} requestedOrganizationId={organizationId} />;
}
