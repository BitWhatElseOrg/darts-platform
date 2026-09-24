// @vitest-environment happy-dom
//
// `ConfirmDialog` ist das gemeinsame Bestaetigungsdialog-Grundgerueist fuer
// Task 3 (Spieler loeschen/archivieren), Task 6 (Mitglied entfernen) und
// Task 8 (Organisation loeschen mit Namensbestaetigung). Der Test haelt den
// oeffentlichen Vertrag fest: natives `<dialog>`, Titel/Beschreibung ueber
// `aria-labelledby`/`aria-describedby`, Bestaetigen/Abbrechen, `pending`
// und `confirmDisabled` sperren die Bestaetigung, `error` erscheint als
// `role="alert"`, und Escape schliesst ueber das native `cancel`-Event.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "./confirm-dialog";

afterEach(() => {
  cleanup();
});

function renderDialog(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const props = {
    open: true,
    title: "Spieler archivieren",
    description: "Anna Müller kann danach keine neuen Matches bestreiten.",
    confirmLabel: "Archivieren",
    pending: false,
    error: null,
    onConfirm,
    onCancel,
    ...overrides,
  };
  const result = render(createElement(ConfirmDialog, props));
  return { ...result, onConfirm, onCancel };
}

describe("ConfirmDialog", () => {
  it("rendert nichts bei open=false", () => {
    renderDialog({ open: false });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("zeigt Titel/Beschreibung; aria-labelledby/aria-describedby zeigen auf vorhandene IDs", () => {
    renderDialog();

    const dialog = screen.getByRole("dialog");
    const labelledBy = dialog.getAttribute("aria-labelledby");
    const describedBy = dialog.getAttribute("aria-describedby");

    expect(labelledBy).not.toBeNull();
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(labelledBy ?? "")?.textContent).toBe("Spieler archivieren");
    expect(document.getElementById(describedBy ?? "")?.textContent).toBe(
      "Anna Müller kann danach keine neuen Matches bestreiten.",
    );
  });

  it("Klick auf Bestaetigen ruft onConfirm, Abbrechen ruft onCancel", () => {
    const { onConfirm, onCancel } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Archivieren" }));
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("confirmDisabled deaktiviert Bestaetigen", () => {
    renderDialog({ confirmDisabled: true });

    expect((screen.getByRole("button", { name: "Archivieren" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("pending deaktiviert Bestaetigen", () => {
    renderDialog({ pending: true });

    expect((screen.getByRole("button", { name: "Archivieren" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("zeigt error als role=alert", () => {
    renderDialog({ error: "Das hat nicht funktioniert." });

    expect(screen.getByRole("alert").textContent).toBe("Das hat nicht funktioniert.");
  });

  it("rendert children, z. B. einen zusaetzlichen Button", () => {
    renderDialog({ children: createElement("p", null, "Zusatzinhalt") });

    expect(screen.getByText("Zusatzinhalt")).toBeTruthy();
  });

  it("schliesst ueber das native cancel-Event (Escape) und ruft onCancel", () => {
    const { onCancel } = renderDialog();

    const dialog = screen.getByRole("dialog");
    fireEvent(dialog, new Event("cancel", { cancelable: true }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
