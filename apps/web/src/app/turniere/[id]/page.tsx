import type { Metadata } from "next";

import { CommandCentre } from "@/components/tournament/command-centre";
import { DEFAULT_SCENARIO, isScenarioId, loadDashboard } from "@/lib/tournament-demo";

export const metadata: Metadata = {
  title: "Turnierleitung",
  description: "Live-Kommandozentrale für ein laufendes Dartturnier.",
};

interface PageProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

export default async function TournamentDashboardPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const requested = typeof query.zustand === "string" ? query.zustand : undefined;
  const scenario = isScenarioId(requested) ? requested : DEFAULT_SCENARIO;

  return <CommandCentre initialDashboard={loadDashboard(scenario)} scenario={scenario} />;
}
