// @vitest-environment happy-dom
//
// `isStandaloneDisplay` unterscheidet die installierte App vom normalen
// Browser-Tab (Spec 2026-09-30-scheiben-tablet, Abschnitt 2). Konvention aus
// `display-keys-panel.render.spec.tsx`: einzelne Globals ueber `vi.stubGlobal`
// ersetzen, `window` bleibt das echte happy-dom-Objekt.
import { afterEach, describe, expect, it, vi } from "vitest";

import { isStandaloneDisplay } from "./standalone-display";

describe("isStandaloneDisplay", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("erkennt den PWA-Anzeigemodus ueber matchMedia", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));

    expect(isStandaloneDisplay()).toBe(true);
  });

  it("erkennt die installierte App unter iOS ueber navigator.standalone", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    vi.stubGlobal("navigator", { ...window.navigator, standalone: true });

    expect(isStandaloneDisplay()).toBe(true);
  });

  it("ist false ausserhalb der installierten App", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));

    expect(isStandaloneDisplay()).toBe(false);
  });

  it("bleibt false, wenn matchMedia wirft", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => {
        throw new Error("matchMedia nicht unterstuetzt");
      }),
    );

    expect(isStandaloneDisplay()).toBe(false);
  });
});
