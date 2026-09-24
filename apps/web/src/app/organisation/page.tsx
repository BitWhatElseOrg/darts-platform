import type { Metadata } from "next";

import { OrganizationSettingsRoute } from "@/components/organization/organization-settings-route";

export const metadata: Metadata = {
  title: "Organisation",
  description: "Name, Zeitzone, Sprache und Löschen einer Organisation verwalten.",
};

interface PageProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

export default async function OrganizationSettingsPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const organizationId = typeof query.organisation === "string" ? query.organisation : undefined;
  return <OrganizationSettingsRoute requestedOrganizationId={organizationId} />;
}
