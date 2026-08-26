import type { Metadata } from "next";

import { TournamentList } from "@/components/tournament/tournament-list";

export const metadata: Metadata = {
  title: "Turniere",
  description: "Turniere der Organisation anlegen, führen und abschliessen.",
};

interface PageProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

export default async function TournamentListPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const organizationId = typeof query.organisation === "string" ? query.organisation : undefined;
  return <TournamentList requestedOrganizationId={organizationId} />;
}
