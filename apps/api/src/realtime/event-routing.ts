/**
 * Reine Abbildung eines Outbox-Ereignisses auf Raum, Kanal und Nutzlast.
 * Ohne Datenbank, ohne Socket.IO — damit die Verteilungsregel ohne
 * Infrastruktur prüfbar bleibt.
 */

export type RealtimeScope =
  | { readonly kind: "tournament"; readonly publicId: string }
  | { readonly kind: "encounter"; readonly publicId: string };

export interface RoutableEvent {
  readonly id: string;
  readonly eventType: string;
  readonly occurredAt: Date;
}

export interface RealtimeBroadcast {
  readonly room: string;
  readonly event: string;
  readonly payload: Readonly<Record<string, string>>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * Abonnements kommen vom Client und sind unvertraut: nur eine UUID darf zu
 * einem Raumnamen werden, sonst liesse sich in fremde Räume horchen.
 */
export function parseSubscriptionId(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

export function toBroadcast(
  event: RoutableEvent,
  scope: RealtimeScope | null,
): RealtimeBroadcast | null {
  if (scope === null) return null;
  const occurredAt = event.occurredAt.toISOString();
  if (scope.kind === "tournament") {
    return {
      room: `tournament:${scope.publicId}`,
      event: "tournament:changed",
      payload: {
        eventId: event.id,
        eventType: event.eventType,
        publicId: scope.publicId,
        occurredAt,
      },
    };
  }
  return {
    room: `encounter:${scope.publicId}`,
    event: "encounter:changed",
    payload: {
      eventId: event.id,
      eventType: event.eventType,
      publicId: scope.publicId,
      occurredAt,
    },
  };
}
