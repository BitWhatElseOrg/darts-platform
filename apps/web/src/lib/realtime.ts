import { io, type Socket } from "socket.io-client";

import { publicEnvironment } from "./environment";

export type RealtimeConnection = "verbunden" | "verbindet" | "getrennt" | "abgewiesen";

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
  // Eine Ablehnung (fehlende Berechtigung, unbekannte Adresse, Obergrenze je
  // Socket -- `apps/api/src/realtime/subscription-limit.ts`) ist etwas
  // anderes als eine getrennte Verbindung: "getrennt" laedt zum Warten ein,
  // eine Ablehnung nicht -- der naechste Versuch mit denselben Daten scheitert
  // wieder gleich.
  socket.on("subscription:rejected", () => input.onConnection("abgewiesen"));
  socket.on(input.changeEvent, input.onChange);
  return () => socket.disconnect();
}

export function connectTournamentRealtime(input: {
  readonly publicId: string;
  /**
   * Anzeige-Schluessel fuer ein privates Turnier ohne Anmeldung (Plan 2,
   * `apps/api/src/realtime/subscription-authorization.ts`). Fehlt er -- wie
   * bei einer angemeldeten Ansicht, die sich ueber das Session-Cookie
   * ausweist --, bleibt er weg.
   */
  readonly displayKey?: string | null;
  readonly onChange: () => void;
  readonly onConnection: (connection: RealtimeConnection) => void;
}): () => void {
  return connectRoom({
    subscribeEvent: "tournament:subscribe",
    subscribePayload:
      input.displayKey === null || input.displayKey === undefined
        ? { publicId: input.publicId }
        : { publicId: input.publicId, displayKey: input.displayKey },
    changeEvent: "tournament:changed",
    onChange: input.onChange,
    onConnection: input.onConnection,
  });
}

/** Raum `encounter:<publicId>`, Ereignis `encounter:changed`. */
export function connectEncounterRealtime(input: {
  readonly publicId: string;
  readonly onChange: () => void;
  readonly onConnection: (connection: RealtimeConnection) => void;
}): () => void {
  return connectRoom({
    subscribeEvent: "encounter:subscribe",
    subscribePayload: { publicId: input.publicId },
    changeEvent: "encounter:changed",
    onChange: input.onChange,
    onConnection: input.onConnection,
  });
}
