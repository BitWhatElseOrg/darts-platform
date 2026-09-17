import { createHash } from "node:crypto";

import sharp from "sharp";

/** Kantenlänge des gespeicherten Bildes. */
const avatarSize = 256;
/** Obergrenze gegen Dekompressionsbomben, zusätzlich zur Bytegrenze. */
const maximumInputPixels = 50_000_000;

export class AvatarImageError extends Error {
  public constructor(
    public readonly code: "AVATAR_INVALID_IMAGE",
    message: string,
  ) {
    super(message);
    this.name = "AvatarImageError";
  }
}

export interface NormalizedAvatar {
  readonly bytes: Buffer;
  readonly contentType: "image/webp";
  readonly checksum: string;
  readonly byteSize: number;
}

/**
 * Aus beliebigen Bytes wird ein vom Server erzeugtes Bild — oder ein Fehler.
 *
 * Gespeichert wird nie die gelieferte Datei, sondern immer das Ergebnis
 * dieser Funktion. Daraus folgen drei Eigenschaften, die nicht Nebeneffekt,
 * sondern Zweck sind: was sich nicht dekodieren lässt, kommt gar nicht erst
 * in die Datenbank; EXIF-Daten mit GPS-Koordinaten und Gerätekennungen
 * überleben die Neukodierung nicht; und die Grösse ist vorhersagbar.
 *
 * `rotate()` ohne Argument wendet die EXIF-Orientierung an, BEVOR sie
 * verworfen wird — sonst läge ein Hochformatfoto danach quer.
 */
export async function normalizeAvatarImage(input: Buffer): Promise<NormalizedAvatar> {
  try {
    const bytes = await sharp(input, { limitInputPixels: maximumInputPixels, animated: false })
      .rotate()
      .resize(avatarSize, avatarSize, { fit: "cover", position: "centre" })
      .webp({ quality: 80 })
      .toBuffer();
    return {
      bytes,
      contentType: "image/webp",
      checksum: createHash("sha256").update(bytes).digest("hex"),
      byteSize: bytes.byteLength,
    };
  } catch (error: unknown) {
    throw new AvatarImageError(
      "AVATAR_INVALID_IMAGE",
      `Die Datei liess sich nicht als Bild lesen: ${error instanceof Error ? error.message : "unbekannter Fehler"}`,
    );
  }
}
