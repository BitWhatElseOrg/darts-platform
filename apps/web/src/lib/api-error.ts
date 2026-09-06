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
  /**
   * HTTP-Status der Antwort, `null` wenn er nicht bekannt ist.
   *
   * Der Fehlercode allein sagt nicht, ob der Server geurteilt hat: der
   * API-Filter vergibt auch fuer 500/502/503 einen Code
   * (`errorCodes[status] ?? "INTERNAL_ERROR"`). Nur mit dem Status laesst
   * sich ein fachliches Urteil (4xx) von einer voruebergehenden Stoerung
   * unterscheiden — siehe `offline-replay.ts`, `replayFailure`.
   */
  public readonly status: number | null;

  public constructor(
    message: string,
    code = "REQUEST_FAILED",
    correlationId: string | null = null,
    details?: unknown,
    status: number | null = null,
  ) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.correlationId = correlationId;
    this.details = details;
    this.status = status;
  }
}
