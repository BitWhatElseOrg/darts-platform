import { describe, expect, it } from "vitest";
import { createClubDuelTournamentSchema } from "@darts-platform/schemas";

import { buildClubDuelCandidate } from "./club-duel-setup-values";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("buildClubDuelCandidate", () => {
  it("baut aus Formularwerten einen gültigen Vereinsduell-Körper", () => {
    const candidate = buildClubDuelCandidate({
      name: "Duell", startsAt: "2026-10-10", format: "CLUB_DUEL", startingScore: "501", inRule: "STRAIGHT", outRule: "DOUBLE",
      mode: "MATCHPLAY", bestOfLegs: "3", bestOfSets: "3", participantIds: [], groupCount: "1", qualifyPerGroup: "1", knockoutSize: "2", seeding: "SEEDED",
      boardIds: [id(90)], sideAName: " VFC ", sideBName: "DC Musterdorf", qualifyingRounds: "4", finalRoundSize: "2", thirdPlaceMatch: true,
      sideAIds: [id(1), id(2)], sideBIds: [id(3), id(4)],
    });
    const parsed = createClubDuelTournamentSchema.safeParse(candidate);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.participants).toEqual([
      { playerId: id(1), side: "A" }, { playerId: id(2), side: "A" }, { playerId: id(3), side: "B" }, { playerId: id(4), side: "B" },
    ]);
    expect(parsed.data.sideAName).toBe("VFC");
    expect(parsed.data.bestOfSets).toBe(1);
    expect(parsed.data.thirdPlaceMatch).toBe(true);
  });
});
