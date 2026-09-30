/**
 * Geraeteschluessel eines Scheiben-Tablets (Spec 2026-09-30-scheiben-tablet).
 * Liegt im `localStorage` der installierten Web-App; jeder Zugriff in
 * `try`/`catch` wie in `display-key-storage.ts` – ein Kiosk, der an einem
 * gesperrten Speicher mit einer Ausnahme stehen bleibt, ist schlimmer als
 * einer, der neu eingerichtet werden muss.
 */
const STORAGE_KEY = "dartbase.board-device";

export interface StoredBoardDevice {
  readonly secret: string;
  readonly boardName: string;
  readonly organizationName: string;
}

/**
 * `Storage.prototype.<method>.call(window.localStorage, …)` statt
 * `window.localStorage.<method>(…)`: siehe `display-key-storage.ts` -- ein
 * `vi.spyOn` auf `Storage.prototype` bleibt so auch nach einem vorherigen
 * Zugriff wirksam.
 */
export function rememberBoardDevice(device: StoredBoardDevice): void {
  try {
    Storage.prototype.setItem.call(window.localStorage, STORAGE_KEY, JSON.stringify(device));
  } catch {
    // Kein Gedaechtnis ist kein Fehler -- siehe Kommentar oben.
  }
}

export function recallBoardDevice(): StoredBoardDevice | null {
  try {
    const raw = Storage.prototype.getItem.call(window.localStorage, STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" && parsed !== null &&
      "secret" in parsed && typeof parsed.secret === "string" && parsed.secret.startsWith("bd_") &&
      "boardName" in parsed && typeof parsed.boardName === "string" &&
      "organizationName" in parsed && typeof parsed.organizationName === "string"
    ) {
      return { secret: parsed.secret, boardName: parsed.boardName, organizationName: parsed.organizationName };
    }
    return null;
  } catch {
    return null;
  }
}

export function forgetBoardDevice(): void {
  try {
    Storage.prototype.removeItem.call(window.localStorage, STORAGE_KEY);
  } catch {
    // siehe oben
  }
}
