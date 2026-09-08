import { describe, expect, it, vi } from "vitest";

// `share-panel.tsx` importiert ueber `apiRequest` die oeffentliche
// Client-Umgebung; der Mock haelt diesen Test unabhaengig davon, ob
// NEXT_PUBLIC_API_URL gesetzt ist (siehe `api-client.spec.ts`).
vi.mock("@/lib/environment", () => ({
  publicEnvironment: { NEXT_PUBLIC_API_URL: "http://api.test/api/v1" },
}));

import { shareLink, shareState } from "./share-panel";

describe("shareState", () => {
  it("nennt ein privates Turnier nicht freigegeben", () => {
    expect(shareState("PRIVATE")).toEqual({
      label: "Nicht freigegeben",
      hint: "Nur angemeldete Mitglieder sehen dieses Turnier.",
      next: "PUBLIC",
    });
  });

  it("nennt ein oeffentliches Turnier freigegeben", () => {
    expect(shareState("PUBLIC")).toEqual({
      label: "Freigegeben",
      hint: "Wer den Link hat, sieht zu. Das Turnier steht in keinem Verzeichnis.",
      next: "PRIVATE",
    });
  });
});

describe("shareLink", () => {
  it("baut die oeffentliche Adresse aus der publicId", () => {
    expect(shareLink("https://dartbase.ch", "6f1f1f6a-0000-4000-8000-000000000001")).toBe(
      "https://dartbase.ch/live/6f1f1f6a-0000-4000-8000-000000000001",
    );
  });
});
