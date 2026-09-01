import type { Metadata } from "next";

import { RosterRoute } from "@/components/players/roster-route";

export const metadata: Metadata = {
  title: "Spieler & Team",
  description: "Spieler einer Organisation verwalten und Mitglieder einladen.",
};

interface PageProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

export default async function RosterPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const organizationId = typeof query.organisation === "string" ? query.organisation : undefined;
  return <RosterRoute requestedOrganizationId={organizationId} />;
}
