import type { InvitationDeliveryStatus } from "@darts-platform/schemas";

const dateFormat = new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeStyle: "short" });

/**
 * Zustand der juengsten Mail einer Einladung als Text, nicht nur als
 * Farbe. `null` steht fuer Einladungen aus der Zeit vor dem Mailversand.
 */
export function InvitationDeliveryBadge({ delivery }: {
  readonly delivery: InvitationDeliveryStatus | null | undefined;
}) {
  if (delivery === null || delivery === undefined) {
    return <span className="text-caption text-slate-500">Mail: ohne Versand (Code von Hand weitergegeben)</span>;
  }
  switch (delivery.status) {
    case "pending":
      return <span className="text-caption text-slate-400">Mail: ausstehend</span>;
    case "sent":
      return (
        <span className="text-caption text-emerald-300">
          Mail: versendet am {dateFormat.format(delivery.sentAt)}
        </span>
      );
    case "failed":
      return (
        <span className="text-caption text-rose-300">
          Mail: fehlgeschlagen am {dateFormat.format(delivery.failedAt)} – erneut senden oder Code weitergeben
        </span>
      );
    default: {
      const exhaustive: never = delivery;
      return <span className="text-caption text-slate-500">{String(exhaustive)}</span>;
    }
  }
}
