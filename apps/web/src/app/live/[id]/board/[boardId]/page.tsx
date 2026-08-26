import type { Metadata } from "next";
import { LiveTournament } from "@/components/live/live-tournament";

export const metadata: Metadata = { title: "Board live · Dart Ost" };

export default async function BoardPage({ params }: { readonly params: Promise<{ readonly id: string; readonly boardId: string }> }) {
  const { id, boardId } = await params;
  return <LiveTournament boardId={boardId} mode="board" tournamentId={id} />;
}
