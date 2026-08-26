import type { Metadata } from "next";

import { SetupSheet } from "@/components/tournament/setup-sheet";

export const metadata: Metadata = {
  title: "Turnier anlegen",
  description: "Teilnehmer, Struktur und Boards festlegen, dann das Turnier starten.",
};

export default function TournamentSetupPage() {
  return <SetupSheet />;
}
