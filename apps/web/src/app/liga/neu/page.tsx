import type { Metadata } from "next";

import { CompetitionSetup } from "@/components/league/competition-setup";

export const metadata: Metadata = {
  title: "Wettbewerb anlegen",
  description: "Ligawettbewerb mit Begegnungsvorlage, Aufstellungs- und Wertungsregeln.",
};

interface PageProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

export default async function CompetitionSetupPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const organizationId = typeof query.organisation === "string" ? query.organisation : undefined;
  return <CompetitionSetup requestedOrganizationId={organizationId} />;
}
