import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/auth.types.js";
import { TournamentsService } from "./tournaments.service.js";

describe("TournamentsService.preview", () => {
  const access = { requirePermission: vi.fn().mockResolvedValue(undefined) };
  const service = new TournamentsService({} as never, {} as never, access as never, {} as never);
  const auth = { user: { id: "user-1" } } as unknown as AuthContext;

  // Task 5 ersetzt diese Sperre durch die echte Doppel-K.-o.-Vorschau.
  it("antwortet für DOUBLE_ELIMINATION mit 400 FORMAT_NOT_SUPPORTED", async () => {
    const result = service.preview({
      organizationId: "org-1",
      auth,
      data: { format: "DOUBLE_ELIMINATION", participantCount: 8, groupCount: 1, qualifyPerGroup: 1, knockoutSize: 8 },
    });
    await expect(result).rejects.toBeInstanceOf(BadRequestException);
    await expect(result).rejects.toMatchObject({ response: { code: "FORMAT_NOT_SUPPORTED" } });
  });
});
