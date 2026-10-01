// @vitest-environment happy-dom
//
// Kiosk `/scheibe` (Spec 2026-09-30-scheiben-tablet, Task 11). Muster:
// `board-devices-section.render.spec.tsx` -- `apiRequest` gemockt, keine
// echte Netzwerkschicht. `MatchScoreboard` ist eine eigene, ausfuehrlich
// getestete Flaeche (`match-scoreboard.render.spec.tsx`); hier zaehlt nur,
// dass der Kiosk sie mit den richtigen Props aufruft -- deshalb eine
// Attrappe statt der echten Komponente.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "@/lib/api-error";
import { KIOSK_POLL_MS } from "./kiosk-view";

const routerReplace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace }),
}));

const deviceKeyStorage = vi.hoisted(() => ({
  stored: null as { readonly secret: string; readonly boardName: string; readonly organizationName: string } | null,
  forgetBoardDevice: vi.fn(),
  // `onChange`, das `KioskRoute` beim Abonnieren uebergibt -- ein Test ruft
  // es gezielt auf, um einen ECHTEN
  // Wechsel aus einem anderen Tab/Fenster zu simulieren (Spec §4). Ohne
  // diesen Aufruf bleibt die Attrappe ein No-op wie zuvor.
  crossTabOnChange: null as (() => void) | null,
}));
vi.mock("@/lib/device-key-storage", () => ({
  // `getBoardDeviceSnapshot`/`subscribeBoardDeviceChanges` ersetzen das
  // fruehere `recallBoardDevice()` in `kiosk-route.tsx` (Task 12,
  // Hydration-Review-Fix) -- `deviceKeyStorage.stored` ist hier bereits eine
  // stabile Referenz (von `beforeEach`/den einzelnen Faellen gesetzt), die
  // Attrappe braucht also keinen eigenen Cache.
  getBoardDeviceSnapshot: () => deviceKeyStorage.stored,
  subscribeBoardDeviceChanges: (onChange: () => void) => {
    deviceKeyStorage.crossTabOnChange = onChange;
    return () => {
      deviceKeyStorage.crossTabOnChange = null;
    };
  },
  forgetBoardDevice: deviceKeyStorage.forgetBoardDevice,
}));

const offlineQueue = vi.hoisted(() => ({
  commands: [] as unknown[],
  calls: [] as string[],
  // Testweise vorab hinterlegte, kontrollierbare Antworten fuer den
  // Wettlauf-Fall (zwei Ablehnungen kurz hintereinander) -- in allen anderen
  // Faellen leer, der Mock faellt dann auf `commands` zurueck wie zuvor.
  queuedResponses: [] as Promise<unknown[]>[],
}));
vi.mock("@/lib/offline-command-queue", () => ({
  listOfflineCommands: vi.fn((scope: string) => {
    offlineQueue.calls.push(scope);
    const queued = offlineQueue.queuedResponses.shift();
    return queued ?? Promise.resolve(offlineQueue.commands);
  }),
}));

const matchScoreboard = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }));
vi.mock("@/components/match/match-scoreboard", () => ({
  MatchScoreboard: (props: Record<string, unknown>) => {
    matchScoreboard.calls.push(props);
    return createElement("div", { "data-testid": "match-scoreboard-stub" }, "Scoreboard-Attrappe");
  },
}));

const server = vi.hoisted(() => ({
  self: null as unknown,
  selfRejection: null as unknown,
  match: null as unknown,
  matchRejection: null as unknown,
}));

const client = vi.hoisted(() => ({
  apiRequest: vi.fn((input: { readonly path: string; readonly deviceSecret?: string }) => {
    if (input.path === "/board-devices/me") {
      if (server.selfRejection !== null) return Promise.reject(server.selfRejection);
      return Promise.resolve(server.self);
    }
    if (input.path.includes("/matches/")) {
      if (server.matchRejection !== null) return Promise.reject(server.matchRejection);
      return Promise.resolve(server.match);
    }
    return Promise.reject(new Error(`Unerwarteter Aufruf: ${input.path}`));
  }),
}));
vi.mock("@/lib/api-client", () => client);

import { KioskRoute } from "./kiosk-route";

const organizationId = "11111111-1111-4111-8111-111111111111";
const matchId = "22222222-2222-4222-8222-222222222222";
const deviceSecret = "bd_kiosk-secret";

