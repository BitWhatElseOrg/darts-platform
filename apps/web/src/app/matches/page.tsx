import type { Metadata } from "next";

import { MatchDirectoryRoute } from "@/components/match/match-directory-route";

export const metadata: Metadata = {
  title: "Matches",
  description: "Boards und Matches einer Organisation anlegen und verfolgen.",
};

interface PageProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

export default async function MatchDirectoryPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const organizationId = typeof query.organisation === "string" ? query.organisation : undefined;
  return <MatchDirectoryRoute requestedOrganizationId={organizationId} />;
}
