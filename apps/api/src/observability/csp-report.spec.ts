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
        // Mit Wurzelpfad: `sanitizeUrl` gibt die normalisierte Adresse zurueck.
        blockedUri: "wss://fremd.example/",
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

  /**
   * PR-Agent-Befund «Sensitive URLs»: Eine gemeldete Seiten- oder
   * Ressourcenadresse kann einen Token in der Abfragezeichenkette tragen —
   * ein Einladungscode, ein Zuruecksetzen-Link. Unveraendert protokolliert
   * landete das Geheimnis in den Betriebslogs. Fuer die Entscheidung, ob die
   * Policy erzwungen werden kann, genuegen Ursprung und Pfad.
   */
  it("streift Abfragezeichenkette, Fragment und Zugangsdaten von jeder Adresse", () => {
    const [violation] = normalizeCspReport({
      "csp-report": {
        "document-uri": "https://dartbase.ch/einladung?claim=geheim-token#abschnitt",
        "effective-directive": "script-src",
        "blocked-uri": "https://benutzer:passwort@fremd.example/x.js?token=geheim",
        "source-file": "https://dartbase.ch/liga?organisation=abc#oben",
      },
    });

    expect(violation).toMatchObject({
      documentUri: "https://dartbase.ch/einladung",
      blockedUri: "https://fremd.example/x.js",
      sourceFile: "https://dartbase.ch/liga",
    });
  });

  it("laesst die CSP-Schluesselwoerter unveraendert", () => {
    // `inline`, `eval` und `data` sind keine Adressen und wuerden von einer
    // URL-Bereinigung sonst verschluckt.
    for (const keyword of ["inline", "eval", "data", "unknown"]) {
      const [violation] = normalizeCspReport({
        "csp-report": {
          "document-uri": "https://dartbase.ch/",
          "effective-directive": "script-src",
          "blocked-uri": keyword,
        },
      });
      expect(violation?.blockedUri).toBe(keyword);
    }
  });

  it("bereinigt auch die Reporting-API-Form", () => {
    const [violation] = normalizeCspReport([
      {
        type: "csp-violation",
        url: "https://dartbase.ch/liga?token=geheim",
        body: {
          documentURL: "https://dartbase.ch/liga?token=geheim",
          effectiveDirective: "connect-src",
          blockedURL: "wss://fremd.example/socket?key=geheim",
        },
      },
    ]);

    expect(violation).toMatchObject({
      documentUri: "https://dartbase.ch/liga",
      blockedUri: "wss://fremd.example/socket",
    });
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
