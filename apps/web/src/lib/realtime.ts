import { io, type Socket } from "socket.io-client";

import { publicEnvironment } from "./environment";

export type RealtimeConnection = "verbunden" | "verbindet" | "getrennt";

/**
 * Turnier und Begegnung gehen denselben Weg; nur der Raum unterscheidet sie.
 * Die Namen stehen serverseitig in `apps/api/src/realtime`.
 */
function connectRoom(input: {
  readonly subscribeEvent: string;
  readonly subscribePayload: Readonly<Record<string, string>>;
  readonly changeEvent: string;
  readonly onChange: () => void;
  readonly onConnection: (connection: RealtimeConnection) => void;
}): () => void {
  const endpoint = new URL(publicEnvironment.NEXT_PUBLIC_API_URL);
  endpoint.pathname = "";
  const socket: Socket = io(endpoint.origin, { withCredentials: true });
  input.onConnection("verbindet");
  socket.on("connect", () => {
    input.onConnection("verbunden");
    socket.emit(input.subscribeEvent, input.subscribePayload);
  });
  socket.on("disconnect", () => input.onConnection("getrennt"));
  socket.on("connect_error", () => input.onConnection("getrennt"));
  socket.on(input.changeEvent, input.onChange);
  return () => socket.disconnect();
}

export function connectTournamentRealtime(input: {
  readonly tournamentId: string;
  readonly onChange: () => void;
  readonly onConnection: (connection: RealtimeConnection) => void;
}): () => void {
  return connectRoom({
    subscribeEvent: "tournament:subscribe",
    subscribePayload: { tournamentId: input.tournamentId },
    changeEvent: "tournament:changed",
    onChange: input.onChange,
    onConnection: input.onConnection,
  });
}

/** Phase-5-Schnittstelle: Raum `encounter:<id>`, Ereignis `encounter:changed`. */
export function connectEncounterRealtime(input: {
  readonly encounterId: string;
  readonly onChange: () => void;
  readonly onConnection: (connection: RealtimeConnection) => void;
}): () => void {
  return connectRoom({
    subscribeEvent: "encounter:subscribe",
    subscribePayload: { encounterId: input.encounterId },
    changeEvent: "encounter:changed",
    onChange: input.onChange,
    onConnection: input.onConnection,
  });
}
