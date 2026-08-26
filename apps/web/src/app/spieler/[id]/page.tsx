import type { Metadata } from "next";
import { PlayerProfile } from "@/components/player-profile";

export const metadata: Metadata = { title: "Spielerprofil", description: "Karriere-, Match- und Checkout-Statistiken." };

export default async function PlayerPage({ params, searchParams }: { readonly params: Promise<{ readonly id: string }>; readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <PlayerProfile playerId={id} requestedOrganizationId={typeof query.organisation === "string" ? query.organisation : undefined} />;
}
