import type { Metadata } from "next";

import { KioskRoute } from "@/components/kiosk/kiosk-route";

export const metadata: Metadata = {
  title: "Scheibe",
  description: "Score-Erfassung eines fest montierten Tablets.",
};

export default function ScheibePage() {
  return <KioskRoute />;
}