const selfResponse = (currentMatchId: string | null) => ({
  device: { id: "55555555-5555-4555-8555-555555555555", label: "Tablet" },
  board: { id: "33333333-3333-4333-8333-333333333333", name: "Scheibe 1" },
  organization: { id: organizationId, name: "VFC Musterstadt" },
  currentMatchId,
});

const matchState = {
  id: matchId,
  organizationId,
  boardId: "33333333-3333-4333-8333-333333333333",
  boardName: "Scheibe 1",
  status: "IN_PROGRESS",
  version: 1,
  startingScore: 501,
  inRule: "STRAIGHT_IN",
  outRule: "DOUBLE_OUT",
  legStartRule: "BULL_FIRST_LEG",
  legStartPending: false,
  roundLimitReached: false,
  bestOfLegs: 1,
  legsToWin: 1,
  bestOfSets: 1,
  setsToWin: 1,
  currentSetNumber: 1,
  currentLegNumber: 1,
  currentLegVersion: 0,
  currentPlayerId: "44444444-4444-4444-8444-444444444444",
  winnerPlayerId: null,
  participants: [],
  visits: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  liveTarget: null,
};

function renderRoute() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(createElement(QueryClientProvider, { client: queryClient }, createElement(KioskRoute)));
  return { ...view, queryClient };
}

/**
 * Rendert `KioskRoute` unter einem Wrapper, der sich selbst auf Zuruf neu
 * rendert (`forceRerender`) -- ohne dass `KioskRoute` selbst ein Update
 * angestossen oder `subscribeBoardDeviceChanges` benachrichtigt hat. Das
 * bildet genau den Fall nach, den der Fix abdeckt: `KioskRoute` ist nicht
 * memoisiert, re-rendert also mit, wenn sein eigener Vorfahre aus einem
 * davon unabhaengigen Grund neu rendert -- `useSyncExternalStore` liest
 * dabei denselben frischen `getSnapshot()`-Wert wie bei einem echt
 * benachrichtigten Render.
 */
function renderHarness() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let bump: (() => void) | null = null;
  function Harness() {
    const [, setTick] = useState(0);
    useEffect(() => {
      bump = () => setTick((value) => value + 1);
      return () => {
        bump = null;
      };
    }, []);
    return createElement(KioskRoute);
  }
  const view = render(createElement(QueryClientProvider, { client: queryClient }, createElement(Harness)));
  return {
    ...view,
    queryClient,
    forceRerender: () => {
      if (bump === null) throw new Error("Harness ist nicht montiert.");
      bump();
    },
  };
}

