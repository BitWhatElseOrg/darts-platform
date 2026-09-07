import { z } from "zod";

import { publicEnvironment } from "@/lib/environment";

const legacyAddressSchema = z.object({ publicId: z.uuid() });

/**
 * Uebergangsweg: Adressen, die vor der Umstellung auf oeffentliche IDs
 * geteilt wurden, tragen die interne Turnier-ID. Sie treffen auf das
 * `[publicId]`-Segment unter `/live` und wuerden ohne diesen Umweg in eine
 * 404 laufen. `/address` antwortet fuer eine echte `public_id` selbst mit
 * 404 (es sucht ueber die interne ID) -- der Normalfall ist deshalb ein
 * fehlgeschlagener Aufruf, und nur der Fehlerpfad zahlt die zusaetzliche
 * Rundreise.
 *
 * Liefert die aufgeloeste `publicId`, wenn `value` eine interne ID eines
 * OEFFENTLICHEN Turniers war, sonst `null` -- auch dann, wenn die Antwort
 * zufaellig dieselbe ID nennt (der Sonderfall, dass Wert und Aufloesung
 * zusammenfallen).
 *
 * ENTFERNEN mit dem Uebergangsweg in der API: eigener PR, Ende Oktober 2026.
 */
export async function resolvePublicId(value: string): Promise<string | null> {
  const response = await fetch(
    `${publicEnvironment.NEXT_PUBLIC_API_URL}/public/tournaments/${value}/address`,
    { cache: "no-store" },
  );
  if (!response.ok) return null;
  const parsed = legacyAddressSchema.safeParse(await response.json());
  if (!parsed.success || parsed.data.publicId === value) return null;
  return parsed.data.publicId;
}
