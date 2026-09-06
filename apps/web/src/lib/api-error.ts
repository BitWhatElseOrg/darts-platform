/**
 * Fehler einer API-Antwort mit Fehlercode aus dem einheitlichen Fehlerformat
 * (`apiErrorSchema`). Bewusst ein eigenes Modul: `api-client.ts` liest beim
 * Import die oeffentliche Client-Umgebung (`NEXT_PUBLIC_API_URL`), reine
 * Regeln ueber Fehlercodes sollen davon aber unabhaengig testbar bleiben.
 */
export class ApiClientError extends Error {
  public readonly code: string;
  public readonly correlationId: string | null;
  public readonly details: unknown;

  public constructor(
    message: string,
    code = "REQUEST_FAILED",
    correlationId: string | null = null,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.correlationId = correlationId;
    this.details = details;
  }
}
