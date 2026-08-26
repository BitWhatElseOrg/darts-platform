import type { Metadata } from "next";
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
  themeColor: "#059669",
  title: {
    default: "Dart Ost - Plattform",
    template: "%s | Dart Ost - Plattform",
  },
  description: "Sichere Plattform für Dartturniere, Matches und Vereinsorganisation.",
};

const DIRECTION_CONTRACT = `<!--
THESIS: One surface holds all eight boards at once in the board's own graphic apparatus; it refuses the dark SaaS card grid this category ships.
OWN-WORLD: Sisal ground, black wedge fields, steel spider hairlines, enamel numerals (Saira Condensed) over Archivo data type, red and green double-ring signals, square corners without exception.
STORY: The tournament director sees which board is free and which is about to free, and starts the next match in one action.
FIRST VIEWPORT: Name and match progress on top; eight wedge panels two across, the active player's remaining score at 3.5rem; queue and disruptions in the right column; the group sheet typeset below.
FORM: Sektorenring, candidate 3 of 7 grounded directions, seed key 616b8789.
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
