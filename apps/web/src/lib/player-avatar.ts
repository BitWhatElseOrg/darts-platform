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
 *
 * Hinweis: Die naheliegende Variante mit `(hash * 31 + charCode) % 360`
 * erzeugt Kollisionen bei ähnlich strukturierten UUIDs (z.B. "1111..." und
 * "2222..." geben beide 348). Diese Funktion nutzt stattdessen sdbm/djb2-Hash,
 * um Kollisionen zu minimieren.
 */
export function avatarTone(playerId: string): number {
  let hash = 0;
  for (let index = 0; index < playerId.length; index += 1) {
    const char = playerId.charCodeAt(index);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Bitweise UND auf 32-Bit-Integer begrenzen, um Ueberlaeufe zu vermeiden
  }
  return Math.abs(hash) % 360;
}
