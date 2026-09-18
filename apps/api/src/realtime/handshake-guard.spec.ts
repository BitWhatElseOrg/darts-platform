import { createServer, type Server as HttpServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { Server } from "socket.io";

import {
  createHandshakeGate,
  resolveHandshakeAddress,
} from "./handshake-guard.js";

describe("resolveHandshakeAddress", () => {
  it("nimmt ohne vertrauten Hop die direkte Verbindung", () => {
    expect(
      resolveHandshakeAddress({
        headers: { "x-forwarded-for": "9.9.9.9" },
        remoteAddress: "10.0.0.1",
        trustProxyHops: 0,
      }),
    ).toBe("10.0.0.1");
  });

  it("nimmt bei einem vertrauten Hop den letzten Eintrag der Kette", () => {
    // Genau die Semantik von `resolveTrustProxyOption`: vertraut wird der
    // Eintrag, den der eigene Reverse Proxy angehaengt hat.
    expect(
      resolveHandshakeAddress({
        headers: { "x-forwarded-for": "9.9.9.9, 203.0.113.7" },
        remoteAddress: "10.0.0.1",
        trustProxyHops: 1,
      }),
    ).toBe("203.0.113.7");
  });

  /**
   * Befund D3-1 (Plan 2026-09-17-go-live-testprogramm, Task 3): hinter
   * Railway ist der letzte Eintrag von `X-Forwarded-For` eine von mehreren
   * abwechselnden Proxy-Adressen, nicht die Adresse des Clients.
   * `X-Real-IP` hat bei einem vertrauten Hop Vorrang, auch wenn die
   * `X-Forwarded-For`-Kette selbst eine andere Adresse ergeben wuerde.
   */
  it("bevorzugt bei einem vertrauten Hop ein gueltiges X-Real-IP vor der Forwarded-For-Kette", () => {
    expect(
      resolveHandshakeAddress({
        headers: {
          "x-real-ip": "203.0.113.7",
          "x-forwarded-for": "203.0.113.7, 198.51.100.9",
        },
        remoteAddress: "10.0.0.1",
        trustProxyHops: 1,
      }),
    ).toBe("203.0.113.7");
  });

  it("faellt auf die direkte Verbindung zurueck, wenn die Kette zu kurz ist", () => {
    expect(
      resolveHandshakeAddress({
        headers: {},
        remoteAddress: "10.0.0.1",
        trustProxyHops: 1,
      }),
    ).toBe("10.0.0.1");
  });

  it("beantwortet eine unbekannte Adresse mit einem festen Schluessel", () => {
    expect(
      resolveHandshakeAddress({ headers: {}, trustProxyHops: 0 }),
    ).toBe("unknown");
  });
});

describe("createHandshakeGate", () => {
  it("laesst bis zur Obergrenze zu und weist danach ab", () => {
    let now = 0;
    const gate = createHandshakeGate({
      max: 2,
      trustProxyHops: 0,
      now: () => now,
    });
    const attempt = (): boolean => {
      let allowed = false;
      gate(
        { headers: {}, socket: { remoteAddress: "10.0.0.1" } } as never,
        (_error, success) => {
          allowed = success;
        },
      );
      return allowed;
    };

    expect(attempt()).toBe(true);
    expect(attempt()).toBe(true);
    expect(attempt()).toBe(false);

    // Neues Fenster, neuer Eimer.
    now += 60_000;
    expect(attempt()).toBe(true);
  });

  it("zaehlt je Adresse getrennt", () => {
    const gate = createHandshakeGate({ max: 1, trustProxyHops: 0, now: () => 0 });
    const attempt = (address: string): boolean => {
      let allowed = false;
      gate(
        { headers: {}, socket: { remoteAddress: address } } as never,
        (_error, success) => {
          allowed = success;
        },
      );
      return allowed;
    };

    expect(attempt("10.0.0.1")).toBe(true);
    expect(attempt("10.0.0.2")).toBe(true);
    expect(attempt("10.0.0.1")).toBe(false);
  });

  it("meldet jede Abweisung genau einmal", () => {
    const rejected: string[] = [];
    const gate = createHandshakeGate({
      max: 1,
      trustProxyHops: 0,
      now: () => 0,
      onRejected: (address) => rejected.push(address),
    });
    const attempt = (): void =>
      gate({ headers: {}, socket: { remoteAddress: "10.0.0.1" } } as never, () => undefined);

    attempt();
    attempt();
    attempt();

    expect(rejected).toEqual(["10.0.0.1", "10.0.0.1"]);
  });
});

describe("Socket.IO-Handshake", () => {
  let httpServer: HttpServer | null = null;
  let io: Server | null = null;

  afterEach(async () => {
    await io?.close();
    httpServer?.close();
    io = null;
    httpServer = null;
  });

  /**
   * `/socket.io/` haengt am HTTP-Server, nicht an Fastify — `@fastify/rate-limit`
   * sieht den Handshake also nie. Geprueft wird deshalb ueber den echten
   * engine.io-Endpunkt, dass die Bremse dort greift.
   */
  it("beantwortet den Handshake nach der Obergrenze mit 403", async () => {
    httpServer = createServer();
    await new Promise<void>((resolve) => {
      httpServer?.listen(0, "127.0.0.1", resolve);
    });
    const address = httpServer.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected a TCP address.");
    }
    io = new Server(httpServer, {
      allowRequest: createHandshakeGate({ max: 1, trustProxyHops: 0 }),
    });
    const handshake = async (): Promise<number> => {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/socket.io/?EIO=4&transport=polling`,
      );
      await response.text();
      return response.status;
    };

    expect(await handshake()).toBe(200);
    expect(await handshake()).toBe(403);
  }, 30_000);
});
