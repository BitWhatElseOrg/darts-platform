/**
 * Obergrenze der Abonnements je Socket. `tournament:subscribe` und
 * `encounter:subscribe` treten Raeumen ohne weitere Pruefung bei; ein
 * einzelner Socket koennte sonst beliebig viele Raeume belegen. Eine echte
 * Ansicht abonniert einen, hoechstens zwei Raeume — zwanzig ist reichlich
 * Luft und zugleich eine Grenze.
 *
 * Die Kanal-Autorisierung selbst (wer darf welchen Raum hoeren) ist damit
 * nicht beantwortet; sie steht als eigenes Vorhaben aus.
 */
export const MAX_SUBSCRIPTIONS_PER_SOCKET = 20;

/** Der Teil von Socket.IO, den `joinSubscription` braucht. */
export interface SubscribableSocket {
  readonly id: string;
  readonly rooms: ReadonlySet<string>;
  join(room: string): void | Promise<void>;
  emit(event: string, payload: Readonly<Record<string, string>>): void;
}

export type SubscriptionOutcome = "joined" | "already-joined" | "limit-reached";

/**
 * Die drei Gruende, aus denen ein Abonnement abgelehnt wird: die Obergrenze
 * je Socket (hier), fehlende Berechtigung und eine unbekannte Adresse (beide
 * `subscription-authorization.ts`). Der Client bekommt in allen Faellen
 * dasselbe Ereignis, nach aussen nicht unterscheidbar — nur in den Logs.
 */
export type SubscriptionRejection =
  | "SUBSCRIPTION_LIMIT_REACHED"
  | "SUBSCRIPTION_FORBIDDEN"
  | "SUBSCRIPTION_UNKNOWN_ROOM";

/** Der Teil von Socket.IO, den `rejectSubscription` braucht. */
export interface RejectableSocket {
  emit(event: string, payload: Readonly<Record<string, string>>): void;
}

/**
 * Sendet `subscription:rejected`. Einzige Stelle im Code, die dieses Ereignis
 * verschickt — `joinSubscription` benutzt sie ebenso wie die Autorisierung in
 * `realtime.service.ts`.
 */
export function rejectSubscription(
  socket: RejectableSocket,
  room: string,
  reason: SubscriptionRejection,
): void {
  socket.emit("subscription:rejected", { room, reason });
}

/**
 * Tritt einem Raum bei, solange dieser Socket die Obergrenze nicht
 * erreicht hat. `socket.rooms` enthaelt immer den eigenen Kanal des Sockets;
 * er zaehlt nicht als Abonnement. Wird abgewiesen, erfaehrt der Client das
 * ueber `subscription:rejected` — ein stilles Nichtstun waere fuer ihn nicht
 * von einem stillen Kanal zu unterscheiden.
 */
export function joinSubscription(
  socket: SubscribableSocket,
  room: string,
): SubscriptionOutcome {
  if (socket.rooms.has(room)) return "already-joined";

  const subscriptions = [...socket.rooms].filter((joined) => joined !== socket.id);
  if (subscriptions.length >= MAX_SUBSCRIPTIONS_PER_SOCKET) {
    rejectSubscription(socket, room, "SUBSCRIPTION_LIMIT_REACHED");
    return "limit-reached";
  }

  void socket.join(room);
  return "joined";
}
