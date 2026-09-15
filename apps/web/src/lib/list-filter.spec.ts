import { describe, expect, it } from "vitest";

import {
  activeTeamsByPlayer,
  defaultMemberFilter,
  defaultPlayerFilter,
  filterMembers,
  filterPlayers,
  normalizeForSearch,
  type FilterableMember,
  type FilterablePlayer,
} from "./list-filter";

function player(overrides: Partial<FilterablePlayer> = {}): FilterablePlayer {
  return {
    id: "spieler-1",
    displayName: "Anna Muster",
    firstName: "Anna",
    lastName: "Muster",
    nickname: null,
    status: "ACTIVE",
    hasAccount: false,
    ...overrides,
  };
}

function member(overrides: Partial<FilterableMember> = {}): FilterableMember {
  return {
    userId: "konto-1",
    displayName: "Anna Muster",
    email: "anna@example.test",
    role: "MEMBER",
    status: "ACTIVE",
    player: null,
    ...overrides,
  };
}

describe("normalizeForSearch", () => {
  it("entfernt Akzente und vereinheitlicht die Schreibung", () => {
    expect(normalizeForSearch("Jérôme Müller")).toBe("jerome muller");
  });

  it("schneidet aeussere Leerzeichen weg", () => {
    expect(normalizeForSearch("  Anna  ")).toBe("anna");
  });
});

describe("filterPlayers", () => {
  const anna = player({ id: "a", displayName: "Anna Müller", lastName: "Müller" });
  const bruno = player({
    id: "b",
    displayName: "Bruno Beispiel",
    firstName: "Bruno",
    lastName: "Beispiel",
    nickname: "Bulli",
    hasAccount: true,
  });
  const clara = player({
    id: "c",
    displayName: "Clara Cebulla",
    firstName: "Clara",
    lastName: "Cebulla",
    status: "INACTIVE",
  });
  const all = [anna, bruno, clara];
  const teams = new Map([
    ["a", ["Adler 1"]],
    ["b", ["Adler 1", "Adler 2"]],
  ]);

  it("gibt ohne Filter die unveraenderte Liste zurueck", () => {
    expect(filterPlayers(all, defaultPlayerFilter, teams)).toEqual(all);
  });

  it("findet Mueller ueber die Eingabe Muller", () => {
    const result = filterPlayers(
      all,
      { ...defaultPlayerFilter, search: "Muller" },
      teams,
    );

    expect(result).toEqual([anna]);
  });

  it("sucht auch im Spitznamen", () => {
    const result = filterPlayers(
      all,
      { ...defaultPlayerFilter, search: "bulli" },
      teams,
    );

    expect(result).toEqual([bruno]);
  });

  it("filtert nach Status", () => {
    const result = filterPlayers(
      all,
      { ...defaultPlayerFilter, status: "INACTIVE" },
      teams,
    );

    expect(result).toEqual([clara]);
  });

  it("kombiniert Status- und Kontofilter", () => {
    const result = filterPlayers(
      all,
      { ...defaultPlayerFilter, status: "ACTIVE", account: "WITH" },
      teams,
    );

    expect(result).toEqual([bruno]);
  });

  it("trennt Spieler ohne Team ueber teamId NONE", () => {
    const result = filterPlayers(
      all,
      { ...defaultPlayerFilter, teamId: "NONE" },
      teams,
    );

    expect(result).toEqual([clara]);
  });

  it("filtert auf ein bestimmtes Team", () => {
    const result = filterPlayers(
      all,
      { ...defaultPlayerFilter, teamId: "Adler 2" },
      teams,
    );

    expect(result).toEqual([bruno]);
  });
});

describe("filterMembers", () => {
  const owner = member({ userId: "o", displayName: "Olga Obermann", email: "olga@example.test", role: "OWNER" });
  const scorer = member({
    userId: "s",
    displayName: "Sven Schreiber",
    email: "sven@example.test",
    role: "SCORER",
    status: "SUSPENDED",
    player: { id: "p", displayName: "S. Schreiber" },
  });
  const all = [owner, scorer];

  it("sucht ueber Anzeigename und E-Mail", () => {
    expect(filterMembers(all, { ...defaultMemberFilter, search: "olga@" })).toEqual([owner]);
    expect(filterMembers(all, { ...defaultMemberFilter, search: "Sven" })).toEqual([scorer]);
  });

  it("filtert nach Rolle und Status", () => {
    expect(filterMembers(all, { ...defaultMemberFilter, role: "OWNER" })).toEqual([owner]);
    expect(filterMembers(all, { ...defaultMemberFilter, status: "SUSPENDED" })).toEqual([scorer]);
  });

  it("trennt zugeordnete von offenen Mitgliedschaften", () => {
    expect(filterMembers(all, { ...defaultMemberFilter, link: "LINKED" })).toEqual([scorer]);
    expect(filterMembers(all, { ...defaultMemberFilter, link: "UNLINKED" })).toEqual([owner]);
  });
});

describe("activeTeamsByPlayer", () => {
  it("nimmt nur laufende Zugehoerigkeiten und kennzeichnet den Captain", () => {
    const result = activeTeamsByPlayer([
      {
        name: "Adler 1",
        members: [
          { playerId: "a", role: "CAPTAIN", validTo: null },
          { playerId: "b", role: "PLAYER", validTo: null },
          { playerId: "c", role: "PLAYER", validTo: new Date("2026-01-01") },
        ],
      },
      {
        name: "Adler 2",
        members: [{ playerId: "b", role: "PLAYER", validTo: null }],
      },
    ]);

    expect(result.get("a")).toEqual(["Adler 1 (C)"]);
    expect(result.get("b")).toEqual(["Adler 1", "Adler 2"]);
    expect(result.has("c")).toBe(false);
  });
});
