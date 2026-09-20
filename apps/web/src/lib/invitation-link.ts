/**
 * Der Einladungscode steht im URL-Fragment (`#code=…`), damit er den
 * Browser nicht verlaesst. Diese Regeln sind rein, damit die Seite sie ohne
 * Browser pruefen kann.
 */
export function readInvitationCode(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw.length === 0) return null;
  const code = new URLSearchParams(raw).get("code");
  return code === null || code.length === 0 ? null : code;
}

/** Gegenstueck zu `buildInvitationUrl` in der API — fuer die Anzeige des Fallback-Links. */
export function buildInvitationLink(origin: string, invitationId: string, claimToken: string): string {
  return `${new URL(origin).origin}/einladung/${encodeURIComponent(invitationId)}#code=${encodeURIComponent(claimToken)}`;
}
