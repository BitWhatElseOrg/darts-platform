import { describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/auth.types.js";
import { TournamentsService } from "./tournaments.service.js";

describe("TournamentsService.preview", () => {
  const access = { requirePermission: vi.fn().mockResolvedValue(undefined) };
  const service = new TournamentsService({} as never, {} as never, access as never, {} as never);
  const auth = { user: { id: "user-1" } } as unknown as AuthContext;

  it("rechnet die Doppel-K.-o.-Vorschau (13 Teilnehmer, 16er-Tableau)", async () => {
    const preview = await service.preview({
      organizationId: "org-1",
      auth,
      data: { format: "DOUBLE_ELIMINATION", participantCount: 13, groupCount: 1, qualifyPerGroup: 1, knockoutSize: 16 },
    });
    expect(preview).toMatchObject({ knockoutMatchCount: 24, byes: 3, totalMatches: 24 });
  });
});
