import { io, type Socket } from "socket.io-client";

import { publicEnvironment } from "./environment";

export type RealtimeConnection = "verbunden" | "verbindet" | "getrennt";

export function connectTournamentRealtime(input: {
  readonly tournamentId: string;
  readonly onChange: () => void;
  readonly onConnection: (connection: RealtimeConnection) => void;
}): () => void {
  const endpoint = new URL(publicEnvironment.NEXT_PUBLIC_API_URL);
  endpoint.pathname = "";
  const socket: Socket = io(endpoint.origin, { withCredentials: true });
  input.onConnection("verbindet");
  socket.on("connect", () => {
    input.onConnection("verbunden");
    socket.emit("tournament:subscribe", { tournamentId: input.tournamentId });
  });
  socket.on("disconnect", () => input.onConnection("getrennt"));
  socket.on("connect_error", () => input.onConnection("getrennt"));
  socket.on("tournament:changed", input.onChange);
  return () => socket.disconnect();
}
