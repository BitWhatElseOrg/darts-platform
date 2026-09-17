// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";

import {
  organizationSelectionStorageKey,
  readOrganizationSelection,
  resolveOrganization,
  writeOrganizationSelection,
} from "./organization-selection";

const alpha = { id: "11111111-1111-4111-8111-111111111111", name: "Alpha" };
const beta = { id: "22222222-2222-4222-8222-222222222222", name: "Beta" };
const organizations = [alpha, beta];

describe("resolveOrganization", () => {
  it("nimmt die in der Adresse genannte Organisation", () => {
    expect(
      resolveOrganization({ organizations, requestedId: beta.id, rememberedId: alpha.id }),
    ).toBe(beta);
  });

  it("bleibt bei der zuletzt gewaehlten, wenn die Adresse keine nennt", () => {
    // Der gemeldete Fehler: ueber „Uebersicht" ging die Auswahl verloren,
    // weil ohne Parameter die erste Organisation der Liste gewann.
    expect(
      resolveOrganization({ organizations, requestedId: undefined, rememberedId: beta.id }),
    ).toBe(beta);
  });

  it("faellt auf die erste zugaengliche zurueck, wenn nichts gemerkt ist", () => {
    expect(
      resolveOrganization({ organizations, requestedId: undefined, rememberedId: null }),
    ).toBe(alpha);
  });

  it("verwirft eine gemerkte Organisation ohne Zugriff", () => {
    // Der Wert kommt aus dem Browserspeicher und kann von einem anderen Konto
    // stammen; er wird nie ungeprueft uebernommen.
    expect(
      resolveOrganization({ organizations, requestedId: undefined, rememberedId: "fremd" }),
    ).toBe(alpha);
  });

  it("verwirft eine angefragte Organisation ohne Zugriff und behaelt die gemerkte", () => {
    expect(
      resolveOrganization({ organizations, requestedId: "fremd", rememberedId: beta.id }),
    ).toBe(beta);
  });

  it("liefert null ohne zugaengliche Organisation", () => {
    expect(resolveOrganization({ organizations: [], requestedId: undefined, rememberedId: null })).toBeNull();
  });

  it("liefert null, solange die Liste nicht geladen ist", () => {
    expect(resolveOrganization({ organizations: undefined, requestedId: alpha.id, rememberedId: null })).toBeNull();
  });
});

describe("Speicher der Auswahl", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("gibt die geschriebene Auswahl zurueck", () => {
    writeOrganizationSelection(beta.id);
    expect(readOrganizationSelection()).toBe(beta.id);
    expect(window.localStorage.getItem(organizationSelectionStorageKey)).toBe(beta.id);
  });

  it("liefert null ohne gespeicherte Auswahl", () => {
    expect(readOrganizationSelection()).toBeNull();
  });
});
