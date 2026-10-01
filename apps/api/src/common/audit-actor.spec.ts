import { describe, expect, it } from "vitest";

import type { AuthContext, DeviceAuthContext } from "../auth/auth.types.js";
import { auditActor, leaseActor } from "./audit-actor.js";

const user: AuthContext = { user: { id: "u1", email: "a@example.test", name: "A" }, session: { id: "s1", expiresAt: new Date() } };
const device: DeviceAuthContext = { device: { id: "d1", organizationId: "o1", boardId: "b1" } };

describe("auditActor", () => {
  it("setzt beim Benutzer nur actorUserId", () => {
    expect(auditActor(user)).toEqual({ actorUserId: "u1", actorDeviceId: null });
    expect(leaseActor(user)).toEqual({ userId: "u1", deviceId: null });
  });

  it("setzt beim Gerät nur actorDeviceId", () => {
    expect(auditActor(device)).toEqual({ actorUserId: null, actorDeviceId: "d1" });
    expect(leaseActor(device)).toEqual({ userId: null, deviceId: "d1" });
  });
});
