// @vitest-environment happy-dom
//
// Haelt den Korrekturweg aus der Liga-Begegnung fest (Spec
// 2026-10-01-liga-resultatkorrektur §4): der Knopf "Resultat korrigieren"
// erscheint nur bei abgeschlossener Begegnung, an einem gespielten Slot, und
// nur mit `encounter:manage`; das Feld "Korrekturgrund" wird nur im offenen
// Zustand gemountet und "Korrektur starten" erst ab drei Zeichen aktiv; nach
// dem Wiedereroeffnen (Slot laeuft) fuehrt "Zum Scoreboard" zur Scoringflaeche.
import type { EncounterDetail, EncounterSlotView } from "@darts-platform/schemas";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SlotList } from "./slot-list";

const organizationId = "11111111-1111-4111-8111-111111111111";
const encounterId = "22222222-2222-4222-8222-222222222222";
const slotId = "33333333-3333-4333-8333-333333333333";
const matchId = "44444444-4444-4444-8444-444444444444";
const deciderSlotId = "55555555-5555-4555-8555-555555555555";

const baseSlot: EncounterSlotView = {
  id: slotId,
  sequence: 1,
  role: "REGULAR",
  discipline: "SINGLES",
  label: "Einzel 1",
  homePosition: 1,
  awayPosition: 1,
  startingScore: 501,
  inRule: "STRAIGHT",
  outRule: "DOUBLE",
  maxRounds: null,
  bestOfLegs: 5,
  legsToWinSet: 3,
  setsToWin: 1,
  status: "COMPLETED",
  boardId: null,
  boardName: "Board 1",
  matchId,
  winnerSide: "HOME",
  resultType: "PLAYED",
  homeLegs: 3,
  awayLegs: 1,
  version: 1,
  completedAt: new Date("2026-09-10T20:00:00.000Z"),
  home: { players: [{ playerId: "h1", displayName: "Heim Eins" }], complete: true },
  away: { players: [{ playerId: "a1", displayName: "Gast Eins" }], complete: true },
} as unknown as EncounterSlotView;

function baseEncounter(overrides: {
  readonly status?: EncounterDetail["status"];
  readonly slot?: Partial<EncounterSlotView>;
  readonly decider?: Partial<EncounterDetail["decider"]>;
  readonly deciderSlot?: Partial<EncounterSlotView>;
}): EncounterDetail {
  const slots: EncounterSlotView[] = [{ ...baseSlot, ...overrides.slot }];
  if (overrides.deciderSlot !== undefined) {
    slots.push({
      ...baseSlot,
      id: deciderSlotId,
      sequence: 19,
      role: "DECIDER",
      label: "Entscheidungsdoppel",
      ...overrides.deciderSlot,
    });
  }
  return {
    id: encounterId,
    status: overrides.status ?? "COMPLETED",
    decider: { status: "NOT_REQUIRED", required: false, slotSequence: null, ...overrides.decider },
    busyPlayers: [],
    slots,
  } as unknown as EncounterDetail;
}

function renderSlotList(input: {
  readonly encounter: EncounterDetail;
  readonly canManage: boolean;
  readonly onCorrect?: (slotId: string, reason: string) => void;
}) {
  return render(
    createElement(SlotList, {
      boards: [],
      busy: false,
      canManage: input.canManage,
      canScore: false,
      encounter: input.encounter,
      onAssign: vi.fn(),
      onCorrect: input.onCorrect ?? vi.fn(),
      onRelease: vi.fn(),
      onWalkover: vi.fn(),
      organizationId,
    }),
  );
}

afterEach(() => {
  cleanup();
});

