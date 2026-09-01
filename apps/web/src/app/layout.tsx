import type { Metadata, Viewport } from "next";
import { Archivo, Saira_Condensed } from "next/font/google";
import type { ReactNode } from "react";

import { Providers } from "@/components/providers";

import "./globals.css";

/** Enamel numerals off the number ring; squared terminals, condensed width. */
const sairaCondensed = Saira_Condensed({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-saira-condensed",
  display: "swap",
});

/** The data workhorse: a grotesque with true tabular figures. */
const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
});

export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
  title: {
    default: "DartBase - Plattform",
    template: "%s | DartBase - Plattform",
  },
  description: "Sichere Plattform für Dartturniere, Matches und Vereinsorganisation.",
};

export const viewport: Viewport = { themeColor: "#059669" };

const DIRECTION_CONTRACT = `<!--
THESIS: Entry and tournament administration share one calm dark operating surface while all eight boards remain readable at once.
OWN-WORLD: Slate ground, raised slate panels, emerald actions, visible focus, rounded controls and high-contrast status signals.
STORY: The tournament director sees which board is free and which is about to free, and starts the next match in one action.
FIRST VIEWPORT: Name and match progress on top; eight wedge panels two across, the active player's remaining score at 3.5rem; queue and disruptions in the right column; the group sheet typeset below.
FORM: Unified DartBase dark interface, with the tournament information hierarchy preserved.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
-->`;

interface RootLayoutProps {
  readonly children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html className={`${sairaCondensed.variable} ${archivo.variable}`} lang="de">
      <body>
        <div dangerouslySetInnerHTML={{ __html: DIRECTION_CONTRACT }} style={{ display: "contents" }} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
