"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Nur der Kiosk-Teilbaum (`/scheibe`) setzt diesen Kontext. Ausserhalb ist er
 * leer, und `apiRequest` sendet keinen Geraeteschluessel – eine Admin-Sitzung
 * auf demselben Tablet tritt so nie versehentlich als Geraet auf.
 */
const DeviceCredentialContext = createContext<string | undefined>(undefined);

export function DeviceCredentialProvider({ secret, children }: { readonly secret: string; readonly children: ReactNode }) {
  return <DeviceCredentialContext.Provider value={secret}>{children}</DeviceCredentialContext.Provider>;
}

export function useDeviceSecret(): string | undefined {
  return useContext(DeviceCredentialContext);
}
