// Haelt die Struktur der handgepflegten Datenschutzerklaerung zusammen — wie
// `bedienungsanleitung.spec.ts` fuer die Anleitung: statisches HTML ohne
// Bauschritt, eine kaputte Navigation faellt sonst erst einem Leser auf.
// Dazu die Belege, dass die Erklaerung das beschreibt, was die Plattform
// wirklich tut, und dass sie als Entwurf gekennzeichnet bleibt, bis jemand
// die Kennzeichnung bewusst entfernt.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const publicDirectory = new URL("../../public/", import.meta.url);
const notice = readFileSync(fileURLToPath(new URL("datenschutz.html", publicDirectory)), "utf8");
const manual = readFileSync(
  fileURLToPath(new URL("bedienungsanleitung.html", publicDirectory)),
  "utf8",
);

function matchAll(source: string, pattern: RegExp): readonly string[] {
  return [...source.matchAll(pattern)].map((match) => match[1] ?? "");
}

const elementIds = matchAll(notice, /id="([^"]+)"/g);
const sectionIds = matchAll(notice, /<section id="([^"]+)"/g);
const tableOfContentsTargets = matchAll(notice, /<li><a href="#([^"]+)">/g);
const internalLinks = matchAll(notice, /href="#([^"]+)"/g);

describe("Datenschutzerklaerung", () => {
  it("fuehrt jeden internen Verweis auf ein vorhandenes Ziel", () => {
    const dangling = internalLinks.filter((target) => !elementIds.includes(target));

    expect(dangling).toEqual([]);
  });

  it("vergibt jede Kennung nur einmal", () => {
    const duplicates = elementIds.filter((id, index) => elementIds.indexOf(id) !== index);

    expect(duplicates).toEqual([]);
  });

  it("listet jeden Abschnitt im Inhaltsverzeichnis und nichts sonst", () => {
    expect(sectionIds.filter((id) => !tableOfContentsTargets.includes(id))).toEqual([]);
    expect(tableOfContentsTargets.filter((target) => !sectionIds.includes(target))).toEqual([]);
  });

  it("nummeriert die Abschnitte luecken- und sprungfrei durch", () => {
    const numbers = matchAll(notice, /<p class="eyebrow">(\d+) · /g).map(Number);

    expect(numbers).toEqual(sectionIds.map((_, index) => index + 1));
  });

  it("nennt die Verarbeitungen, die es heute gibt", () => {
    for (const term of [
      "Railway",
      "Resend",
      "Cloudflare",
      "Better Stack",
      "Audit-Protokoll",
      "Anzeige-Schlüssel",
      "Profilbild",
      "48 Stunden",
      "HttpOnly",
    ]) {
      expect(notice).toContain(term);
    }
  });

  it("verspricht keine Dienste, die die Plattform nicht einsetzt", () => {
    // Kein Analytics, kein Consent-Banner: die Erklaerung sagt das
    // ausdruecklich, statt einen Banner zu beschreiben, den es nicht gibt.
    expect(notice).toContain("keinen Cookie-Banner");
    expect(notice).not.toMatch(/Google Analytics|Matomo|Plausible/u);
  });

  it("bleibt als Entwurf gekennzeichnet, bis die Freigabe erfolgt ist", () => {
    expect(notice).toContain("Entwurf – noch nicht freigegeben");
    expect(notice).toMatch(/<p class="meta">Entwurf/u);
  });

  it("teilt sich den Stil mit der Bedienungsanleitung", () => {
    expect(notice).toContain('href="/seiten.css"');
    expect(manual).toContain('href="/seiten.css"');
    expect(notice).not.toContain("<style>");
    expect(manual).not.toContain("<style>");
  });

  it("verlinkt beide Seiten gegenseitig", () => {
    expect(notice).toContain('href="/bedienungsanleitung.html"');
    expect(manual).toContain('href="/datenschutz.html"');
  });
});
