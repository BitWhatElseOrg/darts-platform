import { describe, expect, it } from "vitest";

import { squadAt, type SquadMembership } from "./encounter-squad";

const spieltag = new Date("2026-09-10T20:00:00.000Z");

function membership(overrides: Partial<SquadMembership> = {}): SquadMembership {
  return {
    playerId: "spieler-1",
    displayName: "Anna Muster",
    validFrom: new Date("2026-01-01T00:00:00.000Z"),
    validTo: null,
    ...overrides,
  };
}

describe("squadAt", () => {
  it("nimmt eine laufende Zugehoerigkeit auf, die vor dem Spieltag begann", () => {
    const squad = squadAt([membership()], spieltag);

    expect(squad).toEqual([{ playerId: "spieler-1", displayName: "Anna Muster" }]);
  });

  it("laesst eine Person aus, die erst NACH dem Spieltag aufgenommen wurde", () => {
    // Der Kern des Fehlers: die Oberflaeche zeigte solche Personen als Kader
    // an und meldete sie als SQUAD, worauf der Server mit PLAYER_NOT_IN_SQUAD
    // ablehnte. Am Spieltag waren sie nicht spielberechtigt.
    const squad = squadAt(
      [membership({ validFrom: new Date("2026-09-15T00:00:00.000Z") })],
      spieltag,
    );

    expect(squad).toEqual([]);
  });

  it("laesst eine Person aus, die den Kader vor dem Spieltag verlassen hat", () => {
    const squad = squadAt(
      [membership({ validTo: new Date("2026-09-01T00:00:00.000Z") })],
      spieltag,
    );

    expect(squad).toEqual([]);
  });

  it("nimmt eine Person auf, die den Kader erst nach dem Spieltag verliess", () => {
    const squad = squadAt(
      [membership({ validTo: new Date("2026-09-20T00:00:00.000Z") })],
      spieltag,
    );

    expect(squad).toHaveLength(1);
  });

  it("behandelt den Beginn genau zum Spieltag als spielberechtigt", () => {
    // Serverseitig `validFrom <= at`, also einschliessend.
    const squad = squadAt([membership({ validFrom: spieltag })], spieltag);

    expect(squad).toHaveLength(1);
  });

  it("behandelt ein Ende genau zum Spieltag als nicht mehr spielberechtigt", () => {
    // Serverseitig `validTo > at`, also ausschliessend.
    const squad = squadAt([membership({ validTo: spieltag })], spieltag);

    expect(squad).toEqual([]);
  });

  it("sortiert nach Anzeigename", () => {
    const squad = squadAt(
      [
        membership({ playerId: "b", displayName: "Zora Zuletzt" }),
        membership({ playerId: "a", displayName: "Änni Zuerst" }),
      ],
      spieltag,
    );

    expect(squad.map((entry) => entry.playerId)).toEqual(["a", "b"]);
  });
});
