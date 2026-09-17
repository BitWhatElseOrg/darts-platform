import { describe, expect, it } from "vitest";
import sharp from "sharp";

import { AvatarImageError, normalizeAvatarImage } from "./avatar-image.js";

/** Ein echtes Bild, nicht gefälschte Bytes: die Normalisierung dekodiert wirklich. */
async function sourceImage(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } },
  })
    .jpeg()
    .toBuffer();
}

/**
 * Ein nicht-quadratisches Bild mit EXIF-Orientation 6 ("90° im Uhrzeigersinn
 * drehen"): oben ein rotes, unten ein blaues Band über die volle Breite.
 * Die Pixel selbst bleiben unrotiert — nur der EXIF-Tag markiert, wie sie
 * korrekt zu drehen sind. So lässt sich nachweisen, ob `.rotate()` die
 * Orientierung wirklich anwendet, bevor sie verworfen wird.
 */
async function orientedTwoToneImage(): Promise<Buffer> {
  const width = 400;
  const height = 200;
  const band = width * (height / 2) * 3;

  const red = Buffer.alloc(band);
  for (let i = 0; i < red.length; i += 3) {
    red[i] = 220;
    red[i + 1] = 20;
    red[i + 2] = 20;
  }
  const blue = Buffer.alloc(band);
  for (let i = 0; i < blue.length; i += 3) {
    blue[i] = 20;
    blue[i + 1] = 20;
    blue[i + 2] = 220;
  }

  const withoutOrientation = await sharp({
    create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .composite([
      { input: red, raw: { width, height: height / 2, channels: 3 }, top: 0, left: 0 },
      { input: blue, raw: { width, height: height / 2, channels: 3 }, top: height / 2, left: 0 },
    ])
    .jpeg()
    .toBuffer();

  return sharp(withoutOrientation).withMetadata({ orientation: 6 }).toBuffer();
}

/**
 * Mittelwert je Farbkanal über einen Bildausschnitt.
 *
 * Bewusst `raw()` statt `stats()` direkt nach `extract()`: in dieser
 * sharp-Version liefert eine direkte `extract().stats()`-Verkettung die
 * Statistik des gesamten Bildes statt des Ausschnitts. Über die rohen Pixel
 * selbst gerechnet, ist das Ergebnis eindeutig.
 */
async function regionMeanColor(
  bytes: Buffer,
  region: { left: number; top: number; width: number; height: number },
): Promise<{ r: number; g: number; b: number }> {
  const { data, info } = await sharp(bytes)
    .extract(region)
    .raw()
    .toBuffer({ resolveWithObject: true });

  let r = 0;
  let g = 0;
  let b = 0;
  const pixelCount = info.width * info.height;
  for (let i = 0; i < data.length; i += info.channels) {
    r += data[i] ?? 0;
    g += data[i + 1] ?? 0;
    b += data[i + 2] ?? 0;
  }
  return { r: r / pixelCount, g: g / pixelCount, b: b / pixelCount };
}

describe("normalizeAvatarImage", () => {
  it("liefert ein quadratisches WebP von 256 Pixeln", async () => {
    const result = await normalizeAvatarImage(await sourceImage(900, 600));

    expect(result.contentType).toBe("image/webp");
    const metadata = await sharp(result.bytes).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(256);
    expect(metadata.height).toBe(256);
  });

  it("bleibt unter der gespeicherten Groessengrenze", async () => {
    const result = await normalizeAvatarImage(await sourceImage(2000, 2000));

    expect(result.byteSize).toBe(result.bytes.byteLength);
    expect(result.byteSize).toBeLessThanOrEqual(262_144);
  });

  it("liefert fuer gleiche Eingabe dieselbe Pruefsumme", async () => {
    const source = await sourceImage(400, 400);

    const first = await normalizeAvatarImage(source);
    const second = await normalizeAvatarImage(source);

    expect(first.checksum).toBe(second.checksum);
    expect(first.checksum).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("verwirft EXIF-Daten", async () => {
    // Ein Bild mit EXIF-Block rein; nach der Neukodierung darf keiner mehr
    // dranhaengen. Handyfotos tragen dort GPS-Koordinaten.
    const withExif = await sharp({
      create: { width: 400, height: 400, channels: 3, background: { r: 10, g: 10, b: 10 } },
    })
      .withExif({ IFD0: { Copyright: "Testaufnahme", Software: "Kamera" } })
      .jpeg()
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    const result = await normalizeAvatarImage(withExif);

    expect((await sharp(result.bytes).metadata()).exif).toBeUndefined();
  });

  it("wendet die EXIF-Orientierung an, bevor sie verworfen wird", async () => {
    // Reine Grössenprüfungen reichen hier nicht: das Ergebnis ist wegen
    // `fit: "cover"` immer 256x256, egal ob gedreht wurde oder nicht. Der
    // Beweis muss über die Bildinhalte laufen. Quelle: oben rot, unten blau,
    // mit Orientation 6 ("90° im Uhrzeigersinn"). Nach korrekter Drehung
    // liegt Rot rechts und Blau links; ohne Drehung vermischen sich beide
    // Bänder zu einem einheitlichen Grau-Violett in jeder Hälfte.
    const result = await normalizeAvatarImage(await orientedTwoToneImage());

    const left = await regionMeanColor(result.bytes, { left: 0, top: 0, width: 128, height: 256 });
    const right = await regionMeanColor(result.bytes, { left: 128, top: 0, width: 128, height: 256 });

    expect(left.b).toBeGreaterThan(150);
    expect(left.r).toBeLessThan(80);
    expect(right.r).toBeGreaterThan(150);
    expect(right.b).toBeLessThan(80);
  });

  it("lehnt Bytes ab, die kein Bild sind", async () => {
    await expect(normalizeAvatarImage(Buffer.from("kein Bild, nur Text"))).rejects.toMatchObject({
      code: "AVATAR_INVALID_IMAGE",
    });
  });

  it("wirft einen AvatarImageError, nicht den rohen Bibliotheksfehler", async () => {
    // Nach aussen geht nie eine Bibliotheksmeldung; der Fehlerfilter braucht
    // den eigenen Code.
    await expect(normalizeAvatarImage(Buffer.alloc(0))).rejects.toBeInstanceOf(AvatarImageError);
  });
});
