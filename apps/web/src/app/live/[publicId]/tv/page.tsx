import type { Metadata } from "next";

import { LiveTournament } from "@/components/live/live-tournament";

export const metadata: Metadata = { title: "TV-Modus · DartBase" };

export default async function TvPage({ params }: { readonly params: Promise<{ readonly publicId: string }> }) {
  const { publicId } = await params;
  return <LiveTournament mode="tv" publicId={publicId} />;
}
