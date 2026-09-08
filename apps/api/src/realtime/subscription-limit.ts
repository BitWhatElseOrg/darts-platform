/**
 * Obergrenze der Abonnements je Socket. `tournament:subscribe` und
 * `encounter:subscribe` treten Raeumen ohne weitere Pruefung bei; ein
 * einzelner Socket koennte sonst beliebig viele Raeume belegen. Eine echte
 * Ansicht abonniert einen, hoechstens zwei Raeume — zwanzig ist reichlich
 * Luft und zugleich eine Grenze.
 *
 * Die Kanal-Autorisierung selbst (wer darf welchen Raum hoeren) ist damit
 * nicht beantwortet; sie liegt in `subscription-authorization.ts`.
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
 * Der Grund, den der Client zu sehen bekommt: `SUBSCRIPTION_UNKNOWN_ROOM` und
 * `SUBSCRIPTION_FORBIDDEN` faellt hier auf einen einzigen Wert zusammen.
 * Beide bleiben nach aussen ununterscheidbar — sonst waere die Existenz eines
 * Turniers hinter einer erratenen `public_id` selbst schon eine Information
 * (ADR 0013, ARCHITECTURE §29.1). Nur in den Logs (`realtime.service.ts`,
 * Ereignis `realtime.subscription_denied`) bleibt der praezise Grund
 * erhalten. `SUBSCRIPTION_LIMIT_REACHED` ist keine sicherheitsrelevante
 * Unterscheidung und bleibt darum eigen benannt.
 */
function toClientRejection(reason: SubscriptionRejection): SubscriptionRejection {
  return reason === "SUBSCRIPTION_UNKNOWN_ROOM" ? "SUBSCRIPTION_FORBIDDEN" : reason;
}

/**
 * Sendet `subscription:rejected`. Einzige Stelle im Code, die dieses Ereignis
 * verschickt — `joinSubscription` benutzt sie ebenso wie die Autorisierung in
 * `realtime.service.ts`. Das macht sie auch zur einzigen Stelle, an der die
 * Existenz-Oracle-Faelle zusammengefuehrt werden muessen (`toClientRejection`).
 */
export function rejectSubscription(
  socket: RejectableSocket,
  room: string,
  reason: SubscriptionRejection,
): void {
  socket.emit("subscription:rejected", { room, reason: toClientRejection(reason) });
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
