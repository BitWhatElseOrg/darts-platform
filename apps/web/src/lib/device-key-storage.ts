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

function parseStoredBoardDevice(raw: string | null): StoredBoardDevice | null {
  if (raw === null) return null;
  try {
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

export function recallBoardDevice(): StoredBoardDevice | null {
  try {
    return parseStoredBoardDevice(Storage.prototype.getItem.call(window.localStorage, STORAGE_KEY));
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

/**
 * Cache fuer `getBoardDeviceSnapshot` (Task 12, Review-Fix Hydration):
 * `JSON.parse` liefert bei jedem Aufruf ein NEUES Objekt, auch wenn der
 * gespeicherte Wert unveraendert ist. `useSyncExternalStore` vergleicht seine
 * Snapshots per `Object.is` und verlangt eine stabile Referenz, solange sich
 * nichts geaendert hat -- sonst haelt React das fuer eine tearing-Gefahr und
 * rendert in einer Schleife neu ("The result of getSnapshot should be
 * cached"). Der Cache ist an den zuletzt GELESENEN Rohwert gebunden, nicht an
 * einen Schreibzeitpunkt: jeder Aufruf liest `localStorage` frisch, eine
 * Aenderung (auch aus demselben Tab, etwa nach `forgetBoardDevice()`) wird
 * beim naechsten Aufruf also so oder so sichtbar.
 */
let cachedRaw: string | null = null;
let cachedSnapshot: StoredBoardDevice | null = null;

/**
 * Hydration-sicherer Zugriff fuer `useSyncExternalStore` (`kiosk-route.tsx`).
 * Anders als `recallBoardDevice` gibt diese Funktion bei unveraendertem Wert
 * dieselbe Objektreferenz zurueck (siehe Cache-Kommentar oben).
 */
export function getBoardDeviceSnapshot(): StoredBoardDevice | null {
  let raw: string | null;
  try {
    raw = Storage.prototype.getItem.call(window.localStorage, STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedSnapshot = parseStoredBoardDevice(raw);
  }
  return cachedSnapshot;
}

/**
 * Meldet Aenderungen am Geraeteschluessel aus ANDEREN Tabs/Fenstern
 * desselben Ursprungs -- das native `storage`-Ereignis feuert laut
 * Spezifikation nie in dem Tab, der selbst geschrieben hat. Genau das ist
 * hier erwuenscht: ein `forgetBoardDevice()` im Widerrufs-Zweig von
 * `kiosk-route.tsx` soll nicht dieselbe, gerade gemountete Komponente
 * unmounten, die bewusst die Widerrufsmeldung (samt Warteschlangen-Stand)
 * zeigt (siehe Kommentar dort) -- eine fremde Kopplungsaenderung auf einem
 * zweiten Tab/Fenster desselben Geraets soll dagegen ankommen.
 */
export function subscribeBoardDeviceChanges(onChange: () => void): () => void {
  const listener = (event: StorageEvent): void => {
    if (event.key === STORAGE_KEY || event.key === null) onChange();
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}
