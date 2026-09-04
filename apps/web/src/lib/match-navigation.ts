/**
 * Der Weg zwischen Begegnung und Scoreboard. An einem Ligaabend wird er nach
 * jedem Spiel gegangen; deshalb trägt der Link die Begegnung mit, statt die
 * Spielleitung über die Startseite zurückzuschicken.
 */

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface BackLink {
  readonly href: string;
  readonly label: string;
}

export function matchScoreboardHref(input: {
  readonly matchId: string;
  readonly organizationId: string;
  readonly encounterId?: string;
}): string {
  const base = `/matches/${input.matchId}?organisation=${input.organizationId}`;
  return input.encounterId === undefined ? base : `${base}&begegnung=${input.encounterId}`;
}

export function matchBackLink(input: {
  readonly organizationId: string;
  readonly encounterId?: string | null;
}): BackLink {
  // Der Wert stammt aus der Adresszeile und wird nie ungeprüft zu einem Link.
  if (input.encounterId === undefined || input.encounterId === null) {
    return { href: "/", label: "Zurück" };
  }
  if (!uuidPattern.test(input.encounterId)) return { href: "/", label: "Zurück" };
  return {
    href: `/liga/begegnungen/${input.encounterId}?organisation=${input.organizationId}`,
    label: "Zur Begegnung",
  };
}
