import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LiveTournament } from "@/components/live/live-tournament";
import { resolvePublicId } from "@/lib/live-address";

export const metadata: Metadata = { title: "Turnier live · DartBase" };

export default async function LivePage({ params }: { readonly params: Promise<{ readonly publicId: string }> }) {
  const { publicId } = await params;
  const resolved = await resolvePublicId(publicId);
  if (resolved !== null) redirect(`/live/${resolved}`);
  return <LiveTournament mode="publikum" publicId={publicId} />;
}
