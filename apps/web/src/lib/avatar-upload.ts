/** Kantenlänge vor dem Upload — grösser als die gespeicherten 256 px, damit
 *  der Server aus genügend Bildinformation herunterrechnet. */
const uploadSize = 512;

export interface CropRegion {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

/** Der grösstmögliche mittige quadratische Ausschnitt. */
export function squareCrop(width: number, height: number): CropRegion {
  const size = Math.min(width, height);
  return { x: Math.round((width - size) / 2), y: Math.round((height - size) / 2), size };
}

/**
 * Verkleinert die gewählte Datei vor dem Upload. Ein Handyfoto von 4 MB geht
 * damit als etwa 40 KB über die Leitung und bleibt unter dem Körperlimit der
 * API — an einem Spielort mit schlechtem Empfang der Unterschied zwischen
 * „geht" und „geht nicht".
 *
 * Das ist Bequemlichkeit, KEINE Vertrauensgrenze: der Server dekodiert und
 * normalisiert unabhängig davon noch einmal selbst (siehe
 * `apps/api/src/players/avatar-image.ts`, `normalizeAvatarImage`). Diese
 * Funktion darf niemals als Ersatz für die serverseitige Prüfung
 * herhalten — auch nicht, wenn sie hier scheinbar zuverlässig arbeitet.
 */
export async function prepareAvatarUpload(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const crop = squareCrop(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = uploadSize;
    canvas.height = uploadSize;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Kein 2D-Kontext verfügbar.");
    context.drawImage(bitmap, crop.x, crop.y, crop.size, crop.size, 0, 0, uploadSize, uploadSize);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => { blob === null ? reject(new Error("Das Bild liess sich nicht umwandeln.")) : resolve(blob); },
        "image/webp",
        0.9,
      );
    });
  } finally {
    bitmap.close();
  }
}
