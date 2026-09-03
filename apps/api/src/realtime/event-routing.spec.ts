import { describe, expect, it } from "vitest";

import { parseSubscriptionId, toBroadcast } from "./event-routing.js";

const event = {
  id: "11111111-1111-4111-8111-111111111111",
  eventType: "ENCOUNTER_SLOT_COMPLETED",
  occurredAt: new Date("2026-09-03T18:30:00.000Z"),
};

describe("toBroadcast", () => {
  it("sendet Turnierereignisse in den Turnierraum", () => {
    const broadcast = toBroadcast(
      { ...event, eventType: "TOURNAMENT_MATCH_COMPLETED" },
      { kind: "tournament", id: "22222222-2222-4222-8222-222222222222" },
    );

    expect(broadcast).toEqual({
      room: "tournament:22222222-2222-4222-8222-222222222222",
      event: "tournament:changed",
      payload: {
        eventId: event.id,
        eventType: "TOURNAMENT_MATCH_COMPLETED",
        tournamentId: "22222222-2222-4222-8222-222222222222",
        occurredAt: "2026-09-03T18:30:00.000Z",
      },
    });
  });

  it("sendet Begegnungsereignisse in den Begegnungsraum", () => {
    const broadcast = toBroadcast(event, {
      kind: "encounter",
      id: "33333333-3333-4333-8333-333333333333",
    });

    expect(broadcast).toEqual({
      room: "encounter:33333333-3333-4333-8333-333333333333",
      event: "encounter:changed",
      payload: {
        eventId: event.id,
        eventType: "ENCOUNTER_SLOT_COMPLETED",
        encounterId: "33333333-3333-4333-8333-333333333333",
        occurredAt: "2026-09-03T18:30:00.000Z",
      },
    });
  });

  it("sendet nichts ohne Geltungsbereich", () => {
    expect(toBroadcast(event, null)).toBeNull();
  });
});

describe("parseSubscriptionId", () => {
  it("nimmt eine UUID an", () => {
    expect(parseSubscriptionId("33333333-3333-4333-8333-333333333333")).toBe(
      "33333333-3333-4333-8333-333333333333",
    );
  });

  it("weist alles andere ab", () => {
    expect(parseSubscriptionId("tournament:1")).toBeNull();
    expect(parseSubscriptionId(42)).toBeNull();
    expect(parseSubscriptionId(undefined)).toBeNull();
    expect(parseSubscriptionId({ toString: () => "x" })).toBeNull();
  });
});
