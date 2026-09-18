import { describe, expect, it, vi } from "vitest";

// `share-panel.tsx` importiert ueber `apiRequest` die oeffentliche
// Client-Umgebung; der Mock haelt diesen Test unabhaengig davon, ob
// NEXT_PUBLIC_API_URL gesetzt ist (siehe `api-client.spec.ts`).
vi.mock("@/lib/environment", () => ({
  publicEnvironment: { NEXT_PUBLIC_API_URL: "http://api.test/api/v1" },
}));

import { liveNavTarget, shareLink, shareState } from "./share-panel";

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

describe("liveNavTarget", () => {
  it("fuehrt bei einem freigegebenen Turnier zur oeffentlichen Live-Ansicht", () => {
    expect(liveNavTarget("PUBLIC", "6f1f1f6a-0000-4000-8000-000000000001")).toEqual({
      href: "/live/6f1f1f6a-0000-4000-8000-000000000001",
      label: "Öffentliche Live-Ansicht",
    });
  });

  it("fuehrt bei einem privaten Turnier zur Freigabe statt ins Leere", () => {
    // Die oeffentliche Route antwortet fuer ein privates Turnier absichtlich
    // mit 404 (ADR 0013); ein Link dorthin endete in «Turnier nicht gefunden».
    expect(liveNavTarget("PRIVATE", "6f1f1f6a-0000-4000-8000-000000000001")).toEqual({
      href: "#share-heading",
      label: "Live-Ansicht: noch nicht freigegeben",
    });
  });
});
