import { BadRequestException } from "@nestjs/common";
import { z } from "zod";

/**
 * Gegenstueck zu `parseBody` fuer Query-Parameter: eigener Fehlercode
 * `INVALID_QUERY`, und die Meldung nennt den Parameter statt «body».
 */
export function parseQuery<T>(schema: z.ZodType<T>, value: unknown, name = "query"): T {
  const result = schema.safeParse(value);

  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${[name, ...issue.path.map(String)].join(".")}: ${issue.message}`)
      .join("; ");
    throw new BadRequestException({ code: "INVALID_QUERY", message });
  }

  return result.data;
}
