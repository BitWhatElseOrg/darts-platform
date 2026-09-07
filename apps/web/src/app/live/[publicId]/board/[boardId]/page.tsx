import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LiveTournament } from "@/components/live/live-tournament";
import { resolvePublicId } from "@/lib/live-address";

export const metadata: Metadata = { title: "Board live · DartBase" };

export default async function BoardPage({
  params,
}: {
  readonly params: Promise<{ readonly publicId: string; readonly boardId: string }>;
}) {
  const { boardId, publicId } = await params;
  const resolved = await resolvePublicId(publicId);
  if (resolved !== null) redirect(`/live/${resolved}/board/${boardId}`);
  return <LiveTournament boardId={boardId} mode="board" publicId={publicId} />;
}
