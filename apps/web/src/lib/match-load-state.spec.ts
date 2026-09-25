import { describe, expect, it, vi } from "vitest";

vi.mock("./environment", () => ({
  publicEnvironment: { NEXT_PUBLIC_API_URL: "http://api.test/api/v1" },
}));

import { ApiClientError } from "./api-error";
import { matchLoadMessage, matchRefetchInterval, shouldRetryMatchLoad } from "./match-load-state";

// Befund 3 des Probelaufs vom 25.09.2026: Die Scoringflaeche pollte eine
// unbekannte Match-ID alle vier Sekunden weiter und zeigte dazu die
// generische Meldung "Pruefe die Eingaben" -- ohne Eingabe und ohne Rueckweg.
const notFound = new ApiClientError("Match not found.", "RESOURCE_NOT_FOUND", "corr-1", undefined, 404);
const serverError = new ApiClientError("Die API hat mit HTTP 503 geantwortet.", "REQUEST_FAILED", null, undefined, 503);

describe("matchRefetchInterval", () => {
  it("pollt ohne Fehler alle vier Sekunden", () => {
    expect(matchRefetchInterval(null)).toBe(4_000);
  });

  it("pollt nach einem 404 nicht weiter", () => {
    expect(matchRefetchInterval(notFound)).toBe(false);
  });

  it("pollt nach einem Serverfehler weiter, damit sich die Flaeche erholt", () => {
    expect(matchRefetchInterval(serverError)).toBe(4_000);
  });
});

describe("shouldRetryMatchLoad", () => {
  it("wiederholt einen 404 nicht", () => {
    expect(shouldRetryMatchLoad(1, notFound)).toBe(false);
  });

  it("wiederholt andere Fehler bis zu dreimal", () => {
    expect(shouldRetryMatchLoad(2, serverError)).toBe(true);
    expect(shouldRetryMatchLoad(3, serverError)).toBe(false);
  });
});

describe("matchLoadMessage", () => {
  it("nennt ein unbekanntes Match beim Namen", () => {
    expect(matchLoadMessage(notFound)).toBe(
      "Dieses Match gibt es nicht oder nicht mehr. Öffne die Scoringfläche über die Matches-Seite.",
    );
  });

  it("laesst andere Fehler bei der allgemeinen Meldung", () => {
    expect(matchLoadMessage(serverError)).toBe("Die API hat mit HTTP 503 geantwortet.");
  });
});
