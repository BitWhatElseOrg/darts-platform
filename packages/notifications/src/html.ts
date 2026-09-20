const replacements: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Entschaerft Benutzereingaben fuer die HTML-Variante einer Mail. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => replacements[character] ?? character);
}
