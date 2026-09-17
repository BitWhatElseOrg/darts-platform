// @vitest-environment happy-dom
//
// Haelt die zweite Identitaet der Ruecktaste fest: bei leerer Eingabe trifft
// sie die letzte bereits gesendete Aufnahme und traegt dafuer die rote
// Rendition (`backspace-key.tsx`). Die Aktionszeile gibt der Taste
// zusaetzlich ihre eigene Hoehenregel mit; weil `cn()` (tailwind-merge) bei
// gleichartigen Utilities die SPAETERE Klasse gewinnen laesst und
// `className` in `BackspaceKey` zuletzt steht, hat eine durchgereichte
// Vollklasse die roten Farbtoken einmal still ueberschrieben -- die Taste
// sah auf dem Telefon aus wie jede andere. Dieser Test haelt beides
// gleichzeitig fest: rote Rendition UND Aktionszeilen-Hoehe.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { RoundKeypad } from "./round-keypad";

afterEach(cleanup);

function renderKeypad(overrides: Partial<Parameters<typeof RoundKeypad>[0]> = {}) {
  return render(
    <RoundKeypad
      disabled={false}
      onBackspace={vi.fn()}
      onDigit={vi.fn()}
      onQuickScore={vi.fn()}
      onSubmit={vi.fn()}
      quickScores={[26, 36, 52, 60, 141, 180]}
      quickScoresSource="ORGANIZATION"
      submittable={false}
      undoAvailable
      undoPoints={141}
      value=""
      {...overrides}
    />,
  );
}

/**
 * Geprueft wird die Klassenliste als Menge einzelner Token, nicht als Text:
 * `hover:enabled:bg-wedge-900` gehoert zur roten Rendition selbst und
 * enthaelt `bg-wedge-900` als Teilzeichenkette. Ein Teilstring-Vergleich
 * haette die Taste deshalb faelschlich als neutral gemeldet.
 */
const classTokens = (element: Element) => new Set(element.className.split(/\s+/u));

it("zeigt die Ruecktaste in der roten Rendition, sobald sie die letzte Aufnahme trifft", () => {
  renderKeypad();
  const tokens = classTokens(screen.getByRole("button", { name: "Letzte Aufnahme zurücknehmen: 141 Punkte" }));

  expect(tokens).toContain("border-ring-red");
  expect(tokens).toContain("bg-sisal-100");
  expect(tokens).toContain("text-ring-red");
  // Die neutralen Token der Grundtaste duerfen nicht gewonnen haben.
  expect(tokens).not.toContain("border-sisal-400");
  expect(tokens).not.toContain("bg-wedge-900");
  expect(tokens).not.toContain("text-chalk");
});

it("gibt der Ruecktaste die Hoehenregel der Aktionszeile mit", () => {
  renderKeypad();
  const tokens = classTokens(screen.getByRole("button", { name: "Letzte Aufnahme zurücknehmen: 141 Punkte" }));

  expect(tokens).toContain("[@media(min-height:44rem)]:min-h-14");
});

it("traegt bei angefangener Eingabe die neutrale Rendition", () => {
  renderKeypad({ value: "14" });
  const tokens = classTokens(screen.getByRole("button", { name: "Rücktaste" }));

  expect(tokens).toContain("bg-wedge-800");
  expect(tokens).not.toContain("text-ring-red");
});
