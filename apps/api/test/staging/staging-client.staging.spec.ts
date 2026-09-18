import { describe, expect, it } from "vitest";

import { readStagingConfig, signIn, createFixtureOrganization, createMatch } from "./staging-client.js";

const config = readStagingConfig();

describe("Staging-Client", () => {
  it("meldet sich an und legt eine Fixture-Organisation mit Match an", async () => {
    const session = await signIn(config.baseUrl, config.email, config.password, config.origin);
    // Nur die Cookie-NAMEN pruefen, nie den Rohwert -- ein Fehlschlag darf
    // das Session-Token nicht in der Testausgabe zeigen.
    const cookieNames = session.cookie.split("; ").map((c) => c.split("=", 1)[0] ?? "");
    expect(cookieNames.some((name) => name.includes("better-auth.session_token"))).toBe(true);

    const runId = `run-${Date.now()}`;
    const fixture = await createFixtureOrganization(session, runId);
    const match = await createMatch(session, fixture.organizationId, fixture.playerIds, fixture.boardId);
    expect(match.version).toBe(0);
    expect(match.status).toBe("IN_PROGRESS");
  });
});
