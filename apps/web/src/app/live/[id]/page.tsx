import type { Metadata } from "next";
import { LiveTournament } from "@/components/live/live-tournament";

export const metadata: Metadata = { title: "Turnier live · Dart Ost" };

export default async function LivePage({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const { id } = await params;
  return <LiveTournament mode="publikum" tournamentId={id} />;
}