describe("SlotList Resultatkorrektur", () => {
  it("zeigt den Knopf bei abgeschlossener Begegnung, gespieltem Slot und encounter:manage", () => {
    renderSlotList({ encounter: baseEncounter({}), canManage: true });

    expect(screen.getByRole("button", { name: "Resultat korrigieren" })).toBeTruthy();
  });

  it("zeigt den Knopf nicht, solange die Begegnung nicht abgeschlossen ist", () => {
    renderSlotList({ encounter: baseEncounter({ status: "RUNNING" }), canManage: true });

    expect(screen.queryByRole("button", { name: "Resultat korrigieren" })).toBeNull();
  });

  it("zeigt den Knopf nicht an einem kampflos gewerteten Slot", () => {
    renderSlotList({
      encounter: baseEncounter({ slot: { resultType: "WALKOVER", status: "WALKOVER" } }),
      canManage: true,
    });

    expect(screen.queryByRole("button", { name: "Resultat korrigieren" })).toBeNull();
  });

  it("zeigt den Knopf nicht ohne encounter:manage", () => {
    renderSlotList({ encounter: baseEncounter({}), canManage: false });

    expect(screen.queryByRole("button", { name: "Resultat korrigieren" })).toBeNull();
  });

  it("mountet das Feld Korrekturgrund erst nach Klick und aktiviert Korrektur starten erst ab drei Zeichen", () => {
    renderSlotList({ encounter: baseEncounter({}), canManage: true });

    expect(screen.queryByLabelText("Korrekturgrund")).toBeNull();
    expect(screen.queryByRole("button", { name: "Korrektur starten" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Resultat korrigieren" }));

    const field = screen.getByLabelText("Korrekturgrund") as HTMLTextAreaElement;
    expect(field).toBeTruthy();
    expect(field.maxLength).toBe(500);
    const submitButton = () =>
      screen.getByRole("button", { name: "Korrektur starten" }) as HTMLButtonElement;
    expect(submitButton().disabled).toBe(true);

    fireEvent.change(field, { target: { value: "ab" } });
    expect(submitButton().disabled).toBe(true);

    fireEvent.change(field, { target: { value: "abc" } });
    expect(submitButton().disabled).toBe(false);
  });

  it("sendet slotId und den getrimmten Grund an onCorrect", () => {
    const onCorrect = vi.fn();
    renderSlotList({ encounter: baseEncounter({}), canManage: true, onCorrect });

    fireEvent.click(screen.getByRole("button", { name: "Resultat korrigieren" }));
    fireEvent.change(screen.getByLabelText("Korrekturgrund"), {
      target: { value: "  Aufnahme falsch erfasst  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Korrektur starten" }));

    expect(onCorrect).toHaveBeenCalledWith(slotId, "Aufnahme falsch erfasst");
  });

  it("zeigt nach dem Wiedereroeffnen einen Link Zum Scoreboard auf die Scoringflaeche des Matches", () => {
    renderSlotList({
      encounter: baseEncounter({ status: "RUNNING", slot: { status: "IN_PROGRESS" } }),
      canManage: true,
    });

    const link = screen.getByRole("link", { name: "Zum Scoreboard" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(
      `/matches/${matchId}?organisation=${organizationId}&begegnung=${encounterId}`,
    );
  });

  it("blendet den Knopf an einem regulären Spiel aus und zeigt stattdessen den Hinweis, wenn das Entscheidungsdoppel gespielt wurde", () => {
    renderSlotList({
      encounter: baseEncounter({
        decider: { status: "COMPLETED" },
        deciderSlot: { status: "COMPLETED", resultType: "PLAYED" },
      }),
      canManage: true,
    });

    // Der Decider-Slot selbst bleibt korrigierbar — nur das reguläre Spiel
    // ist blockiert. Genau ein Knopf (der des Deciders) bleibt stehen.
    expect(screen.getAllByRole("button", { name: "Resultat korrigieren" })).toHaveLength(1);
    expect(screen.getByText("Zuerst das Entscheidungsdoppel korrigieren.")).toBeTruthy();
  });

  it("zeigt weder Knopf noch Hinweis an einem regulären Spiel, wenn das Entscheidungsdoppel kampflos entschieden wurde", () => {
    renderSlotList({
      encounter: baseEncounter({
        decider: { status: "COMPLETED" },
        deciderSlot: { status: "WALKOVER", resultType: "WALKOVER" },
      }),
      canManage: true,
    });

    expect(screen.queryByRole("button", { name: "Resultat korrigieren" })).toBeNull();
    expect(screen.queryByText("Zuerst das Entscheidungsdoppel korrigieren.")).toBeNull();
  });

  it("zeigt den Knopf am Entscheidungsdoppel selbst, auch wenn es bereits gespielt ist", () => {
    renderSlotList({
      encounter: baseEncounter({
        slot: { id: deciderSlotId, sequence: 19, role: "DECIDER", matchId },
        decider: { status: "COMPLETED" },
      }),
      canManage: true,
    });

    expect(screen.getByRole("button", { name: "Resultat korrigieren" })).toBeTruthy();
  });
});
