import type {
  MembershipStatusValue,
  OrganizationRole,
  PlayerResponse,
} from "@darts-platform/schemas";

/**
 * Suche und Filter der Spieler- und Mitgliederliste. Reine Funktionen, damit
 * sie ohne React testbar bleiben und keine Fachlogik in Komponenten wandert
 * (AGENTS.md §4). Gefiltert wird auf der ohnehin vollstaendig geladenen Liste;
 * serverseitige Filter werden erst noetig, wenn die Uebertragungsgroesse
 * stoert — nicht das Filtern selbst
 * (Spec 2026-09-15-spieler-konto-verknuepfung, E3).
 */

/**
 * Vergleichsform fuer die Suche: ohne Akzente und ohne Gross-/Kleinschreibung.
 * Ohne das findet „Muller" kein „Müller" und „Jerome" kein „Jérôme" — bei
 * Schweizer Namen faellt das sofort auf.
 */
export function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("de-CH")
    .trim();
}

function matchesSearch(
  fields: readonly (string | null | undefined)[],
  search: string,
): boolean {
  const needle = normalizeForSearch(search);
  if (needle.length === 0) return true;

  return fields.some((field) =>
    field === null || field === undefined
      ? false
      : normalizeForSearch(field).includes(needle),
  );
}

export type FilterablePlayer = Pick<
  PlayerResponse,
  "id" | "displayName" | "firstName" | "lastName" | "nickname" | "status" | "hasAccount"
>;

export interface FilterableMember {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly role: OrganizationRole;
  readonly status: MembershipStatusValue;
  readonly player: { readonly id: string; readonly displayName: string } | null;
}

export interface PlayerFilter {
  readonly search: string;
  readonly status: "ALL" | "ACTIVE" | "INACTIVE";
  /** Teamname, `ALL` oder `NONE` fuer Spieler ohne laufende Zugehoerigkeit. */
  readonly teamId: string;
  readonly account: "ALL" | "WITH" | "WITHOUT";
}

export interface MemberFilter {
  readonly search: string;
  readonly role: "ALL" | OrganizationRole;
  readonly status: "ALL" | MembershipStatusValue;
  readonly link: "ALL" | "LINKED" | "UNLINKED";
}

export const defaultPlayerFilter: PlayerFilter = {
  search: "",
  status: "ALL",
  teamId: "ALL",
  account: "ALL",
};

export const defaultMemberFilter: MemberFilter = {
  search: "",
  role: "ALL",
  status: "ALL",
  link: "ALL",
};

export function filterPlayers<T extends FilterablePlayer>(
  players: readonly T[],
  filter: PlayerFilter,
  teamsByPlayer: ReadonlyMap<string, readonly string[]>,
): T[] {
  return players.filter((player) => {
    if (
      !matchesSearch(
        [player.displayName, player.firstName, player.lastName, player.nickname],
        filter.search,
      )
    ) {
      return false;
    }
    if (filter.status !== "ALL" && player.status !== filter.status) return false;
    if (filter.account === "WITH" && !player.hasAccount) return false;
    if (filter.account === "WITHOUT" && player.hasAccount) return false;

    if (filter.teamId !== "ALL") {
      const teams = teamsByPlayer.get(player.id) ?? [];
      if (filter.teamId === "NONE") return teams.length === 0;
      // Der Captain-Zusatz gehoert zur Anzeige, nicht zur Zugehoerigkeit.
      return teams.some((team) => team.replace(" (C)", "") === filter.teamId);
    }

    return true;
  });
}

export function filterMembers<T extends FilterableMember>(
  members: readonly T[],
  filter: MemberFilter,
): T[] {
  return members.filter((member) => {
    if (!matchesSearch([member.displayName, member.email], filter.search)) {
      return false;
    }
    if (filter.role !== "ALL" && member.role !== filter.role) return false;
    if (filter.status !== "ALL" && member.status !== filter.status) return false;
    if (filter.link === "LINKED" && member.player === null) return false;
    if (filter.link === "UNLINKED" && member.player !== null) return false;
    return true;
  });
}

interface TeamLike {
  readonly name: string;
  readonly members: readonly {
    readonly playerId: string;
    readonly role: "PLAYER" | "CAPTAIN";
    readonly validTo: Date | null;
  }[];
}

/**
 * Laufende Mannschaftszugehoerigkeiten je Spieler. `validTo === null` ist die
 * aktive Zeile; beendete Zugehoerigkeiten bleiben aussen vor. Die
 * Captain-Rolle bekommt ein Textkuerzel und keine Farbe, damit die Information
 * nicht allein ueber Farbe transportiert wird (AGENTS.md §19).
 */
export function activeTeamsByPlayer(
  teams: readonly TeamLike[],
): ReadonlyMap<string, readonly string[]> {
  const byPlayer = new Map<string, string[]>();

  for (const team of teams) {
    for (const membership of team.members) {
      if (membership.validTo !== null) continue;
      const label =
        membership.role === "CAPTAIN" ? `${team.name} (C)` : team.name;
      const existing = byPlayer.get(membership.playerId);
      if (existing === undefined) {
        byPlayer.set(membership.playerId, [label]);
      } else {
        existing.push(label);
      }
    }
  }

  return byPlayer;
}

/** Die Teamnamen fuer das Auswahlfeld, ohne Captain-Zusatz und alphabetisch. */
export function teamFilterOptions(
  teamsByPlayer: ReadonlyMap<string, readonly string[]>,
): string[] {
  const names = new Set<string>();
  for (const teams of teamsByPlayer.values()) {
    for (const team of teams) names.add(team.replace(" (C)", ""));
  }
  return [...names].sort((left, right) => left.localeCompare(right, "de-CH"));
}
