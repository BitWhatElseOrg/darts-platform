// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ apiRequest: vi.fn(), userFacingErrorMessage: vi.fn() }));
vi.mock("@/lib/api-client", () => client);

import { DisplayKeysPanel } from "./display-keys-panel";

beforeEach(() => {
  vi.useFakeTimers();
  client.apiRequest.mockImplementation(({ method }: { method?: string }) => {
    if (method === "POST") {
      return Promise.resolve({
        id: "key-1",
        label: "Eingang Halle",
        secret: "geheim-123",
        expiresAt: new Date("2026-09-10T00:00:00.000Z"),
        revokedAt: null,
        state: "valid",
      });
    }
    return Promise.resolve({ keys: [] });
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DisplayKeysPanel Copy-Button", () => {
  it("setzt 'Kopiert' nach der Anzeigedauer wieder auf 'Kopieren' zurueck", async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal("navigator", { clipboard });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(DisplayKeysPanel, {
          canManageDisplayKeys: true,
          organizationId: "org-1",
          tournamentId: "tour-1",
        }),
      ),
    );

    // Use real timers during setup
    vi.useRealTimers();

    try {
      // Wait for form to render
      const input = await waitFor(
        () => screen.getByPlaceholderText("z. B. Eingang Halle"),
        { timeout: 2000 }
      );
      const submitBtn = screen.getByRole("button", { name: "Schlüssel ausstellen" });

      // Simulate form input by using React synthetic event
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(input, "Test Label");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }

      // Submit form
      submitBtn.click();

      // Wait for secret to appear
      await waitFor(() => screen.getByText("geheim-123"), { timeout: 2000 });
    } finally {
      vi.useFakeTimers();
    }

    // Now test the copy button with fake timers
    const copyBtn = screen.getByRole("button", { name: "Kopieren" });
    expect(copyBtn).toBeTruthy();

    // Click copy button
    copyBtn.click();

    // Allow microtasks to process
    await vi.waitFor(
      () => {
        const btn = screen.queryByRole("button", { name: "Kopiert" });
        expect(btn).toBeTruthy();
      },
      { timeout: 100 }
    );

    // Verify button shows "Kopiert"
    expect(screen.getByRole("button", { name: "Kopiert" })).toBeTruthy();
    expect(clipboard.writeText).toHaveBeenCalledWith("geheim-123");

    // Advance timers by 2 seconds
    vi.advanceTimersByTime(2_000);

    // Let React process the state change
    await vi.waitFor(
      () => {
        const btn = screen.queryByRole("button", { name: "Kopieren" });
        expect(btn).toBeTruthy();
      },
      { timeout: 100 }
    );

    // Button should be back to "Kopieren"
    expect(screen.getByRole("button", { name: "Kopieren" })).toBeTruthy();
  });
});
