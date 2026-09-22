// Haelt die Struktur der handgepflegten Bedienungsanleitung zusammen: sie ist
// statisches HTML ohne Bauschritt, also faellt eine kaputte Navigation sonst
// erst einem Leser auf. Bewusst kein Playwright-Fall — die Datei wird nicht
// ausgeliefert-erzeugt, sondern liegt so im Repository; sie hier direkt zu
// lesen prueft dasselbe in Millisekunden statt in Sekunden. Dass die Seite
// ueberhaupt erreichbar ist, deckt `tests/foundation.spec.ts` ab.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const manual = readFileSync(
  fileURLToPath(new URL("../../public/bedienungsanleitung.html", import.meta.url)),
  "utf8",
);

function matchAll(pattern: RegExp): readonly string[] {
  return [...manual.matchAll(pattern)].map((match) => match[1] ?? "");
}

const elementIds = matchAll(/id="([^"]+)"/g);
const sectionIds = matchAll(/<section id="([^"]+)"/g);
const tableOfContentsTargets = matchAll(/<li><a href="#([^"]+)">/g);
const internalLinks = matchAll(/href="#([^"]+)"/g);

describe("Bedienungsanleitung", () => {
  it("fuehrt jeden internen Verweis auf ein vorhandenes Ziel", () => {
    const dangling = internalLinks.filter((target) => !elementIds.includes(target));

    expect(dangling).toEqual([]);
  });

  it("vergibt jede Kennung nur einmal", () => {
    const duplicates = elementIds.filter((id, index) => elementIds.indexOf(id) !== index);

    expect(duplicates).toEqual([]);
  });

  it("listet jeden Abschnitt im Inhaltsverzeichnis", () => {
    const missing = sectionIds.filter((id) => !tableOfContentsTargets.includes(id));

    expect(missing).toEqual([]);
  });

  it("verweist aus dem Inhaltsverzeichnis nur auf Abschnitte", () => {
    const strays = tableOfContentsTargets.filter((target) => !sectionIds.includes(target));

    expect(strays).toEqual([]);
  });

  it("nummeriert die Abschnitte luecken- und sprungfrei durch", () => {
    const numbers = matchAll(/<p class="eyebrow">(\d+) · /g).map(Number);

    expect(numbers).toEqual(sectionIds.map((_, index) => index + 1));
  });

  it("beschreibt die Flaechen, die es heute gibt", () => {
    for (const anchor of ["liga", "zugang", "organisation", "spieler", "live"]) {
      expect(sectionIds).toContain(anchor);
    }
    // Der Ligabetrieb, der Mailversand und die Profilbilder fehlten der
    // Ausgabe 1.1 vollstaendig; diese Begriffe belegen, dass sie drin sind.
    for (const term of ["Begegnung", "Aufstellung", "Entscheidungsdoppel", "Profilbild", "Einladungsmail", "Anzeige-Schlüssel"]) {
      expect(manual).toContain(term);
    }
  });

  it("behauptet nicht mehr, Einladungen wuerden nicht verschickt", () => {
    expect(manual).not.toContain("nicht automatisch per E-Mail");
  });
});
