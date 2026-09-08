import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `live-address.ts` liest beim Import die oeffentliche Client-Umgebung. Der
// Mock haelt den Test unabhaengig davon, ob NEXT_PUBLIC_API_URL gesetzt ist
// (siehe `api-client.spec.ts`).
vi.mock("./environment", () => ({
  publicEnvironment: { NEXT_PUBLIC_API_URL: "http://api.test/api/v1" },
}));

import { resolvePublicId } from "./live-address";

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

describe("resolvePublicId", () => {
  it("liefert die publicId fuer eine interne ID eines oeffentlichen Turniers", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ publicId: "6f1f1f6a-0000-4000-8000-000000000001" }, 200),
    );

    await expect(resolvePublicId("11111111-1111-4111-8111-111111111111")).resolves.toBe(
      "6f1f1f6a-0000-4000-8000-000000000001",
    );
  });

  it("liefert null bei einer Non-2xx-Antwort", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));

    await expect(resolvePublicId("11111111-1111-4111-8111-111111111111")).resolves.toBeNull();
  });

  it("liefert null, wenn Wert und Aufloesung zusammenfallen", async () => {
    const id = "6f1f1f6a-0000-4000-8000-000000000001";
    fetchMock.mockResolvedValueOnce(jsonResponse({ publicId: id }, 200));

    await expect(resolvePublicId(id)).resolves.toBeNull();
  });

  /**
   * Der eigentliche Befund (Review, Fix-Runde 1): ein *geworfener* Fehler --
   * Timeout, DNS-Ausfall, abgebrochene Verbindung -- ist kein Non-2xx-Status
   * und schlug vorher ungefangen durch `fetch` durch. Das riss die gesamte
   * Server-Komponente der `/live`-Seite mit, ausgerechnet auf dem anonymen
   * Publikumsweg. `resolvePublicId` faellt jetzt auch hier auf `null` zurueck,
   * die Umleitung ist nur eine Bequemlichkeit fuer alte Adressen.
   */
  it("liefert null, wenn fetch wirft, statt den Fehler durchzureichen", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(resolvePublicId("11111111-1111-4111-8111-111111111111")).resolves.toBeNull();
  });

  it("liefert null bei einer Antwort ohne gueltige publicId", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ publicId: "not-a-uuid" }, 200));

    await expect(resolvePublicId("11111111-1111-4111-8111-111111111111")).resolves.toBeNull();
  });
});
