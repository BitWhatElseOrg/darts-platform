import type { Metadata } from "next";

import { LiveTournament } from "@/components/live/live-tournament";

export const metadata: Metadata = { title: "Board live · DartBase" };

export default async function BoardPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly publicId: string; readonly boardId: string }>;
  readonly searchParams: Promise<{ readonly k?: string | string[] }>;
}) {
  const { boardId, publicId } = await params;
  // Der Anzeige-Schluessel (Task 6) kommt einmalig ueber `?k=` an; `LiveTournament`
  // merkt ihn sich im Browser und entfernt ihn wieder aus der Adresse.
  const { k } = await searchParams;
  const displayKeySecret = typeof k === "string" ? k : null;
  return (
    <LiveTournament
      boardId={boardId}
      displayKeySecret={displayKeySecret}
      mode="board"
      publicId={publicId}
    />
  );
}
