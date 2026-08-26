import type { Metadata } from "next";
import { FormatWorkshop } from "@/components/tournament/format-workshop";

export const metadata: Metadata = { title: "Formatwerkstatt", description: "Mehrstufige Dartturnierformate konfigurieren und prüfen." };

export default async function FormatsPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>> }) {
  const query = await searchParams;
  return <FormatWorkshop requestedOrganizationId={typeof query.organisation === "string" ? query.organisation : undefined} />;
}
