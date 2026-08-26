import { z } from "zod";

import { apiErrorSchema } from "@darts-platform/schemas";

import { publicEnvironment } from "./environment";

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

function localizedMessage(code: string): string {
  const messages: Readonly<Record<string, string>> = {
    MATCH_VERSION_CONFLICT: "Der Matchzustand hat sich geändert. Synchronisiere mit dem Serverstand.",
    TOURNAMENT_VERSION_CONFLICT: "Der Turnierzustand hat sich geändert. Synchronisiere mit dem Serverstand.",
    BOARD_NOT_AVAILABLE: "Das gewählte Board ist nicht verfügbar.",
    BOARD_CONTROLLER_CONFLICT: "Ein anderes Gerät steuert dieses Board.",
    NOT_ACTIVE_PLAYER: "Die Aufnahme gehört nicht zum aktiven Spieler.",
    INVALID_VISIT_SCORE: "Dieser Score ist mit der gewählten Dartanzahl nicht möglich.",
    NOTHING_TO_UNDO: "Es gibt keine aktive Aufnahme zum Zurücknehmen.",
    UNAUTHORIZED: "Bitte melde dich an.",
    FORBIDDEN: "Dir fehlt die Berechtigung für diese Aktion.",
  };
  const translated = messages[code];
  if (translated !== undefined) return translated;
  return "Die Anfrage konnte nicht ausgeführt werden. Prüfe die Eingaben und versuche es erneut.";
}

export function userFacingErrorMessage(error: unknown, fallback = "Die Anfrage ist fehlgeschlagen."): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

export async function apiRequest<T>(input: {
  readonly path: string;
  readonly schema: z.ZodType<T>;
  readonly method?: "GET" | "POST" | "PATCH" | "DELETE";
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}): Promise<T> {
  const response = await fetch(
    `${publicEnvironment.NEXT_PUBLIC_API_URL}${input.path}`,
    {
      method: input.method ?? "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(input.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      signal: input.signal ?? null,
    },
  );

  const payload: unknown = await response.json();

  if (!response.ok) {
    const error = apiErrorSchema.safeParse(payload);
    if (error.success) {
      throw new ApiClientError(
        localizedMessage(error.data.error.code),
        error.data.error.code,
        error.data.error.correlationId,
        error.data.error.details,
      );
    }
    throw new ApiClientError(`Die API hat mit HTTP ${response.status} geantwortet.`);
  }

  return input.schema.parse(payload);
}
