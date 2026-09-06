const slugReplacements: Readonly<Record<string, string>> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  Ä: "ae",
  Ö: "oe",
  Ü: "ue",
  ß: "ss",
};

/**
 * Der Vertrag verlangt `^[a-z0-9]+(?:-[a-z0-9]+)*$`. Umlaute werden
 * ausgeschrieben statt entfernt, damit „Gruppe Süd" nicht zu „gruppe-sd" wird.
 */
export function slugFromName(name: string): string {
  return name
    .replace(/[äöüÄÖÜß]/gu, (character) => slugReplacements[character] ?? character)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}
