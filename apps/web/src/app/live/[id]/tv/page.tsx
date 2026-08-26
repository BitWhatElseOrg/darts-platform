import type { Metadata } from "next";
import { LiveTournament } from "@/components/live/live-tournament";

export const metadata: Metadata = { title: "TV-Modus · Dart Ost" };

export default async function TvPage({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const { id } = await params;
  return <LiveTournament mode="tv" tournamentId={id} />;
}
