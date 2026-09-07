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
 * Die Umleitung ist eine Bequemlichkeit fuer alte Adressen, kein Grund, die
 * Seite scheitern zu lassen: ein *geworfener* Fehler (Timeout, DNS-Ausfall,
 * abgebrochene Verbindung) faellt deshalb ebenso auf `null` zurueck wie eine
 * Non-2xx-Antwort. Ohne dieses `try`/`catch` riss ein solcher Fehler die
 * gesamte Server-Komponente mit -- ausgerechnet auf dem anonymen
 * Publikumsweg (Review-Befund, Fix-Runde 1).
 *
 * ENTFERNEN mit dem Uebergangsweg in der API: eigener PR, Ende Oktober 2026.
 */
export async function resolvePublicId(value: string): Promise<string | null> {
  try {
    const response = await fetch(
      `${publicEnvironment.NEXT_PUBLIC_API_URL}/public/tournaments/${value}/address`,
      { cache: "no-store" },
    );
    if (!response.ok) return null;
    const parsed = legacyAddressSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.publicId === value) return null;
    return parsed.data.publicId;
  } catch {
    return null;
  }
}
