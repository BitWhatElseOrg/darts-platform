import { expect, it } from "vitest";

import { createInvitationSchema, invitationSchema } from "./organization.js";

it("reads the internal owner bootstrap invitation", () => {
  expect(
    invitationSchema.parse({
      id: crypto.randomUUID(),
      organizationId: crypto.randomUUID(),
      email: "owner@example.ch",
      role: "OWNER",
      status: "PENDING",
      expiresAt: new Date(),
    }).role,
  ).toBe("OWNER");
});

it("does not let the regular invitation API grant owner", () => {
  expect(
    createInvitationSchema.safeParse({
      email: "owner@example.ch",
      role: "OWNER",
    }).success,
  ).toBe(false);
});
