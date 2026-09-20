import type { InvitationDeliveryStatus } from "@darts-platform/schemas";

/** Bildet die juengste Zustellzeile einer Einladung auf den Status der Liste ab. */
export function describeInvitationDelivery(
  row: { readonly sentAt: Date | null; readonly deadLetteredAt: Date | null } | undefined,
): InvitationDeliveryStatus | null {
  if (row === undefined) return null;
  if (row.sentAt !== null) return { status: "sent", sentAt: row.sentAt };
  if (row.deadLetteredAt !== null) return { status: "failed", failedAt: row.deadLetteredAt };
  return { status: "pending" };
}
