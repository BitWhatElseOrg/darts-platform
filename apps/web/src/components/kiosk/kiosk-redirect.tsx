"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { recallBoardDevice } from "@/lib/device-key-storage";
import { isStandaloneDisplay } from "@/lib/standalone-display";

/**
 * Leitet ein gekoppeltes Scheiben-Tablet von der Startseite in den Kiosk um
 * (Spec 2026-09-30-scheiben-tablet, Task 11).
 *
 * Nur innerhalb der installierten App (`isStandaloneDisplay`), nie im
 * normalen Browser-Tab: Chrome teilt `localStorage` zwischen Tab und App --
 * ein verwaltendes Konto, das auf demselben Android-Tablet den gewoehnlichen
 * Browser oeffnet, landete sonst ebenfalls im Kiosk, obwohl es die
 * Organisationsverwaltung sehen will.
 *
 * `router.replace` in einem Effect ist hier keine abgeleitete
 * Zustandsanpassung, sondern eine echte Navigation -- ein legitimer
 * Seiteneffekt, keine Verletzung von `react-hooks/set-state-in-effect`. Die
 * Bedingung selbst haengt von nichts Reaktivem ab und laeuft deshalb genau
 * einmal beim Einhaengen.
 */
export function KioskRedirect() {
  const router = useRouter();

  useEffect(() => {
    if (isStandaloneDisplay() && recallBoardDevice() !== null) {
      router.replace("/scheibe");
    }
  }, [router]);

  return null;
}
