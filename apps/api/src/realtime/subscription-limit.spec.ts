import { describe, expect, it } from "vitest";

import {
  MAX_SUBSCRIPTIONS_PER_SOCKET,
  joinSubscription,
  rejectSubscription,
  type RejectableSocket,
  type SubscribableSocket,
} from "./subscription-limit.js";

interface FakeSocket extends SubscribableSocket {
  readonly emitted: { readonly event: string; readonly payload: Readonly<Record<string, string>> }[];
}

function fakeSocket(joined: readonly string[] = []): FakeSocket {
  const rooms = new Set<string>(["socket-1", ...joined]);
  const emitted: FakeSocket["emitted"] = [];
  return {
    id: "socket-1",
    rooms,
    emitted,
    join(room) {
      rooms.add(room);
    },
    emit(event, payload) {
      emitted.push({ event, payload });
    },
  };
}

describe("joinSubscription", () => {
  it("tritt einem neuen Raum bei", () => {
    const socket = fakeSocket();

    expect(joinSubscription(socket, "tournament:a")).toBe("joined");
    expect(socket.rooms.has("tournament:a")).toBe(true);
  });

  it("erkennt einen bereits abonnierten Raum", () => {
    const socket = fakeSocket(["tournament:a"]);

    expect(joinSubscription(socket, "tournament:a")).toBe("already-joined");
    expect(socket.emitted).toEqual([]);
  });

  it("weist ueber der Obergrenze ab und sagt es dem Client", () => {
    const socket = fakeSocket(
      Array.from({ length: MAX_SUBSCRIPTIONS_PER_SOCKET }, (_unused, index) => `tournament:${index}`),
    );

    expect(joinSubscription(socket, "tournament:zuviel")).toBe("limit-reached");
    expect(socket.rooms.has("tournament:zuviel")).toBe(false);
    expect(socket.emitted).toEqual([
      {
        event: "subscription:rejected",
        payload: { room: "tournament:zuviel", reason: "SUBSCRIPTION_LIMIT_REACHED" },
      },
    ]);
  });

  it("zaehlt den eigenen Kanal nicht als Abonnement", () => {
    const socket = fakeSocket(
      Array.from({ length: MAX_SUBSCRIPTIONS_PER_SOCKET - 1 }, (_unused, index) => `tournament:${index}`),
    );

    expect(joinSubscription(socket, "tournament:letzter")).toBe("joined");
  });
});

describe("rejectSubscription", () => {
  function emittedReason(reason: Parameters<typeof rejectSubscription>[2]): string {
    const emitted: { readonly reason: string }[] = [];
    const socket: RejectableSocket = {
      emit: (_event, payload) => emitted.push(payload as { reason: string }),
    };
    rejectSubscription(socket, "tournament:x", reason);
    const [first] = emitted;
    if (first === undefined) throw new Error("rejectSubscription hat nichts gesendet.");
    return first.reason;
  }

  it("liefert fuer eine unbekannte Adresse denselben Client-Grund wie fuer eine verbotene — sonst waere die Unbekanntheit selbst schon eine Information", () => {
    expect(emittedReason("SUBSCRIPTION_UNKNOWN_ROOM")).toBe(emittedReason("SUBSCRIPTION_FORBIDDEN"));
    expect(emittedReason("SUBSCRIPTION_UNKNOWN_ROOM")).toBe("SUBSCRIPTION_FORBIDDEN");
  });

  it("laesst die Obergrenze als eigenen Grund bestehen — sie ist keine sicherheitsrelevante Unterscheidung", () => {
    expect(emittedReason("SUBSCRIPTION_LIMIT_REACHED")).toBe("SUBSCRIPTION_LIMIT_REACHED");
  });
});
