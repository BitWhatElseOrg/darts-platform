import { describe, expect, it } from "vitest";

import { matchBackLink, matchScoreboardHref } from "./match-navigation";

const ORG = "11111111-1111-4111-8111-111111111111";
const ENCOUNTER = "22222222-2222-4222-8222-222222222222";
const MATCH = "33333333-3333-4333-8333-333333333333";

describe("matchScoreboardHref", () => {
  it("carries the encounter along so the scoreboard can lead back to it", () => {
    expect(matchScoreboardHref({ matchId: MATCH, organizationId: ORG, encounterId: ENCOUNTER })).toBe(
      `/matches/${MATCH}?organisation=${ORG}&begegnung=${ENCOUNTER}`,
    );
  });

  it("omits the encounter when the match does not belong to one", () => {
    expect(matchScoreboardHref({ matchId: MATCH, organizationId: ORG })).toBe(
      `/matches/${MATCH}?organisation=${ORG}`,
    );
  });
});

describe("matchBackLink", () => {
  it("leads back to the encounter the scoreboard was opened from", () => {
    expect(matchBackLink({ organizationId: ORG, encounterId: ENCOUNTER })).toEqual({
      href: `/liga/begegnungen/${ENCOUNTER}?organisation=${ORG}`,
      label: "Zur Begegnung",
    });
  });

  it("falls back to the match overview without an encounter", () => {
    expect(matchBackLink({ organizationId: ORG })).toEqual({
      href: `/matches?organisation=${ORG}`,
      label: "Zur Übersicht",
    });
  });

  it("refuses an encounter id that is not a uuid", () => {
    // Der Wert kommt aus der Adresszeile; ein Link daraus wäre sonst frei wählbar.
    expect(matchBackLink({ organizationId: ORG, encounterId: "javascript:alert(1)" })).toEqual({
      href: `/matches?organisation=${ORG}`,
      label: "Zur Übersicht",
    });
  });
});
