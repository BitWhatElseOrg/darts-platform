// @vitest-environment happy-dom
//
// Haelt fest, dass das Health-Panel keine dritte Akzentfarbe mehr traegt:
// jeder Status kommt ueber StateTag (Farbe + gezeichnete Marke + Wort), nicht
// mehr ueber einen rohen amber/emerald/rose-Punkt (DESIGN.md, "The Two
// Signals Rule").
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/health", () => ({
  fetchHealth: vi.fn(() => Promise.resolve({ services: { database: "ok", redis: "ok" } })),
}));

import { HealthDashboard } from "./health-dashboard";

afterEach(() => {
  cleanup();
});

describe("HealthDashboard", () => {
  it("rendert keine rohe amber/emerald/rose-Klasse mehr", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      createElement(QueryClientProvider, { client: queryClient }, createElement(HealthDashboard)),
    );
    await screen.findAllByText("OK");
    expect(container.innerHTML).not.toMatch(/\b(?:bg|text)-(?:amber|emerald|rose)-\d/);
  });

  it("rendert im compact-Modus genau ein StateTag statt der dl-Zeilen", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(HealthDashboard, { variant: "compact" }),
      ),
    );
    await screen.findByText("Dienste betriebsbereit");
    expect(container.querySelector("dl")).toBeNull();
    expect(container.querySelectorAll("svg")).toHaveLength(1);
  });
});
