import { z } from "zod";

/** Die Einstellungen gehoeren zum Scoring-Geraet am Board, nicht zum Konto. */
export const scoreboardSettingsStorageKey = "dartbase.scoreboard-settings.v1";

const settingsSchema = z.object({
  mode: z.enum(["DART", "ROUND"]),
  confirmScore: z.boolean(),
  autoConfirm: z.boolean(),
  confirmCheckoutDarts: z.boolean(),
});

export type ScoreboardInputMode = z.infer<typeof settingsSchema>["mode"];
export type ScoreboardSettings = z.infer<typeof settingsSchema>;

export const defaultScoreboardSettings: ScoreboardSettings = {
  mode: "DART",
  confirmScore: true,
  autoConfirm: false,
  confirmCheckoutDarts: true,
};

export function parseScoreboardSettings(raw: string | null): ScoreboardSettings {
  if (raw === null) return defaultScoreboardSettings;
  try {
    const parsed = settingsSchema.safeParse(JSON.parse(raw) as unknown);
    return parsed.success ? parsed.data : defaultScoreboardSettings;
  } catch {
    return defaultScoreboardSettings;
  }
}

const listeners = new Set<() => void>();

export function subscribeScoreboardSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * `useSyncExternalStore` vergleicht den Schnappschuss per Referenz. Wuerde hier
 * bei jedem Aufruf ein frisches Objekt entstehen, liefe React endlos neu.
 * Deshalb haelt das Modul den zuletzt gelesenen Stand in dieser Variable und
 * ersetzt ihn nur beim Schreiben – ein erneuter Lesevorgang bei unveraendertem
 * Speicher liefert also dieselbe Objektreferenz zurueck.
 */
let snapshot: ScoreboardSettings | null = null;

function readRawSettings(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(scoreboardSettingsStorageKey);
  } catch {
    return null;
  }
}

export function readScoreboardSettings(): ScoreboardSettings {
  if (snapshot !== null) return snapshot;
  snapshot = parseScoreboardSettings(readRawSettings());
  return snapshot;
}

export function writeScoreboardSettings(settings: ScoreboardSettings): void {
  snapshot = settings;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(scoreboardSettingsStorageKey, JSON.stringify(settings));
    } catch {
      // Ein gesperrter oder fehlender Speicher darf das Scoring nicht anhalten.
    }
  }
  for (const listener of listeners) listener();
}
