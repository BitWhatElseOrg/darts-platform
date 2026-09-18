import { describe, expect, it } from "vitest";

import { readStagingConfig, signIn, createFixtureOrganization, createMatch } from "./staging-client.js";

const config = readStagingConfig();

describe("Staging-Client", () => {
  it("meldet sich an und legt eine Fixture-Organisation mit Match an", async () => {
    const session = await signIn(config.baseUrl, config.email, config.password, config.origin);
    expect(session.cookie).toContain("better-auth.session_token=");

    const runId = `run-${Date.now()}`;
    const fixture = await createFixtureOrganization(session, runId);
    const match = await createMatch(session, fixture.organizationId, fixture.playerIds, fixture.boardId);
    expect(match.version).toBe(0);
    expect(match.status).toBe("IN_PROGRESS");
  });
});
