import type { Metadata } from "next";

import { TournamentDashboardRoute } from "@/components/tournament/tournament-dashboard-route";

export const metadata: Metadata = {
  title: "Turnierleitung",
  description: "Live-Kommandozentrale für ein laufendes Dartturnier.",
};

interface PageProps {
  readonly params: Promise<{ readonly id: string }>;
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

export default async function TournamentDashboardPage({ params, searchParams }: PageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const organizationId = typeof query.organisation === "string" ? query.organisation : undefined;
  return <TournamentDashboardRoute requestedOrganizationId={organizationId} tournamentId={id} />;
}
