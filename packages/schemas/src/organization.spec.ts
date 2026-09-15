import { expect, it } from "vitest";

import {
  createInvitationSchema,
  invitationSchema,
  linkMemberPlayerSchema,
  organizationMemberSchema,
  updateMembershipSchema,
} from "./organization.js";

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

it("verlangt mindestens eine Aenderung an der Mitgliedschaft", () => {
  expect(updateMembershipSchema.safeParse({}).success).toBe(false);
  expect(updateMembershipSchema.safeParse({ role: "SCORER" }).success).toBe(true);
  expect(updateMembershipSchema.safeParse({ status: "SUSPENDED" }).success).toBe(true);
});

it("laesst die Rolle OWNER durch das Schema, damit Eigentum uebertragbar bleibt", () => {
  // Wer OWNER tatsaechlich vergeben darf, entscheidet der Service — nicht das
  // Schema. Der Einladungspfad bleibt davon unberuehrt.
  expect(updateMembershipSchema.safeParse({ role: "OWNER" }).success).toBe(true);
  expect(createInvitationSchema.safeParse({ email: "a@example.ch", role: "OWNER" }).success).toBe(
    false,
  );
});

it("kennt als setzbaren Status nur ACTIVE und SUSPENDED", () => {
  expect(updateMembershipSchema.safeParse({ status: "INVITED" }).success).toBe(false);
});

it("gibt eine Mitgliedschaft mit Rolle und Status zurueck", () => {
  const member = organizationMemberSchema.parse({
    userId: crypto.randomUUID(),
    email: "mitglied@example.ch",
    displayName: "Mitglied",
    role: "SCORER",
    status: "SUSPENDED",
    player: null,
  });

  expect(member.status).toBe("SUSPENDED");
});

it("traegt das zugeordnete Spielerprofil, wenn es eines gibt", () => {
  const playerId = crypto.randomUUID();
  const member = organizationMemberSchema.parse({
    userId: crypto.randomUUID(),
    email: "spielerin@example.ch",
    displayName: "Spielerin",
    role: "MEMBER",
    status: "ACTIVE",
    player: { id: playerId, displayName: "A. Muster" },
  });

  expect(member.player).toEqual({ id: playerId, displayName: "A. Muster" });
});

it("nimmt einen optionalen Spielerbezug in die Einladung auf", () => {
  const withPlayer = createInvitationSchema.safeParse({
    email: "neu@example.ch",
    role: "MEMBER",
    playerId: crypto.randomUUID(),
  });
  const withoutPlayer = createInvitationSchema.safeParse({
    email: "neu@example.ch",
    role: "MEMBER",
  });

  expect(withPlayer.success).toBe(true);
  expect(withoutPlayer.success).toBe(true);
});

it("weist einen Spielerbezug zurueck, der keine UUID ist", () => {
  const result = createInvitationSchema.safeParse({
    email: "neu@example.ch",
    role: "MEMBER",
    playerId: "spieler-7",
  });

  expect(result.success).toBe(false);
});

it("verlangt fuer die manuelle Zuordnung genau eine Spieler-UUID", () => {
  expect(linkMemberPlayerSchema.safeParse({}).success).toBe(false);
  expect(
    linkMemberPlayerSchema.safeParse({ playerId: crypto.randomUUID() }).success,
  ).toBe(true);
});