beforeEach(() => {
  deviceKeyStorage.stored = null;
  deviceKeyStorage.forgetBoardDevice.mockReset();
  deviceKeyStorage.crossTabOnChange = null;
  routerReplace.mockClear();
  server.self = null;
  server.selfRejection = null;
  server.match = null;
  server.matchRejection = null;
  client.apiRequest.mockClear();
  matchScoreboard.calls = [];
  offlineQueue.commands = [];
  offlineQueue.calls = [];
  offlineQueue.queuedResponses = [];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("KioskRoute", () => {
  it("zeigt ohne gespeicherten Geraeteschluessel einen Hinweis mit Link zur Startseite", () => {
    deviceKeyStorage.stored = null;
    renderRoute();

    expect(screen.getByText("Dieses Tablet ist nicht gekoppelt.")).not.toBeNull();
    const link = screen.getByRole("link", { name: "Zur Startseite" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/");
    expect(client.apiRequest).not.toHaveBeenCalled();
  });

  it("zeigt den Leerlauf mit Scheiben- und Organisationsnamen ohne laufendes Match", async () => {
    deviceKeyStorage.stored = { secret: deviceSecret, boardName: "Scheibe 1", organizationName: "VFC Musterstadt" };
    server.self = selfResponse(null);
    renderRoute();

    await screen.findByText("Scheibe 1 – wartet auf nächstes Match");
    expect(screen.getByText("VFC Musterstadt")).not.toBeNull();
    expect(client.apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/board-devices/me", deviceSecret }),
    );
  });

  it("rendert die Scoringflaeche fuer das laufende Match der Scheibe", async () => {
    deviceKeyStorage.stored = { secret: deviceSecret, boardName: "Scheibe 1", organizationName: "VFC Musterstadt" };
    server.self = selfResponse(matchId);
    server.match = matchState;
    renderRoute();

    await screen.findByTestId("match-scoreboard-stub");
    const props = matchScoreboard.calls.at(-1)!;
    expect(props.canScore).toBe(true);
    expect(props.canAbort).toBe(false);
    expect(props.backHref).toBeUndefined();
    expect(props.showHeaderLinks).toBe(false);
    expect(props.organizationId).toBe(organizationId);
    expect((props.match as { readonly id: string }).id).toBe(matchId);

    expect(client.apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({ path: `/organizations/${organizationId}/matches/${matchId}`, deviceSecret }),
    );

    // Abschlussreview-Befund 5 (final-fix-findings.md): die eigene
    // Statuszeile des Kiosk stand bisher zusaetzlich zu der des (echten)
    // `MatchScoreboard` -- zwei sichtbare "status"-Leisten uebereinander, von
    // denen die aeussere nie etwas anzeigt (Kiosk kennt weder Sperre noch
    // Warteschlange). `MatchScoreboard` ist hier eine Attrappe ohne eigenen
    // `role="status"`, daher zaehlt ein direkter DOM-Scan statt
    // `getAllByRole`.
    expect(document.querySelectorAll('[role="status"]').length).toBe(0);
  });

  it("vergisst den Geraeteschluessel und meldet den Widerruf", async () => {
    deviceKeyStorage.stored = { secret: deviceSecret, boardName: "Scheibe 1", organizationName: "VFC Musterstadt" };
    server.selfRejection = new ApiClientError("Dieses Tablet ist nicht mehr gekoppelt.", "DEVICE_REVOKED", null, undefined, 401);
    renderRoute();

    await waitFor(() => {
      expect(deviceKeyStorage.forgetBoardDevice).toHaveBeenCalled();
    });
    expect(
      screen.getByText(
        "Dieses Tablet ist nicht mehr gekoppelt – bitte in der Organisationsverwaltung unter «Scheiben-Tablets» neu einrichten.",
      ),
    ).not.toBeNull();
  });

  // Task-Review-Befund CRITICAL 1: `/me` meldet weiterhin dasselbe Match,
  // dessen Lesepfad bereits 404 geliefert hat (der Server hat die Zuweisung
  // noch nicht aufgeloest). Ohne die Ablehnungs-Wache setzte die
  // Render-Anpassung `currentMatchId` aus der (unveraenderten) `/me`-Antwort
  // sofort wieder auf das abgelehnte Match zurueck, die Match-Query lehnte es
  // (aus dem Cache) erneut ab -- eine synchrone Render-Schleife ("Too many
  // re-renders"). `findByText` unten wuerde mit genau diesem Fehler
  // fehlschlagen, liefe die Schleife noch.
  it("faellt nach 404 in den Leerlauf zurueck, auch wenn /me weiter dasselbe Match meldet", async () => {
    deviceKeyStorage.stored = { secret: deviceSecret, boardName: "Scheibe 1", organizationName: "VFC Musterstadt" };
    server.self = selfResponse(matchId);
    server.matchRejection = new ApiClientError("Dieses Match gibt es nicht mehr.", "REQUEST_FAILED", null, undefined, 404);
    renderRoute();

    // Erst die Ladeanzeige abwarten -- sie erscheint nur, wenn `matchId`
    // tatsaechlich aktiv wurde und die (gleich abgelehnte) Match-Query
    // lief. Der Leerlauftext allein waere kein Beweis: er steht (mit dem
    // Namen aus `localStorage`) schon beim allerersten, noch leeren Render.
    await screen.findByText("Match wird geladen …");
    await waitFor(() => {
      expect(screen.queryByText("Match wird geladen …")).toBeNull();
    });
    expect(screen.getByText("Scheibe 1 – wartet auf nächstes Match")).not.toBeNull();
    expect(client.apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({ path: `/organizations/${organizationId}/matches/${matchId}` }),
    );
  });

  // Task-Review-Befund IMPORTANT 2: `/me` meldet `currentMatchId: null`,
  // bevor die Match-Query den COMPLETED-Status gesehen hat. Der Kiosk muss
  // das zuletzt laufende Match noch einmal laden, statt sofort in den
  // Leerlauf zu springen -- sonst erscheint der Endstand nie.
  it("zeigt den Endstand, auch wenn /me das Match schon vor dem COMPLETED-Poll nicht mehr als aktuell meldet", async () => {
    deviceKeyStorage.stored = { secret: deviceSecret, boardName: "Scheibe 1", organizationName: "VFC Musterstadt" };
    server.self = selfResponse(matchId);
    server.match = matchState;
    const { queryClient } = renderRoute();

    await screen.findByTestId("match-scoreboard-stub");

    // Naechster Poll: `/me` kennt kein laufendes Match mehr, die Match-Query
    // sieht gleichzeitig den COMPLETED-Uebergang.
    server.self = selfResponse(null);
    server.match = { ...matchState, status: "COMPLETED" };
    await act(async () => {
      await queryClient.refetchQueries();
    });

    const weiterButton = await screen.findByRole("button", { name: "Weiter" });
    expect(screen.getByTestId("match-scoreboard-stub")).not.toBeNull();

    fireEvent.click(weiterButton);
    await screen.findByText("Scheibe 1 – wartet auf nächstes Match");
  });

  // Task 12, E2E-Befund `board-device-kiosk.spec.ts`: `useMatchScoring`
  // invalidiert die Match-Query direkt nach einem erfolgreichen Checkout --
  // dieser Poll sieht den COMPLETED-Uebergang deshalb fast immer VOR dem
  // naechsten `/me`-Poll (anders als im Fall IMPORTANT 2 oben, wo beide
  // gleichzeitig aufgeloest werden). Ohne Wache ueberschrieb der
  // Render-Zweig fuer `/me` den bereits aufgeloesten Endstand
  // (`completedAt: <Zeitpunkt>`) mit dem unaufgeloesten Platzhalter
  // (`completedAt: null`), sobald `/me` sein eigenes, spaeteres Poll meldete
  // -- der „Weiter"-Knopf verschwand wieder und die Flaeche sprang
  // ungefragt in den Leerlauf.
  it("behaelt den Endstand, wenn die Match-Query COMPLETED meldet, bevor /me nachzieht", async () => {
    deviceKeyStorage.stored = { secret: deviceSecret, boardName: "Scheibe 1", organizationName: "VFC Musterstadt" };
    server.self = selfResponse(matchId);
    server.match = matchState;
    const { queryClient } = renderRoute();

    await screen.findByTestId("match-scoreboard-stub");

    // Erst NUR die Match-Query aufloesen (wie nach dem eigenen Checkout) --
    // `/me` meldet zu diesem Zeitpunkt noch dasselbe laufende Match, die
    // Flaeche bleibt deshalb noch im Zustand "match"
    // (`kioskView`: `currentMatchId !== null` hat Vorrang) -- kein „Weiter"
    // noch, nur die Match-Attrappe zeigt bereits den COMPLETED-Stand.
    server.match = { ...matchState, status: "COMPLETED" };
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ["match", organizationId, matchId] });
    });
    // Das Neuladen aktualisiert den Cache sofort, die Benachrichtigung der
    // Komponente (und damit der `seenMatch`-Effekt, der den echten Endstand
    // vormerkt) folgt asynchron eine Mikrotask spaeter -- abwarten, bis die
    // Attrappe den neuen Stand tatsaechlich als Prop erhalten hat, bevor der
    // Fall fortfaehrt. Sonst traefe der naechste Schritt (unten) manchmal auf
    // eine Komponente, deren `seenMatch`-Effekt fuer DIESEN Uebergang noch gar
    // nicht gelaufen ist -- das waere kein Beleg fuer die behobene
    // Ueberschreibung, sondern ein Zufallsbefund je nach Mikrotask-Reihenfolge.
    await waitFor(() => {
      const lastMatch = matchScoreboard.calls.at(-1)?.match as { readonly status?: string } | undefined;
      expect(lastMatch?.status).toBe("COMPLETED");
    });
    expect(screen.queryByRole("button", { name: "Weiter" })).toBeNull();

    // Erst JETZT zieht `/me` nach und meldet kein laufendes Match mehr.
    server.self = selfResponse(null);
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ["board-device-self"] });
    });

    await screen.findByRole("button", { name: "Weiter" });
    expect(screen.getByTestId("match-scoreboard-stub")).not.toBeNull();
    expect(screen.queryByText("Scheibe 1 – wartet auf nächstes Match")).toBeNull();
  });

  // Task-Review-Befund IMPORTANT 3: nach `DEVICE_REVOKED` darf weder die
  // Selbstauskunft noch die Match-Query weiter pollen.
  it("pollt nach DEVICE_REVOKED nicht weiter", async () => {
    // Faelschungszeit von Anfang an: ein bereits VOR der Umstellung auf
    // Fake-Timer geplanter echter `setTimeout` (der naechste Poll nach dem
    // ersten, erfolgreichen Abruf) bliebe sonst ein echter Timer und
    // reagierte nicht auf `advanceTimersByTimeAsync` -- die Zusicherung
    // unten wuerde nie eintreten, ohne dass das ein echter Regressionsbefund
    // waere.
    vi.useFakeTimers();
    deviceKeyStorage.stored = { secret: deviceSecret, boardName: "Scheibe 1", organizationName: "VFC Musterstadt" };
    server.self = selfResponse(matchId);
    server.match = matchState;
    renderRoute();
    // Die gemockten Anfragen sind bereits aufgeloeste Promises; sie brauchen
    // keine echten Timer, nur durchlaufende Mikrotasks -- und zwar zwei
    // Wellen davon: erst loest sich die Selbstauskunft auf, was `matchId`
    // erst DANACH aktiviert; die Match-Query beginnt also eine Renderphase
    // spaeter. `advanceTimersByTimeAsync(0)` treibt je eine Welle an.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.getByTestId("match-scoreboard-stub")).not.toBeNull();

    server.selfRejection = new ApiClientError("Dieses Tablet ist nicht mehr gekoppelt.", "DEVICE_REVOKED", null, undefined, 401);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(KIOSK_POLL_MS);
    });
    expect(
      screen.getByText(
        "Dieses Tablet ist nicht mehr gekoppelt – bitte in der Organisationsverwaltung unter «Scheiben-Tablets» neu einrichten.",
      ),
    ).not.toBeNull();
    const callsAfterRevocation = client.apiRequest.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(KIOSK_POLL_MS * 5);
    });
    expect(client.apiRequest.mock.calls.length).toBe(callsAfterRevocation);
  });

  // Abschlussreview-Befund 2 (final-fix-findings.md): die allererste
  // Antwort der nachgeladenen Match-Query ist bereits COMPLETED -- `seenMatch`
  // sieht also nie einen IN_PROGRESS -> COMPLETED-Uebergang fuer dieses Match.
  // Ohne Fix bliebe `completedAt` fuer immer `null`, `kioskView` zeigte
  // dauerhaft "idle" und der Endstand erschiene nie, obwohl die Match-Query
  // alle `KIOSK_POLL_MS` weiter denselben (bereits beendeten) Stand holt.
  it("zeigt den Endstand, wenn die erste Antwort des nachgeladenen Matches bereits COMPLETED ist", async () => {
    deviceKeyStorage.stored = { secret: deviceSecret, boardName: "Scheibe 1", organizationName: "VFC Musterstadt" };
    server.self = selfResponse(matchId);
    server.match = { ...matchState, status: "COMPLETED" };
    const { queryClient } = renderRoute();

    await screen.findByTestId("match-scoreboard-stub");
    expect(screen.queryByRole("button", { name: "Weiter" })).toBeNull();

    // `/me` zieht nach: das Match ist nicht mehr aktuell. Die Match-Query
    // selbst hatte fuer diese ID nie einen IN_PROGRESS-Stand gesehen.
    server.self = selfResponse(null);
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ["board-device-self"] });
    });

    await screen.findByRole("button", { name: "Weiter" });
    expect(screen.getByTestId("match-scoreboard-stub")).not.toBeNull();
  });

  // Task-Review-Befund GAP 4: offene Warteschlangen-Eintraege eines
  // abgebrochenen Matches werden im Leerlauf sichtbar gemeldet, nicht still
  // verworfen -- und nicht geloescht.
  it("meldet im Leerlauf offene Aufnahmen eines abgebrochenen Matches", async () => {
    deviceKeyStorage.stored = { secret: deviceSecret, boardName: "Scheibe 1", organizationName: "VFC Musterstadt" };
    server.self = selfResponse(matchId);
    server.matchRejection = new ApiClientError("Dieses Match gibt es nicht mehr.", "REQUEST_FAILED", null, undefined, 404);
    offlineQueue.commands = [{ commandId: "a" }, { commandId: "b" }];
    renderRoute();

    await screen.findByText(
      "2 Aufnahmen des abgebrochenen Matches konnten nicht mehr übertragen werden.",
    );
    expect(offlineQueue.calls).toContain(`match:${organizationId}:${matchId}`);
  });

  // Spec §4 Zeile „Laden": solange die allererste
  // `/board-devices/me`-Antwort noch aussteht, behauptet der
  // Leerlauftext faelschlich schon zu wissen, dass kein Match laeuft.
  it("zeigt waehrend der ersten Selbstauskunft einen neutralen Ladeindikator statt des Leerlauftexts", async () => {
    deviceKeyStorage.stored = { secret: deviceSecret, boardName: "Scheibe 1", organizationName: "VFC Musterstadt" };
    server.self = selfResponse(null);
    renderRoute();

    expect(screen.getByText("Wird geladen …")).not.toBeNull();
    expect(screen.queryByText("Scheibe 1 – wartet auf nächstes Match")).toBeNull();

    await screen.findByText("Scheibe 1 – wartet auf nächstes Match");
  });

  // Spec §4 „Kopfzeile in allen Zustaenden":
  // Scheiben- und Organisationsname (und der Verbindungsindikator) gelten
  // auch im Widerrufszustand, nicht nur im Leerlauf oder waehrend ein Match
  // laeuft.
  it("zeigt die Kopfzeile mit Scheiben- und Organisationsnamen auch im Widerrufszustand", async () => {
    deviceKeyStorage.stored = { secret: deviceSecret, boardName: "Scheibe 1", organizationName: "VFC Musterstadt" };
    server.selfRejection = new ApiClientError("Dieses Tablet ist nicht mehr gekoppelt.", "DEVICE_REVOKED", null, undefined, 401);
    renderRoute();

    await waitFor(() => {
      expect(
        screen.getByText(
          "Dieses Tablet ist nicht mehr gekoppelt – bitte in der Organisationsverwaltung unter «Scheiben-Tablets» neu einrichten.",
        ),
      ).not.toBeNull();
    });
    expect(screen.getByText("Scheibe 1")).not.toBeNull();
    expect(screen.getByText("VFC Musterstadt")).not.toBeNull();
  });

  // Die Statuszeile ist im Widerruf NICHT dieselbe `ScoreboardStatus` wie im
  // Leerlauf: die meldete bei Offline zusaetzlich "Aufnahmen werden lokal
  // gespeichert" -- ein Versprechen, das fuer ein widerrufenes Geraet nicht
  // mehr gilt (keine Eingabeflaeche mehr, es entstehen keine neuen
  // Aufnahmen). Nur die reine Online/Offline-Anzeige bleibt.
  it("meldet im Widerrufszustand bei Offline nur den Verbindungsstatus, ohne ein Speicherversprechen", async () => {
    deviceKeyStorage.stored = { secret: deviceSecret, boardName: "Scheibe 1", organizationName: "VFC Musterstadt" };
    server.selfRejection = new ApiClientError("Dieses Tablet ist nicht mehr gekoppelt.", "DEVICE_REVOKED", null, undefined, 401);
    renderRoute();

    await waitFor(() => {
      expect(
        screen.getByText(
          "Dieses Tablet ist nicht mehr gekoppelt – bitte in der Organisationsverwaltung unter «Scheiben-Tablets» neu einrichten.",
        ),
      ).not.toBeNull();
    });

    // TanStack Querys `onlineManager` ist ein modulweiter Singleton und
    // lauscht selbst auf dieselben `window`-Ereignisse, um Abfragen bei
    // Offline zu pausieren -- ohne das abschliessende "online" bliebe JEDE
    // Abfrage in JEDEM spaeteren Test in diesem Modul fuer immer pausiert
    // (Befund beim Schreiben dieses Tests: nachfolgende Faelle hingen bei
    // "Wird geladen …", `client.apiRequest` wurde nie wieder aufgerufen).
    try {
      act(() => {
        window.dispatchEvent(new Event("offline"));
      });

      await screen.findByText("Offline");
      expect(screen.queryByText(/Aufnahmen werden lokal gespeichert/u)).toBeNull();
    } finally {
      act(() => {
        window.dispatchEvent(new Event("online"));
      });
    }
  });

  // `KioskRoute` haelt den ersten gelesenen Geraete-Snapshot fest. Ein
  // spaeterer Re-Render AUS ANDEREM GRUND (hier:
  // `forceRerender`, voellig unabhaengig von `KioskRoute` selbst) darf die
  // laufende Widerrufsmeldung samt Warteschlangen-Zahl nicht durch "nicht
  // gekoppelt" ersetzen, nur weil `forgetBoardDevice()` im selben Tab
  // inzwischen den lokalen Schluessel geloescht hat.
  it("behaelt die Widerrufsmeldung bei einem fremden Re-Render, obwohl forgetBoardDevice() den lokalen Schluessel geloescht hat", async () => {
    deviceKeyStorage.stored = { secret: deviceSecret, boardName: "Scheibe 1", organizationName: "VFC Musterstadt" };
    server.self = selfResponse(matchId);
    server.match = matchState;
    offlineQueue.commands = [{ commandId: "a" }];
    // Bildet den echten Effekt in `KioskContent` nach: Widerruf loescht den
    // lokalen Schluessel IM SELBEN TAB (kein Storage-Event, kein
    // `subscribeBoardDeviceChanges`-Aufruf).
    deviceKeyStorage.forgetBoardDevice.mockImplementation(() => {
      deviceKeyStorage.stored = null;
    });
    const { forceRerender, queryClient } = renderHarness();

    await screen.findByTestId("match-scoreboard-stub");

    server.selfRejection = new ApiClientError("Dieses Tablet ist nicht mehr gekoppelt.", "DEVICE_REVOKED", null, undefined, 401);
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ["board-device-self"] });
    });
    await waitFor(() => {
      expect(deviceKeyStorage.forgetBoardDevice).toHaveBeenCalled();
    });
    await screen.findByText(
      "Dieses Tablet ist nicht mehr gekoppelt – bitte in der Organisationsverwaltung unter «Scheiben-Tablets» neu einrichten.",
    );
    await screen.findByText("1 Aufnahme konnte nicht mehr übertragen werden.");

    // Ein voellig unbeteiligter Re-Render -- `KioskRoute` selbst hat kein
    // eigenes Update angestossen, `getBoardDeviceSnapshot()` liefert jetzt
    // trotzdem `null` (siehe oben).
    act(() => {
      forceRerender();
    });
    expect(
      screen.getByText(
        "Dieses Tablet ist nicht mehr gekoppelt – bitte in der Organisationsverwaltung unter «Scheiben-Tablets» neu einrichten.",
      ),
    ).not.toBeNull();
    expect(screen.getByText("1 Aufnahme konnte nicht mehr übertragen werden.")).not.toBeNull();
    expect(screen.queryByText("Dieses Tablet ist nicht gekoppelt.")).toBeNull();
  });

  // B2.3, Gegenprobe: ein echter Wechsel aus einem ANDEREN Tab/Fenster
  // (`subscribeBoardDeviceChanges`s Benachrichtigung, hier ueber
  // `deviceKeyStorage.crossTabOnChange` simuliert) muss weiterhin wirken --
  // anders als der rein zufaellige Re-Render oben. Eigener Fall ohne
  // vorherigen unbeteiligten Re-Render: React haette sonst den neuen Wert
  // (`null`) schon bei JENEM Render gesehen und meldete bei identischem Wert
  // kein zweites Mal eine Aenderung.
  it("uebernimmt einen echten Wechsel aus einem anderen Tab/Fenster", async () => {
    deviceKeyStorage.stored = { secret: deviceSecret, boardName: "Scheibe 1", organizationName: "VFC Musterstadt" };
    server.self = selfResponse(matchId);
    server.match = matchState;
    deviceKeyStorage.forgetBoardDevice.mockImplementation(() => {
      deviceKeyStorage.stored = null;
    });
    const { queryClient } = renderRoute();

    await screen.findByTestId("match-scoreboard-stub");

    server.selfRejection = new ApiClientError("Dieses Tablet ist nicht mehr gekoppelt.", "DEVICE_REVOKED", null, undefined, 401);
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ["board-device-self"] });
    });
    await screen.findByText(
      "Dieses Tablet ist nicht mehr gekoppelt – bitte in der Organisationsverwaltung unter «Scheiben-Tablets» neu einrichten.",
    );

    // Ein anderes Tab/Fenster desselben Geraets meldet den Wechsel.
    expect(deviceKeyStorage.crossTabOnChange).not.toBeNull();
    act(() => {
      deviceKeyStorage.crossTabOnChange?.();
    });
    await screen.findByText("Dieses Tablet ist nicht gekoppelt.");
  });

  // Die Leitung oeffnet ein bereits per „Weiter" quittiertes Match per Undo
  // wieder -- der zweite Abschluss
  // desselben Matches muss erneut einen Endstand zeigen.
  it("zeigt nach einem erneuten Abschluss wieder den Endstand, wenn dasselbe Match per Undo erneut beendet wird", async () => {
    deviceKeyStorage.stored = { secret: deviceSecret, boardName: "Scheibe 1", organizationName: "VFC Musterstadt" };
    server.self = selfResponse(matchId);
    server.match = matchState;
    const { queryClient } = renderRoute();
    await screen.findByTestId("match-scoreboard-stub");

    // Erster Abschluss, quittiert per "Weiter".
    server.self = selfResponse(null);
    server.match = { ...matchState, status: "COMPLETED" };
    await act(async () => {
      await queryClient.refetchQueries();
    });
    const firstWeiter = await screen.findByRole("button", { name: "Weiter" });
    fireEvent.click(firstWeiter);
    await screen.findByText("Scheibe 1 – wartet auf nächstes Match");

    // Die Leitung oeffnet dasselbe Match per Undo wieder: `/me` meldet es
    // erneut als laufend, die Match-Query sieht wieder IN_PROGRESS.
    server.self = selfResponse(matchId);
    server.match = matchState;
    await act(async () => {
      await queryClient.refetchQueries();
    });
    await screen.findByTestId("match-scoreboard-stub");
    expect(screen.queryByRole("button", { name: "Weiter" })).toBeNull();

    // Zweiter Abschluss desselben Matches.
    server.self = selfResponse(null);
    server.match = { ...matchState, status: "COMPLETED" };
    await act(async () => {
      await queryClient.refetchQueries();
    });

    await screen.findByRole("button", { name: "Weiter" });
  });

  // Singular/Plural im Widerrufstext, wie bereits bei der Meldung zum
  // abgebrochenen Match im Leerlauf.
  it("verwendet im Widerrufstext den Singular bei genau einer offenen Aufnahme", async () => {
    deviceKeyStorage.stored = { secret: deviceSecret, boardName: "Scheibe 1", organizationName: "VFC Musterstadt" };
    server.self = selfResponse(matchId);
    server.match = matchState;
    offlineQueue.commands = [{ commandId: "a" }];
    const { queryClient } = renderRoute();
    await screen.findByTestId("match-scoreboard-stub");

    server.selfRejection = new ApiClientError("Dieses Tablet ist nicht mehr gekoppelt.", "DEVICE_REVOKED", null, undefined, 401);
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ["board-device-self"] });
    });

    await screen.findByText("1 Aufnahme konnte nicht mehr übertragen werden.");
    expect(screen.queryByText(/^1 Aufnahmen /u)).toBeNull();
  });

  // Ein spaetes Ergebnis einer frueheren Ablehnung darf den Zaehler einer
  // inzwischen neueren Ablehnung nicht mehr ueberschreiben.
  it("laesst ein spaetes Ergebnis einer frueheren Ablehnung den Zaehler einer neueren Ablehnung nicht ueberschreiben", async () => {
    deviceKeyStorage.stored = { secret: deviceSecret, boardName: "Scheibe 1", organizationName: "VFC Musterstadt" };
    server.self = selfResponse(matchId);
    server.matchRejection = new ApiClientError("Dieses Match gibt es nicht mehr.", "REQUEST_FAILED", null, undefined, 404);
    let resolveFirst: ((commands: unknown[]) => void) | null = null;
    offlineQueue.queuedResponses.push(new Promise((resolve) => {
      resolveFirst = resolve;
    }));
    const { queryClient } = renderRoute();

    // Erste Ablehnung (Match A): die Anfrage fuer dessen Warteschlange haengt
    // bewusst (das oben vorbereitete, noch unaufgeloeste Promise).
    await waitFor(() => {
      expect(offlineQueue.calls).toContain(`match:${organizationId}:${matchId}`);
    });

    // Zweites Match beginnt und wird ebenfalls sofort abgelehnt.
    const secondMatchId = "66666666-6666-4666-8666-666666666666";
    server.self = selfResponse(secondMatchId);
    offlineQueue.commands = [{ commandId: "b1" }, { commandId: "b2" }];
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ["board-device-self"] });
    });
    await screen.findByText(
      "2 Aufnahmen des abgebrochenen Matches konnten nicht mehr übertragen werden.",
    );

    // Jetzt loest das veraltete Ergebnis der ERSTEN Ablehnung auf.
    await act(async () => {
      resolveFirst?.([{ commandId: "a1" }]);
    });

    expect(
      screen.getByText("2 Aufnahmen des abgebrochenen Matches konnten nicht mehr übertragen werden."),
    ).not.toBeNull();
  });
});
