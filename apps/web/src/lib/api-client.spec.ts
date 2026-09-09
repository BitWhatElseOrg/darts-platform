import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError, apiRequest } from "./api-client";

// `api-client.ts` liest beim Import die oeffentliche Client-Umgebung. Der Mock
// haelt den Test unabhaengig davon, ob NEXT_PUBLIC_API_URL gesetzt ist.
vi.mock("./environment", () => ({
  publicEnvironment: { NEXT_PUBLIC_API_URL: "http://api.test/api/v1" },
}));

const schema = z.object({ id: z.string() });
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("apiRequest", () => {
  it("gibt eine geparste Antwort zurueck", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "abc" }, 200));

    await expect(apiRequest({ path: "/probe", schema })).resolves.toEqual({ id: "abc" });
  });

  it("uebersetzt das einheitliche Fehlerformat samt Status", async () => {
    const correlationId = "11111111-1111-4111-8111-111111111111";
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: "BOARD_NOT_AVAILABLE", message: "no", correlationId } }, 409),
    );

    const error = await apiRequest({ path: "/probe", schema }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      code: "BOARD_NOT_AVAILABLE",
      status: 409,
      correlationId,
      message: "Das gewählte Board ist nicht verfügbar.",
    });
  });

  /**
   * Der eigentliche Befund: eine Fehlerseite eines Proxys ist kein JSON. Vorher
   * warf `response.json()` einen `SyntaxError`, bevor irgendjemand den Status
   * gelesen hatte -- die Wiedergabe der Warteschlange hielt das fuer einen
   * Netzwerkfehler und wiederholte ewig.
   */
  it("meldet eine 4xx-Antwort ohne JSON-Koerper mit ihrem Status", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<html><body>Forbidden</body></html>", {
        status: 403,
        headers: { "content-type": "text/html" },
      }),
    );

    const error = await apiRequest({ path: "/probe", schema }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ code: "REQUEST_FAILED", status: 403 });
  });

  it("meldet eine 5xx-Antwort mit leerem Koerper mit ihrem Status", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 503 }));

    const error = await apiRequest({ path: "/probe", schema }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ code: "REQUEST_FAILED", status: 503 });
  });

  it("akzeptiert einen leeren Koerper auf dem Erfolgspfad (z. B. HTTP 204)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(apiRequest({ path: "/probe", schema: z.void() })).resolves.toBeUndefined();
  });
});
