import type { Metadata } from "next";

import { EncounterRoute } from "@/components/league/encounter-route";

export const metadata: Metadata = {
  title: "Begegnungsleitung",
  description: "Meldung, Doppelpaarungen, Boards und Ergebnis einer Team-Begegnung.",
};

interface PageProps {
  readonly params: Promise<{ readonly id: string }>;
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

export default async function EncounterPage({ params, searchParams }: PageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const organizationId = typeof query.organisation === "string" ? query.organisation : undefined;
  return <EncounterRoute encounterId={id} requestedOrganizationId={organizationId} />;
}
