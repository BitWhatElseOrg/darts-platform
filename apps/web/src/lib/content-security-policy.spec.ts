import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy } from "./content-security-policy";

const options = {
  apiOrigin: "https://api.dartbase.ch",
  reportUri: "https://api.dartbase.ch/api/v1/csp-reports",
  nonce: "test-nonce-default",
} as const;

describe("buildContentSecurityPolicy", () => {
  it("traegt die Nonce in script-src statt 'unsafe-inline'", () => {
    const policy = buildContentSecurityPolicy({
      apiOrigin: "https://api.example.test",
      reportUri: "https://api.example.test/api/v1/csp-reports",
      allowEval: false,
      nonce: "test-nonce-123",
    });

    expect(policy).toContain("script-src 'self' 'nonce-test-nonce-123' 'strict-dynamic'");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it("erlaubt unsafe-eval weiterhin nur im Entwicklungsserver, zusaetzlich zur Nonce", () => {
    const policy = buildContentSecurityPolicy({
      apiOrigin: "https://api.example.test",
      reportUri: "https://api.example.test/api/v1/csp-reports",
      allowEval: true,
      nonce: "test-nonce-123",
    });

    expect(policy).toContain(
      "script-src 'self' 'nonce-test-nonce-123' 'strict-dynamic' 'unsafe-eval'",
    );
  });

  it("erlaubt `eval` im Produktionsbuild nicht", () => {
    const policy = buildContentSecurityPolicy({ ...options, allowEval: false });

    expect(policy).toContain("script-src 'self' 'nonce-test-nonce-default'");
    expect(policy).not.toContain("unsafe-eval");
  });

  it("erlaubt `eval` nur im Entwicklungsserver und nur fuer Skripte", () => {
    const policy = buildContentSecurityPolicy({ ...options, allowEval: true });

    expect(policy).toContain(
      "script-src 'self' 'nonce-test-nonce-default' 'strict-dynamic' 'unsafe-eval'",
    );
    expect(policy.match(/unsafe-eval/gu)).toHaveLength(1);
  });

  it("laesst die Seite mit der API sprechen, per HTTP und per WebSocket", () => {
    const policy = buildContentSecurityPolicy({ ...options, allowEval: false });

    expect(policy).toContain(
      "connect-src 'self' https://api.dartbase.ch wss://api.dartbase.ch",
    );
  });

  it("haelt die scharfen Direktiven und beide Meldewege", () => {
    const policy = buildContentSecurityPolicy({ ...options, allowEval: false });

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("report-uri https://api.dartbase.ch/api/v1/csp-reports");
    expect(policy).toContain("report-to csp-endpoint");
  });
});
