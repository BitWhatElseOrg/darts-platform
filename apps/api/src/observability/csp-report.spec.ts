import { describe, expect, it } from "vitest";

import { normalizeCspReport } from "./csp-report.js";

describe("normalizeCspReport", () => {
  it("liest die alte report-uri-Form", () => {
    expect(
      normalizeCspReport({
        "csp-report": {
          "document-uri": "https://dartbase.ch/matches",
          "violated-directive": "script-src 'self'",
          "effective-directive": "script-src",
          "blocked-uri": "https://fremd.example/tracker.js",
          "source-file": "https://dartbase.ch/matches",
          "line-number": 42,
          disposition: "report",
          "original-policy": "default-src 'self'; script-src 'self'",
        },
      }),
    ).toEqual([
      {
        directive: "script-src",
        blockedUri: "https://fremd.example/tracker.js",
        documentUri: "https://dartbase.ch/matches",
        sourceFile: "https://dartbase.ch/matches",
        lineNumber: 42,
        disposition: "report",
      },
    ]);
  });

  it("faellt auf die verletzte Direktive zurueck, wenn die wirksame fehlt", () => {
    const [violation] = normalizeCspReport({
      "csp-report": {
        "document-uri": "https://dartbase.ch/",
        "violated-directive": "img-src 'self'",
        "blocked-uri": "data:",
      },
    });
    expect(violation?.directive).toBe("img-src 'self'");
  });

  it("liest einen Stapel der Reporting-API-Form", () => {
    expect(
      normalizeCspReport([
        {
          type: "csp-violation",
          url: "https://dartbase.ch/liga",
          body: {
            documentURL: "https://dartbase.ch/liga",
            effectiveDirective: "connect-src",
            blockedURL: "wss://fremd.example",
            lineNumber: 7,
            disposition: "reporting",
          },
        },
        { type: "deprecation", url: "https://dartbase.ch/liga", body: { id: "alt" } },
      ]),
    ).toEqual([
      {
        directive: "connect-src",
        blockedUri: "wss://fremd.example",
        documentUri: "https://dartbase.ch/liga",
        sourceFile: null,
        lineNumber: 7,
        disposition: "reporting",
      },
    ]);
  });

  it("kuerzt ueberlange Felder", () => {
    const [violation] = normalizeCspReport({
      "csp-report": {
        "document-uri": `https://dartbase.ch/${"a".repeat(1_000)}`,
        "effective-directive": "script-src",
        "blocked-uri": "inline",
      },
    });
    expect(violation?.documentUri.length).toBe(300);
  });

  it("verwirft Unsinn still", () => {
    expect(normalizeCspReport(null)).toEqual([]);
    expect(normalizeCspReport("kaputt")).toEqual([]);
    expect(normalizeCspReport({ "csp-report": {} })).toEqual([]);
    expect(normalizeCspReport([{ type: "csp-violation" }])).toEqual([]);
  });

  it("nimmt hoechstens zwanzig Meldungen aus einem Stapel", () => {
    const entry = {
      type: "csp-violation",
      body: { documentURL: "https://dartbase.ch/", effectiveDirective: "img-src" },
    };
    expect(normalizeCspReport(Array.from({ length: 50 }, () => entry))).toHaveLength(20);
  });
});
