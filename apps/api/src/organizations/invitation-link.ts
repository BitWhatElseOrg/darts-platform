/**
 * Der Einladungslink traegt den Klartext-Code im URL-Fragment. Das Fragment
 * verlaesst den Browser nicht: es steht weder in Server-Logs noch im
 * Referer noch in Proxy-Protokollen. Die Einladungsseite liest es
 * clientseitig und sendet es nur im Request-Body an die API.
 */
export function buildInvitationUrl(
  webOrigin: string,
  invitationId: string,
  claimToken: string,
): string {
  const origin = new URL(webOrigin).origin;
  return `${origin}/einladung/${encodeURIComponent(invitationId)}#code=${encodeURIComponent(claimToken)}`;
}
