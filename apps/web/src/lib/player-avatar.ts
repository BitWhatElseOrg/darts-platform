/**
 * Das Standardbild eines Spielers ohne Foto: Initialen auf einer Fläche,
 * deren Farbton aus der Spieler-ID kommt. Beide Regeln sind rein, damit
 * dieselbe Person überall dieselbe Darstellung bekommt — und damit sie ohne
 * Netz und Datenbank prüfbar sind.
 */

/** Ein bis zwei Grossbuchstaben aus dem Anzeigenamen. */
export function playerInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/u).filter((word) => word.length > 0);
  const letters = words.slice(0, 2).map((word) => word.charAt(0).toUpperCase());
  return letters.length === 0 ? "?" : letters.join("");
}

/**
 * Ein Farbwinkel von 0 bis 359, stabil je Kennung. Bewusst kein Zufall und
 * kein Index in der Liste: beides änderte die Farbe einer Person, sobald
 * sich die Liste ändert.
 */
export function avatarTone(playerId: string): number {
  let hash = 0;
  for (let index = 0; index < playerId.length; index += 1) {
    const char = playerId.charCodeAt(index);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash) % 360;
}
