/**
 * Kürzel eines Vereinsnamens für enge Flächen (Scoreboard, Tablet, Tabellen).
 * Rein darstellend – der Name bleibt die Wahrheit, das Kürzel steht nie
 * allein (Spec Vereinsduell, Barrierefreiheit).
 */
export function clubAbbreviation(name: string): string {
  const words = name
    .split(/\s+/u)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((word) => word.length > 0);
  if (words.length === 0) return "";
  if (words.length === 1) return (words[0] ?? "").slice(0, 3).toUpperCase();
  return words
    .slice(0, 3)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}
