import type { Metadata } from "next";

import { TournamentSetupRoute } from "@/components/tournament/tournament-setup-route";

export const metadata: Metadata = {
  title: "Turnier anlegen",
  description: "Teilnehmer, Struktur und Boards festlegen, dann das Turnier starten.",
};

interface PageProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

export default async function TournamentSetupPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const organizationId = typeof query.organisation === "string" ? query.organisation : undefined;
  return <TournamentSetupRoute requestedOrganizationId={organizationId} />;
}
