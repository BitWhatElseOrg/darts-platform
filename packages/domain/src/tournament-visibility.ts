/**
 * Zwei Stufen, mehr nicht. `PRIVATE` ist die Vorgabe; `PUBLIC` gibt die
 * Ansicht ueber die `public_id` frei — wer den Link hat, sieht zu. Eine dritte
 * Stufe („gelistet") waere ein oeffentliches Verzeichnis und damit eine
 * Produktentscheidung mit eigener Oberflaeche, nicht eine weitere Konstante.
 */
export const tournamentVisibilities = ["PRIVATE", "PUBLIC"] as const;

export type TournamentVisibility = (typeof tournamentVisibilities)[number];

export function isTournamentVisibility(value: unknown): value is TournamentVisibility {
  return (
    typeof value === "string" &&
    (tournamentVisibilities as readonly string[]).includes(value)
  );
}
