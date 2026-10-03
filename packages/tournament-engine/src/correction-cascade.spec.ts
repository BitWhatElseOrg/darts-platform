import { describe, expect, it } from "vitest";

import { planCorrectionCascade, type CorrectionCascadeMatch } from "./correction-cascade";

const match = (
  id: string,
  status: CorrectionCascadeMatch["status"],
  sourceOneMatchId: string | null = null,
  sourceTwoMatchId: string | null = null,
): CorrectionCascadeMatch => ({ id, status, sourceOneMatchId, sourceTwoMatchId });

describe("planCorrectionCascade", () => {
  it("leert nur den direkten Platz, wenn das abhängige Spiel noch wartet", () => {
    expect(planCorrectionCascade([match("qf1", "COMPLETED"), match("sf1", "READY", "qf1", "qf2")], "qf1")).toEqual({
      blocked: false,
      steps: [{ matchId: "sf1", clearSlotOne: true, clearSlotTwo: false, reopen: false }],
    });
  });

  it("öffnet ein Bye wieder und leert den Platz, den es weitergegeben hat", () => {
    const plan = planCorrectionCascade(
      [
        match("qf1", "COMPLETED"),
        match("qf2", "CANCELLED"),
        match("sf1", "BYE", "qf1", "qf2"),
        match("final", "WAITING", "sf1", "sf2"),
      ],
      "qf1",
    );
    expect(plan).toEqual({
      blocked: false,
      steps: [
        { matchId: "sf1", clearSlotOne: true, clearSlotTwo: false, reopen: true },
        { matchId: "final", clearSlotOne: true, clearSlotTwo: false, reopen: false },
      ],
    });
  });

  it("folgt einer Kette aus Bye und abgesagtem Spiel über mehrere Stufen", () => {
    const plan = planCorrectionCascade(
      [
        match("a", "COMPLETED"),
        match("b", "CANCELLED", "a", "x"),
        match("c", "BYE", "y", "b"),
        match("d", "READY", "c", "z"),
      ],
      "a",
    );
    expect(plan).toEqual({
      blocked: false,
      steps: [
        { matchId: "b", clearSlotOne: true, clearSlotTwo: false, reopen: true },
        { matchId: "c", clearSlotOne: false, clearSlotTwo: true, reopen: true },
        { matchId: "d", clearSlotOne: true, clearSlotTwo: false, reopen: false },
      ],
    });
  });

  it("blockiert, sobald irgendwo in der Kette ein Spiel läuft oder abgeschlossen ist", () => {
    expect(
      planCorrectionCascade(
        [match("qf1", "COMPLETED"), match("sf1", "BYE", "qf1", "qf2"), match("final", "IN_PROGRESS", "sf1", "sf2")],
        "qf1",
      ),
    ).toEqual({ blocked: true, blockingMatchId: "final" });
    expect(
      planCorrectionCascade([match("qf1", "COMPLETED"), match("sf1", "COMPLETED", "qf1", "qf2")], "qf1"),
    ).toEqual({ blocked: true, blockingMatchId: "sf1" });
  });

  it("führt ein Spiel, das an zwei geöffneten Quellen hängt, nur einmal mit beiden Plätzen", () => {
    const plan = planCorrectionCascade(
      [
        match("root", "COMPLETED"),
        match("bye1", "BYE", "root", "n1"),
        match("bye2", "BYE", "n2", "root"),
        match("next", "WAITING", "bye1", "bye2"),
      ],
      "root",
    );
    expect(plan).toEqual({
      blocked: false,
      steps: [
        { matchId: "bye1", clearSlotOne: true, clearSlotTwo: false, reopen: true },
        { matchId: "bye2", clearSlotOne: false, clearSlotTwo: true, reopen: true },
        { matchId: "next", clearSlotOne: true, clearSlotTwo: true, reopen: false },
      ],
    });
  });
});
