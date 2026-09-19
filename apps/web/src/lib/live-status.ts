import type { RealtimeConnection } from "./realtime";

/**
 * Die Farbe des Verbindungspunkts in den oeffentlichen Live-Ansichten
 * (Turnier und Begegnung). Der Punkt begleitet nur; den Zustand traegt der
 * Text daneben (AGENTS.md §19, keine Information ausschliesslich ueber
 * Farbe). Gruen heisst: der Socket steht, Aenderungen kommen sofort. Grau
 * heisst: die Flaeche laedt im Intervall nach. Rot heisst: der letzte
 * Nachlauf ist gescheitert, der Stand ist alt.
 */
export function liveDotClass(input: {
  readonly isError: boolean;
  readonly connection: RealtimeConnection;
}): "bg-ring-red" | "bg-ring-green" | "bg-sisal-400" {
  if (input.isError) return "bg-ring-red";
  if (input.connection === "verbunden") return "bg-ring-green";
  return "bg-sisal-400";
}
