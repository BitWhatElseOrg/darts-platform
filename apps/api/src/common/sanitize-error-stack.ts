/**
 * Schneidet Bind-Parameter aus einem Fehler-Stack.
 *
 * `DrizzleQueryError.message` lautet `Failed query: <sql>\nparams: <werte>`
 * (`drizzle-orm/errors`), und der Stack traegt diese Meldung in seinen ersten
 * Zeilen mit. Ohne den Schnitt stuenden die gebundenen Werte im 5xx-Log —
 * beim Einladungs-Insert also der Klartext-Einladungslink, beim
 * Passwort-Reset der Reset-Link.
 *
 * Bewusst zeilenweise und nur auf `params:`: SQL, Rahmen und Ursachenkette
 * bleiben unveraendert und damit zur Fehlersuche brauchbar.
 */
export function sanitizeErrorStack(stack: string | undefined): string | undefined {
  if (stack === undefined) return undefined;
  return stack
    .split("\n")
    .map((line) => line.replace(/^(\s*)params:.*$/u, "$1params: <redigiert>"))
    .join("\n");
}
