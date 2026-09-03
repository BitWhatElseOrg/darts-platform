import type { Metadata } from "next";

import { LiveEncounter } from "@/components/live/live-encounter";

export const metadata: Metadata = { title: "Begegnung live · DartBase" };

export default async function LiveEncounterPage({
  params,
}: {
  readonly params: Promise<{ readonly publicId: string }>;
}) {
  const { publicId } = await params;
  return <LiveEncounter publicId={publicId} />;
}
