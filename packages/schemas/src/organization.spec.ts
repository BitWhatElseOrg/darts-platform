import { expect, it } from "vitest";

import {
  createInvitationSchema,
  createOrganizationSchema,
  invitationSchema,
  linkMemberPlayerSchema,
  organizationCapabilitiesSchema,
  organizationMemberSchema,
  updateMembershipSchema,
  updateOrganizationSchema,
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

it("verlangt mindestens ein Stammdatenfeld und laesst den Slug nicht zu", () => {
  expect(updateOrganizationSchema.safeParse({}).success).toBe(false);
  expect(updateOrganizationSchema.safeParse({ name: "Neuer Name" }).success).toBe(true);
  expect(updateOrganizationSchema.safeParse({ name: "x" }).success).toBe(false);
  const parsed = updateOrganizationSchema.parse({ slug: "neuer-slug", locale: "fr-CH" });
  expect(parsed).toEqual({ locale: "fr-CH" });
});

it("weist eine unbekannte Zeitzone zurueck", () => {
  const result = updateOrganizationSchema.safeParse({ timezone: "Mars/Olympus" });

  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues[0]?.message).toBe("Unbekannte Zeitzone.");
  }
});

it("akzeptiert UTC als Zeitzone, obwohl sie in Intl.supportedValuesOf fehlt", () => {
  expect(updateOrganizationSchema.safeParse({ timezone: "UTC" }).success).toBe(true);
  expect(
    createOrganizationSchema.safeParse({
      name: "UTC Verein",
      slug: "utc-verein",
      timezone: "UTC",
      locale: "de-CH",
    }).success,
  ).toBe(true);
});

it("akzeptiert eine gueltige IANA-Zeitzone", () => {
  expect(updateOrganizationSchema.safeParse({ timezone: "Europe/Zurich" }).success).toBe(true);
});

it("kanonisiert eine Zeitzone unabhaengig von Gross-/Kleinschreibung", () => {
  const result = updateOrganizationSchema.safeParse({ timezone: "europe/zurich" });

  expect(result.success).toBe(true);
  if (result.success) expect(result.data.timezone).toBe("Europe/Zurich");
});

it("kanonisiert einen veralteten Zeitzonen-Alias auf den heutigen IANA-Namen", () => {
  // Empirisch mit Node 24 geprueft: `US/Pacific` loest ueber
  // `Intl.DateTimeFormat` auf `America/Los_Angeles` auf. Ob eine Node-Version
  // stattdessen den Alias unveraendert liesse, waere ebenso zulaessig — hier
  // haelt der Test das TATSAECHLICH beobachtete Verhalten fest, nicht eine
  // von zwei denkbaren Spezifikationen.
  const result = updateOrganizationSchema.safeParse({ timezone: "US/Pacific" });

  expect(result.success).toBe(true);
  if (result.success) {
    expect(new Intl.DateTimeFormat("en-US", { timeZone: "US/Pacific" }).resolvedOptions().timeZone).toBe(
      result.data.timezone,
    );
  }
});

it("weist eine numerische Offset-Zeitzone zurueck, obwohl Intl sie klaglos aufloest", () => {
  // "+01:00" ist kein IANA-Zonenname und traegt keine DST-Regeln, wird von
  // `Intl.DateTimeFormat` aber unveraendert als eigene Zeitzone akzeptiert.
  const result = updateOrganizationSchema.safeParse({ timezone: "+01:00" });

  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues[0]?.message).toBe("Unbekannte Zeitzone.");
  }
});

it("weist eine unbekannte Sprache zurueck", () => {
  const result = updateOrganizationSchema.safeParse({ locale: "nicht-existent!!" });

  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues[0]?.message).toBe("Unbekannte Sprache.");
  }
});

it("akzeptiert ein gueltiges BCP-47-Sprachtag", () => {
  expect(updateOrganizationSchema.safeParse({ locale: "en-GB" }).success).toBe(true);
});

it("kanonisiert ein Sprachtag ueber Intl.getCanonicalLocales", () => {
  const result = updateOrganizationSchema.safeParse({ locale: "de-ch" });

  expect(result.success).toBe(true);
  if (result.success) expect(result.data.locale).toBe(Intl.getCanonicalLocales("de-ch")[0]);
});

it("weist bei der Anlage eine unbekannte Zeitzone oder Sprache zurueck", () => {
  expect(
    createOrganizationSchema.safeParse({
      name: "Neuer Verein",
      slug: "neuer-verein",
      timezone: "Mars/Olympus",
      locale: "de-CH",
    }).success,
  ).toBe(false);
  expect(
    createOrganizationSchema.safeParse({
      name: "Neuer Verein",
      slug: "neuer-verein",
      timezone: "Europe/Zurich",
      locale: "nicht-existent!!",
    }).success,
  ).toBe(false);
});

it("nimmt den Faehigkeitsbescheid nur als echten Wahrheitswert entgegen", () => {
  // Faellt das Feld aus der Antwort oder kommt es als Zeichenkette, darf der
  // Client daraus nicht „erlaubt“ ableiten: der Weg waere dann sichtbar,
  // obwohl der Server ihn sperrt.
  expect(organizationCapabilitiesSchema.safeParse({}).success).toBe(false);
  expect(
    organizationCapabilitiesSchema.safeParse({ selfServiceEnabled: "true" }).success,
  ).toBe(false);
  expect(
    organizationCapabilitiesSchema.parse({ selfServiceEnabled: false })
      .selfServiceEnabled,
  ).toBe(false);
});
