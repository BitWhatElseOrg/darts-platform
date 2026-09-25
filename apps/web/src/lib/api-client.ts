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
    BOARD_NAME_TAKEN: "Ein Board mit diesem Namen gibt es bereits.",
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
    NOMINATION_PLAYER_ON_BOTH_SIDES:
      "Diese Person ist bereits für die Gegenseite gemeldet und kann in einer Begegnung nur für eine Mannschaft spielen.",
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
    RATE_LIMIT_EXCEEDED:
      "Zu viele Anfragen in kurzer Zeit. Warte eine Minute und versuche es erneut.",
    SELF_SERVICE_ORGANIZATIONS_DISABLED:
      "Neue Organisationen werden vom Betrieb angelegt. Wende dich an die Plattformverwaltung.",
    COMMAND_ID_ALREADY_USED: "Dieser Befehl wurde bereits ausgeführt.",
    TEAM_PLAYER_ALREADY_MEMBER: "Diese Person gehört bereits zum Kader.",
    TEAM_CAPTAIN_TAKEN:
      "Diese Mannschaft führt bereits einen Captain. Nimm die Person als Spielerin oder Spieler auf.",
    LAST_OWNER_PROTECTED:
      "Die letzte Eigentümerin oder der letzte Eigentümer kann weder herabgestuft noch deaktiviert werden. Ernenne zuerst eine zweite Person.",
    OWNER_CHANGE_REQUIRES_OWNER:
      "Nur eine aktive Eigentümerin oder ein aktiver Eigentümer kann eine Eigentümer-Mitgliedschaft ändern.",
    OWNER_GRANT_REQUIRES_OWNER:
      "Nur eine aktive Eigentümerin oder ein aktiver Eigentümer kann Eigentum übertragen.",
    SELF_MEMBERSHIP_CHANGE_FORBIDDEN:
      "Die eigene Mitgliedschaft ändert eine andere verwaltende Person.",
    AVATAR_INVALID_IMAGE: "Diese Datei liess sich nicht als Bild lesen. Wähle ein JPEG, PNG oder WebP.",
    AVATAR_TOO_LARGE: "Das Bild ist zu gross. Wähle ein kleineres Bild.",
    INVITATION_NOT_OPEN: "Diese Einladung ist nicht mehr offen. Erstelle bei Bedarf eine neue.",
    INVITATION_NOT_FOUND: "Diese Einladung ist ungültig oder abgelaufen.",
    INVITATION_RESEND_TOO_SOON:
      "Diese Einladung wurde gerade erst erneut gesendet. Warte eine Minute, bevor du es nochmals versuchst.",
    PLAYER_HAS_HISTORY:
      "Dieser Spieler hat bereits gespielt oder steht in einem Turnier, Team oder einer Begegnung. Er lässt sich nur archivieren.",
    ORGANIZATION_NAME_MISMATCH: "Der eingegebene Name stimmt nicht mit dem Namen der Organisation überein.",
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
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly body?: unknown;
  /**
   * Roher Binärkörper (z. B. ein Bild-`Blob`) statt eines JSON-Körpers. Der
   * `Content-Type`-Header kommt vom `Blob` selbst — der Avatar-Endpunkt
   * erwartet `image/*`, kein JSON (siehe `PUT .../players/:playerId/avatar`).
   * Schliesst sich mit `body` aus.
   */
  readonly rawBody?: Blob;
  readonly signal?: AbortSignal;
}): Promise<T> {
  const response = await fetch(
    `${publicEnvironment.NEXT_PUBLIC_API_URL}${input.path}`,
    {
      method: input.method ?? "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(input.rawBody !== undefined
          ? { "Content-Type": input.rawBody.type }
          : input.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
      },
      ...(input.rawBody !== undefined
        ? { body: input.rawBody }
        : input.body === undefined
          ? {}
          : { body: JSON.stringify(input.body) }),
      signal: input.signal ?? null,
    },
  );

  // Erst der Status, dann der Koerper. Vorher lief `await response.json()` VOR
  // der `ok`-Pruefung: eine 4xx-Antwort mit einem Koerper, der kein JSON ist --
  // eine Fehlerseite des Proxys, ein leerer 403 --, warf einen `SyntaxError`,
  // und der Status wurde nie gelesen. Die Wiedergabe der Offline-Warteschlange
  // sah darin einen Netzwerkfehler (`replayFailure` -> RETRY) und wiederholte
  // ein Kommando endlos, das der Server bereits abgelehnt hatte.
  const raw = await response.text();

  if (!response.ok) {
    const payload = parseJson(raw);
    const parsed = payload === undefined ? null : apiErrorSchema.safeParse(payload);
    if (parsed !== null && parsed.success) {
      throw new ApiClientError(
        localizedMessage(parsed.data.error.code),
        parsed.data.error.code,
        parsed.data.error.correlationId,
        parsed.data.error.details,
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

  // Ein leerer Koerper ist auf dem Erfolgspfad kein Vertragsbruch: ein
  // `HttpCode(204)` (etwa das Widerrufen eines Anzeige-Schluessels, Task 6)
  // antwortet planmaessig ohne Koerper, und `JSON.parse("")` wirft. Nur ein
  // NICHT-leerer, aber unlesbarer Koerper bleibt ein echter `SyntaxError` --
  // anders als im Fehlerpfad oben schluckt hier nichts eine tatsaechlich
  // kaputte Antwort.
  return input.schema.parse(raw.trim() === "" ? undefined : JSON.parse(raw));
}

/**
 * Liest einen Antwortkoerper als JSON. `undefined`, wenn er keins ist -- leer,
 * HTML, Klartext. Nur der FEHLERPFAD ist tolerant: auf dem Erfolgspfad bleibt
 * ein unlesbarer Koerper ein `SyntaxError` wie bisher, denn dort ist er ein
 * echter Vertragsbruch und darf nicht als Serverurteil (`ApiClientError` mit
 * 2xx) durch die Wiedergabe laufen.
 */
function parseJson(raw: string): unknown {
  if (raw.trim() === "") return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}
