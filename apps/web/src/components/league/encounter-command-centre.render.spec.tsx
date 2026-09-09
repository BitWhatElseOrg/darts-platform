// @vitest-environment happy-dom
//
// Haelt die Reihenfolge der Alarmbaender in der Kommandozentrale fest:
// Versionskonflikt vor Entscheidungsdoppel-Hinweis vor Meldung-pruefen-
// Warnung. Ausserdem eine zweite, leicht zu uebersehende Regel: ein
// Versionskonflikt blendet den allgemeinen "Befehl nicht ausgefuehrt"-Fehler
// aus (`commands.error !== null && commands.conflict === null`) -- ohne
// diesen Test faellt ein versehentlich entfernter Guard erst im Betrieb auf,
// wenn beide Meldungen gleichzeitig aufblitzen (Backlog PR #37).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EncounterDetail } from "@darts-platform/schemas";

const client = vi.hoisted(() => ({ apiRequest: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/api-client", () => client);

const commandHook = vi.hoisted(() => ({ useEncounterCommand: vi.fn() }));
vi.mock("./use-encounter-command", () => commandHook);

import { EncounterCommandCentre } from "./encounter-command-centre";

const organizationId = "11111111-1111-4111-8111-111111111111";
const encounterId = "22222222-2222-4222-8222-222222222222";
const busyMatchId = "33333333-3333-4333-8333-333333333333";

/** Nur die Felder, die die Komponente und ihre Unterkomponenten lesen. */
const encounter = {
  id: encounterId,
  publicId: "44444444-4444-4444-8444-444444444444",
  organizationId,
  competitionId: "55555555-5555-4555-8555-555555555555",
  competitionName: "Gruppe A",
  matchday: 1,
  homeTeamId: "66666666-6666-4666-8666-666666666666",
  homeTeamName: "Bulls Ost",
  awayTeamId: "77777777-7777-4777-8777-777777777777",
  awayTeamName: "Oche West",
  scheduledAt: new Date("2026-09-10T18:30:00.000Z"),
  venue: "Clublokal",
  // Weder RUNNING noch COMPLETED noch CANCELLED: `commitmentWarning`
  // (encounter-view.ts) wertet sonst frueh auf `null` aus.
  status: "READY",
  version: 5,
  homePoints: 0,
  awayPoints: 0,
  homeGames: 0,
  awayGames: 0,
  homeLegs: 0,
  awayLegs: 0,
  result: null,
  resultType: null,
  completedAt: null,
  deciderRule: "EXTRA_SLOT",
  lineupPositions: 4,
  minNominations: 4,
  minNominationsShorthanded: 3,
  maxSubstitutionsPerEncounter: 4,
  maxDoublesPerPlayer: 1,
  decider: { status: "REQUIRED", required: true, slotSequence: 19 },
  busyPlayers: [{ playerId: "h1", matchId: busyMatchId }],
  home: {
    side: "HOME",
    teamId: "66666666-6666-4666-8666-666666666666",
    teamName: "Bulls Ost",
    submitted: true,
    revealed: true,
    nominations: [{ playerId: "h1", displayName: "Heim Eins", position: 1, origin: "SQUAD" }],
    substitutions: [],
  },
  away: {
    side: "AWAY",
    teamId: "77777777-7777-4777-8777-777777777777",
    teamName: "Oche West",
    submitted: true,
    revealed: true,
    nominations: [],
    substitutions: [],
  },
  slots: [],
} as unknown as EncounterDetail;

function wrapper({ children }: { readonly children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EncounterCommandCentre", () => {
  it("zeigt Versionskonflikt vor Entscheidungsdoppel vor Meldung-pruefen und blendet den allgemeinen Fehler bei einem Konflikt aus", () => {
    commandHook.useEncounterCommand.mockReturnValue({
      encounter,
      isPending: false,
      loadError: null,
      busy: false,
      // Bleibt bei einem Konflikt unsichtbar -- siehe Kommentar oben.
      error: "Befehl nicht ausgeführt",
      conflict: { expected: 4, server: 5, currentState: encounter },
      announcement: "",
      realtime: "verbunden",
      acceptServerState: vi.fn(),
      run: vi.fn().mockResolvedValue(true),
    });

    const { container } = render(createElement(EncounterCommandCentre, {
      abilities: { manage: false, lineup: false, score: false },
      encounterId,
      organizationId,
    }), { wrapper });

    expect(screen.queryByText("Befehl nicht ausgeführt")).toBeNull();

    const text = container.textContent ?? "";
    const conflictIndex = text.indexOf("Versionskonflikt");
    const deciderIndex = text.indexOf("Entscheidungsdoppel");
    const commitmentIndex = text.indexOf("Meldung prüfen");
    expect(conflictIndex).toBeGreaterThanOrEqual(0);
    expect(deciderIndex).toBeGreaterThan(conflictIndex);
    expect(commitmentIndex).toBeGreaterThan(deciderIndex);
  });
});
