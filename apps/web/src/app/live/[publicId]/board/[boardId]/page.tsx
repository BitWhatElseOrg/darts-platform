import type { Metadata } from "next";

import { LiveTournament } from "@/components/live/live-tournament";

export const metadata: Metadata = { title: "Board live · DartBase" };

export default async function BoardPage({
  params,
}: {
  readonly params: Promise<{ readonly publicId: string; readonly boardId: string }>;
}) {
  const { boardId, publicId } = await params;
  return <LiveTournament boardId={boardId} mode="board" publicId={publicId} />;
}
