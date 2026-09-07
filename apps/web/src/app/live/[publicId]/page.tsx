import type { Metadata } from "next";

import { LiveTournament } from "@/components/live/live-tournament";

export const metadata: Metadata = { title: "Turnier live · DartBase" };

export default async function LivePage({ params }: { readonly params: Promise<{ readonly publicId: string }> }) {
  const { publicId } = await params;
  return <LiveTournament mode="publikum" publicId={publicId} />;
}
