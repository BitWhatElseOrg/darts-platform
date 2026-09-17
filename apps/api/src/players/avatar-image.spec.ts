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
