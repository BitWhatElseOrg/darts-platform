/**
 * Welche Organisation die Arbeitsfläche zeigt.
 *
 * Die Auswahl lag bisher allein in der Adresszeile (`?organisation=`), und wo
 * der Parameter fehlte, gewann die erste Organisation der Liste. Über jeden
 * Link ohne Parameter — «Übersicht» etwa — fiel die Auswahl damit auf eine
 * andere Organisation zurück. In einer Mehrmandanten-Oberfläche ist das nicht
 * bloss lästig: wer glaubt, in Organisation B zu arbeiten, legt Turniere,
 * Teams und Matches in A an.
 *
 * Deshalb wird die zuletzt eingestellte Organisation im Browser gemerkt und
 * gilt weiter, solange die Adresse keine andere ausdrücklich nennt. Sie ändert
 * sich nur durch eine ausdrückliche Wahl.
 *
 * Der gespeicherte Wert ist eine Bequemlichkeit, keine Berechtigung: er wird
 * bei jedem Lesen gegen die vom Server gelieferte Liste geprüft
 * (`resolveOrganization`). Ein Konto sieht dadurch nie eine Organisation, auf
 * die es keinen Zugriff hat — die Prüfung liegt ohnehin serverseitig.
 */

/** Die Auswahl gehört zum Gerät, nicht zum Konto — wie die Scoreboard-Einstellungen. */
export const organizationSelectionStorageKey = "dartbase.organization.v1";

/** Der Ausschnitt, den die Auflösung braucht. */
interface SelectableOrganization {
  readonly id: string;
}

/**
 * Welche Organisation gilt.
 *
 * 1. die in der Adresse genannte, wenn sie zugänglich ist,
 * 2. sonst die zuletzt gemerkte, wenn sie zugänglich ist,
 * 3. sonst die erste zugängliche — nur beim allerersten Besuch,
 * 4. sonst keine.
 *
 * Schritt 3 ist die einzige Stelle, an der die Auswahl ohne Zutun entsteht;
 * sie wird danach gemerkt und von Schritt 2 gehalten.
 */
export function resolveOrganization<T extends SelectableOrganization>(input: {
  readonly organizations: readonly T[] | undefined;
  readonly requestedId: string | undefined;
  readonly rememberedId: string | null;
}): T | null {
  const { organizations } = input;
  if (organizations === undefined) return null;
  const accessible = (id: string | null | undefined): T | null =>
    id === null || id === undefined
      ? null
      : (organizations.find((candidate) => candidate.id === id) ?? null);
  return accessible(input.requestedId) ?? accessible(input.rememberedId) ?? organizations[0] ?? null;
}

const listeners = new Set<() => void>();

export function subscribeOrganizationSelection(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Der zuletzt gemerkte Wert, oder `null`. Fällt auf `null` zurück, wo es
 * keinen Speicher gibt (Server-Rendering) oder er verweigert wird (privates
 * Fenster, gesperrte Website-Daten) — die Fläche bleibt dann beim bisherigen
 * Verhalten, statt zu scheitern.
 */
export function readOrganizationSelection(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(organizationSelectionStorageKey);
  } catch {
    return null;
  }
}

/** Beim Server-Rendering ist nichts gemerkt; sonst liefe die Hydratation auseinander. */
export function readServerOrganizationSelection(): null {
  return null;
}

export function writeOrganizationSelection(organizationId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(organizationSelectionStorageKey, organizationId);
  } catch {
    // Ohne Speicher bleibt die Auswahl auf die Adresszeile beschränkt.
  }
  for (const listener of listeners) listener();
}
