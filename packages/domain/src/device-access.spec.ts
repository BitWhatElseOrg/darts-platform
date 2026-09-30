import { describe, expect, it } from "vitest";

import { decideDeviceMatchAccess, devicePermissions, isDevicePermission } from "./device-access";
import { organizationPermissions } from "./permissions";

describe("devicePermissions", () => {
  it("enthält genau die vier Rechte eines Scheiben-Tablets", () => {
    expect([...devicePermissions]).toEqual(["match:read", "match:score", "match:undo", "statistics:read"]);
  });

  it("gewährt weder Abbruch noch Anlegen noch irgendein anderes Recht", () => {
    const granted = organizationPermissions.filter((permission) => isDevicePermission(permission));
    expect(granted).toEqual(["match:read", "match:score", "match:undo", "statistics:read"]);
    expect(isDevicePermission("match:abort")).toBe(false);
    expect(isDevicePermission("match:create")).toBe(false);
  });
});

describe("decideDeviceMatchAccess", () => {
  const board = "board-a";

  it("lehnt ein Match einer anderen Scheibe für jede Aktion ab", () => {
    for (const action of ["read", "write"] as const) {
      expect(decideDeviceMatchAccess({ action, deviceBoardId: board, matchBoardId: "board-b", matchStatus: "IN_PROGRESS" })).toBe("BOARD_MISMATCH");
    }
  });

  it("lehnt ein Match ohne Scheibe ab", () => {
    expect(decideDeviceMatchAccess({ action: "read", deviceBoardId: board, matchBoardId: null, matchStatus: "IN_PROGRESS" })).toBe("BOARD_MISMATCH");
  });

  it("erlaubt Lesen in jedem Status", () => {
    for (const matchStatus of ["IN_PROGRESS", "COMPLETED", "ABORTED"]) {
      expect(decideDeviceMatchAccess({ action: "read", deviceBoardId: board, matchBoardId: board, matchStatus })).toBe("ALLOWED");
    }
  });

  it("erlaubt Schreiben (Wurf, Undo, Leg-Entscheid, Lease) nur im laufenden Match", () => {
    expect(decideDeviceMatchAccess({ action: "write", deviceBoardId: board, matchBoardId: board, matchStatus: "IN_PROGRESS" })).toBe("ALLOWED");
    expect(decideDeviceMatchAccess({ action: "write", deviceBoardId: board, matchBoardId: board, matchStatus: "COMPLETED" })).toBe("MATCH_NOT_ACTIVE");
    expect(decideDeviceMatchAccess({ action: "write", deviceBoardId: board, matchBoardId: board, matchStatus: "ABORTED" })).toBe("MATCH_NOT_ACTIVE");
  });

  it("behandelt einen unbekannten Status beim Schreiben als nicht aktiv", () => {
    expect(decideDeviceMatchAccess({ action: "write", deviceBoardId: board, matchBoardId: board, matchStatus: "SOMETHING" })).toBe("MATCH_NOT_ACTIVE");
  });
});
