import type { Metadata } from "next";

import { MembersRoute } from "@/components/organization/members-route";

export const metadata: Metadata = {
  title: "Mitglieder",
  description: "Rollen, Zugänge und offene Einladungen einer Organisation verwalten.",
};

interface PageProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

export default async function MembersPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const organizationId = typeof query.organisation === "string" ? query.organisation : undefined;
  return <MembersRoute requestedOrganizationId={organizationId} />;
}
