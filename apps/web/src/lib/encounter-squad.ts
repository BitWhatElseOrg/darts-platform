/**
 * Wer am Spieltag zum Kader gehoert.
 *
 * Der Server loest den Kader einer Begegnung ueber
 * `encounters.repository.ts#loadSquad` zum Termin der Begegnung auf:
 * `validFrom <= scheduledAt` und `validTo is null or validTo > scheduledAt`.
 * Das ist die Spielberechtigung am Spieltag — wer erst danach in die
 * Mannschaft kam, war an diesem Abend nicht spielberechtigt.
 *
 * Die Aufstellungsmaske hat diesen Zeitbezug bis 2026-09-15 ignoriert und nur
 * `validTo === null` geprueft, also „heute im Team". Bei einer Begegnung, die
 * vor einer Kaderaufnahme liegt, bot sie die Person deshalb unter „Kader" an
 * und meldete sie als `origin: "SQUAD"`; der Server lehnte mit
 * `PLAYER_NOT_IN_SQUAD` ab. Diese Funktion bildet den Serverbegriff genau
 * nach, damit Maske und Prueflogik dieselbe Frage beantworten.
 */
export interface SquadMembership {
  readonly playerId: string;
  readonly displayName: string;
  readonly validFrom: Date;
  readonly validTo: Date | null;
}

export interface SquadEntry {
  readonly playerId: string;
  readonly displayName: string;
}

export function squadAt(
  members: readonly SquadMembership[],
  at: Date,
): SquadEntry[] {
  return members
    .filter(
      (member) =>
        member.validFrom.getTime() <= at.getTime() &&
        (member.validTo === null || member.validTo.getTime() > at.getTime()),
    )
    .map((member) => ({ playerId: member.playerId, displayName: member.displayName }))
    .sort((first, second) =>
      first.displayName.localeCompare(second.displayName, "de-CH"),
    );
}
