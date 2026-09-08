/**
 * Anzeige-Schluessel im Browser (Task 6): der Klartext eines Schluessels
 * kommt einmal ueber `?k=` in der Adresse und wird hier je Turnier gemerkt,
 * damit ein Neuladen der Board- oder TV-Ansicht ohne den Parameter in der
 * Adresse noch funktioniert.
 *
 * Jeder Zugriff steht in `try`/`catch`: im privaten Fenster und bei
 * blockierten Website-Daten wirft `localStorage` selbst beim Lesen, und eine
 * Board-Anzeige, die deswegen mit einer Ausnahme stehen bleibt, ist schlimmer
 * als eine ohne Gedaechtnis.
 */
const KEY_PREFIX = "dartbase.display-key.";

/**
 * `Storage.prototype.<method>.call(window.localStorage, …)` statt
 * `window.localStorage.<method>(…)`: `happy-dom`s `Storage`-Instanz ist ein
 * Proxy, der eine Methode beim ERSTEN Zugriff einmalig an die Instanz bindet
 * und danach nie wieder nachschlaegt (`ClassMethodBinder`). Ein `vi.spyOn`
 * auf `Storage.prototype` NACH diesem ersten Zugriff bliebe damit wirkungslos
 * — genau der Fall im dritten Testfall dieser Datei, der nach den ersten
 * beiden bereits eine gebundene Methode vorfindet. Der Aufruf ueber das
 * Prototyp bleibt dagegen ein gewoehnlicher Property-Zugriff auf ein
 * gewoehnliches Objekt und sieht einen spaeteren Spy zuverlaessig — in
 * echten Browsern verhaelt er sich identisch zu `window.localStorage.…(…)`.
 */
export function rememberDisplayKey(publicId: string, secret: string): void {
  try {
    Storage.prototype.setItem.call(window.localStorage, `${KEY_PREFIX}${publicId}`, secret);
  } catch {
    // Kein Gedaechtnis ist kein Fehler -- siehe Kommentar oben.
  }
}

export function recallDisplayKey(publicId: string): string | null {
  try {
    return Storage.prototype.getItem.call(window.localStorage, `${KEY_PREFIX}${publicId}`);
  } catch {
    return null;
  }
}
