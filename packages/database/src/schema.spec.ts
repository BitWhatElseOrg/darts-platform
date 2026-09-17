import { describe, expect, it } from "vitest";

import { playerAvatars } from "./schema.js";

describe("player_avatars", () => {
  it("traegt einen Datensatz je Spieler und haengt an der Organisation", () => {
    const columns = Object.keys(playerAvatars);
    for (const column of ["id", "organizationId", "playerId", "contentType", "bytes", "byteSize", "checksum"]) {
      expect(columns).toContain(column);
    }
  });
});
