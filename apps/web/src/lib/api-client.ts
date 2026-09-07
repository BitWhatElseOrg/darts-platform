import { z } from "zod";

import { apiErrorSchema } from "@darts-platform/schemas";

import { ApiClientError, UserFacingError } from "./api-error";

import { publicEnvironment } from "./environment";

// Die Fehlerklasse liegt in einem eigenen Modul, damit reine Regeln (z. B.
// `offline-replay.ts`) sie pruefen koennen, ohne die Client-Umgebung zu
// laden. Fuer aufrufende Stellen bleibt sie hier importierbar.
export { ApiClientError };

function localizedMessage(code: string): string {
  const messages: Readonly<Record<string, string>> = {
    MATCH_VERSION_CONFLICT: "Der Matchzustand hat sich geändert. Synchronisiere mit dem Serverstand.",
    TOURNAMENT_VERSION_CONFLICT: "Der Turnierzustand hat sich geändert. Synchronisiere mit dem Serverstand.",
    BOARD_NOT_AVAILABLE: "Das gewählte Board ist nicht verfügbar.",
    BOARD_CONTROLLER_CONFLICT: "Ein anderes Gerät steuert dieses Board.",
    NOT_ACTIVE_PLAYER: "Die Aufnahme gehört nicht zum aktiven Spieler.",
    INVALID_VISIT_SCORE: "Dieser Score ist mit der gewählten Dartanzahl nicht möglich.",
    DARTS_REQUIRED_FOR_DOUBLE_IN:
      "Unter Double In wird die Eröffnungsaufnahme Wurf für Wurf erfasst.",
    CHECKOUT_DETAIL_REQUIRED:
      "Unter Master Out braucht der Abschluss das getroffene Feld oder die Meldung, dass keins sass.",
    NOTHING_TO_UNDO: "Es gibt keine aktive Aufnahme zum Zurücknehmen.",
    UNAUTHORIZED: "Bitte melde dich an.",
    FORBIDDEN: "Dir fehlt die Berechtigung für diese Aktion.",
    ENCOUNTER_VERSION_CONFLICT:
      "Der Zustand der Begegnung hat sich geändert. Übernimm den Serverstand.",
    COMPETITION_VERSION_CONFLICT:
      "Der Wettbewerb hat sich geändert. Lade ihn neu und versuche es erneut.",
    COMPETITION_SLUG_TAKEN: "Diesen Kurznamen gibt es in der Organisation bereits.",
    COMPETITION_TEMPLATE_LOCKED:
      "Die Vorlage ist gesperrt, sobald eine Begegnung angesetzt ist.",
    NOMINATION_INCOMPLETE: "Die Meldung ist unvollständig.",
    NOMINATION_DUPLICATE_PLAYER: "Diese Person ist zweimal gemeldet.",
    NOMINATION_PLAYER_NOT_IN_SQUAD:
      "Diese Person gehört nicht zum Kader. Melde sie als Aushilfe.",
    DOUBLES_PAIRING_INCOMPLETE: "Ein Doppel braucht genau zwei gemeldete Personen je Seite.",
    DOUBLES_PLAYER_LIMIT_EXCEEDED:
      "Diese Person spielt bereits ein reguläres Doppel dieser Begegnung.",
    SUBSTITUTION_LIMIT_EXCEEDED: "Das Auswechselkontingent dieser Begegnung ist erschöpft.",
    SUBSTITUTION_PLAYER_BLOCKED:
      "Diese Auswechslung ist nicht zulässig. Eine ausgewechselte Person bleibt für die Einzel gesperrt.",
    SUBSTITUTION_SLOT_RUNNING: "Während einer laufenden Paarung wird nicht gewechselt.",
    TEMPLATE_INVALID: "Die Begegnungsvorlage ist widersprüchlich.",
    TEMPLATE_ROUND_ROBIN_INCOMPLETE:
      "Die Einzel bilden kein vollständiges Rundenturnier über alle Aufstellungspositionen.",
    LEAGUE_VALIDATION_ERROR: "Die Eingabe verletzt eine Ligaregel.",
    ENCOUNTER_CLOSED: "Die Begegnung ist beendet oder abgebrochen.",
    ENCOUNTER_STATUS_INVALID: "Der Zustand der Begegnung lässt diesen Schritt nicht zu.",
    ENCOUNTER_SLOT_NOT_READY: "Dieses Spiel ist noch nicht bereit.",
    ENCOUNTER_SLOT_RUNNING: "Dieses Spiel läuft bereits.",
    BOARD_UNAVAILABLE: "Das gewählte Board ist belegt.",
    PLAYER_BUSY: "Mindestens eine Person spielt bereits an einem anderen Board.",
    COMMAND_ID_ALREADY_USED: "Dieser Befehl wurde bereits ausgeführt.",
    TEAM_PLAYER_ALREADY_MEMBER: "Diese Person gehört bereits zum Kader.",
    TEAM_CAPTAIN_TAKEN:
      "Diese Mannschaft führt bereits einen Captain. Nimm die Person als Spielerin oder Spieler auf.",
  };
  const translated = messages[code];
  if (translated !== undefined) return translated;
  return "Die Anfrage konnte nicht ausgeführt werden. Prüfe die Eingaben und versuche es erneut.";
}

export function userFacingErrorMessage(error: unknown, fallback = "Die Anfrage ist fehlgeschlagen."): string {
  // `UserFacingError` traegt eine bereits fertig formulierte Meldung -- etwa
  // fuer ein rein lokales Problem, fuer das der Uebertragungs-Fallback falsch
  // waere (siehe `api-error.ts`).
  return error instanceof ApiClientError || error instanceof UserFacingError ? error.message : fallback;
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
        response.status,
      );
    }
    throw new ApiClientError(
      `Die API hat mit HTTP ${response.status} geantwortet.`,
      "REQUEST_FAILED",
      null,
      undefined,
      response.status,
    );
  }

  return input.schema.parse(payload);
}
