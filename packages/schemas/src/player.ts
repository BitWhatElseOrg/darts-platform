import { z } from "zod";

export const playerStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);

/**
 * Ein wirklich optionales Textfeld: fehlend, `null` und der Leerstring
 * bedeuten dasselbe. Formulare schicken fuer ein angetipptes und wieder
 * geleertes Feld `""`; das darf das Anlegen nicht blockieren, sondern
 * heisst "nicht angegeben".
 */
const optionalTrimmedString = (maximumLength: number) =>
  z
    .string()
    .trim()
    .max(maximumLength)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional();

export const createPlayerSchema = z.object({
  firstName: optionalTrimmedString(100),
  lastName: optionalTrimmedString(100),
  displayName: z.string().trim().min(1).max(255),
  nickname: optionalTrimmedString(100),
  email: z.email().trim().toLowerCase().nullable().optional(),
  externalReference: optionalTrimmedString(255),
  status: playerStatusSchema.default("ACTIVE"),
});

/**
 * Wie `createPlayerSchema`, aber ohne den Status-Default: `.partial()` allein
 * wuerde `status.default("ACTIVE")` aus dem Basisschema weiterhin auf jedes
 * Update anwenden und so einen archivierten Spieler bei jeder Bearbeitung
 * ohne Statusfeld (z. B. `PlayerEditDialog`) stillschweigend reaktivieren.
 * Der Status wird darum aus dem Basisschema entfernt und ohne Default wieder
 * angehaengt, bevor `.partial()` greift.
 */
export const updatePlayerSchema = createPlayerSchema
  .omit({ status: true })
  .extend({ status: playerStatusSchema.optional() })
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one player field must be provided.",
  );

export const playerSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  publicId: z.uuid(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  displayName: z.string(),
  nickname: z.string().nullable(),
  email: z.string().nullable(),
  externalReference: z.string().nullable(),
  status: playerStatusSchema,
  /**
   * Ob dem Spieler ein Konto zugeordnet ist. Bewusst ein Wahrheitswert und
   * nicht die `userId` oder die Kontoadresse: `player:read` haben auch
   * MEMBER und VIEWER, und ueber die Spielerliste sollen keine Angaben
   * abfliessen, die hinter `organization:manage_members` liegen (ADR 0015).
   */
  hasAccount: z.boolean(),
  /**
   * Die Prüfsumme des gespeicherten Profilbildes, oder `null`. Die Fläche
   * weiss damit ohne Zusatzabfrage, ob es ein Bild gibt, und hängt den Wert
   * als `?v=` an die Bildadresse — eine Änderung bricht den Cache von selbst.
   */
  avatarChecksum: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const playerListSchema = z.array(playerSchema);

export type CreatePlayerInput = z.infer<typeof createPlayerSchema>;
export type UpdatePlayerInput = z.infer<typeof updatePlayerSchema>;
export type PlayerResponse = z.infer<typeof playerSchema>;
