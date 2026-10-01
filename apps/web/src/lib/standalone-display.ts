/**
 * Laeuft DartBase als installierte App? iOS trennt den Speicher von Safari und
 * installierter App; ein im Browser-Tab eingerichtetes Geraet waere in der App
 * nicht gekoppelt (Spec 2026-09-30-scheiben-tablet, Abschnitt 2).
 */
export function isStandaloneDisplay(): boolean {
  try {
    const iosStandalone =
      "standalone" in window.navigator &&
      (window.navigator as { readonly standalone?: boolean }).standalone === true;
    return iosStandalone || window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    return false;
  }
}
