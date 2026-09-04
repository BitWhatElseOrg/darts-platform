import type { Metadata } from "next";

import { MatchScoreboardRoute } from "@/components/match/match-scoreboard-route";

export const metadata: Metadata = {
  title: "Scoreboard",
  description: "Fokussierte Score-Erfassung für ein einzelnes Match.",
};

interface PageProps {
  readonly params: Promise<{ readonly matchId: string }>;
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

export default async function MatchScoreboardPage({ params, searchParams }: PageProps) {
  const [{ matchId }, query] = await Promise.all([params, searchParams]);
  const organizationId = typeof query.organisation === "string" ? query.organisation : undefined;
  const encounterId = typeof query.begegnung === "string" ? query.begegnung : undefined;
  return (
    <MatchScoreboardRoute
      encounterId={encounterId}
      matchId={matchId}
      requestedOrganizationId={organizationId}
    />
  );
}
