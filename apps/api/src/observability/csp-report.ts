/**
 * Laenge, auf die jedes uebernommene Textfeld gekuerzt wird. Der Inhalt einer
 * Verstoss-Meldung stammt aus einem fremden Browser und ist unbegrenzt lang
 * denkbar; fuer die Auswertung genuegt der Anfang.
 */
const MAX_FIELD_LENGTH = 300;

/**
 * Eine normalisierte Verstoss-Meldung. Bewusst schmal: die verletzte
 * Direktive, die blockierte Quelle und die Seite, auf der es passierte,
 * reichen, um zu entscheiden, ob die Policy erzwungen werden kann. Die
 * vollstaendige Policy und der Script-Ausschnitt bleiben aussen vor — sie
 * blaehen jede Zeile auf, und der Ausschnitt kann Seiteninhalt tragen.
 */
export interface CspViolation {
  readonly directive: string;
  readonly blockedUri: string;
  readonly documentUri: string;
  readonly sourceFile: string | null;
  readonly lineNumber: number | null;
  readonly disposition: string | null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, MAX_FIELD_LENGTH);
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Die alte Form von `report-uri`: ein Objekt mit dem Schluessel `csp-report`
 * und Feldnamen in Bindestrich-Schreibweise.
 */
function fromReportUri(payload: Record<string, unknown>): CspViolation | null {
  const report = record(payload["csp-report"]);
  if (report === null) return null;

  const directive =
    text(report["effective-directive"]) ?? text(report["violated-directive"]);
  const documentUri = text(report["document-uri"]);
  if (directive === null || documentUri === null) return null;

  return {
    directive,
    blockedUri: text(report["blocked-uri"]) ?? "unknown",
    documentUri,
    sourceFile: text(report["source-file"]),
    lineNumber: integer(report["line-number"]),
    disposition: text(report.disposition),
  };
}

/**
 * Die Reporting-API-Form von `report-to`: eine Liste von Umschlaegen, jeder
 * mit `type` und `body` in Binnenmajuskel-Schreibweise. Ein Stapel kann
 * Meldungen anderer Typen enthalten; die bleiben aussen vor.
 */
function fromReportingApi(entry: unknown): CspViolation | null {
  const envelope = record(entry);
  if (envelope === null || envelope.type !== "csp-violation") return null;
  const body = record(envelope.body);
  if (body === null) return null;

  const directive = text(body.effectiveDirective);
  const documentUri = text(body.documentURL) ?? text(envelope.url);
  if (directive === null || documentUri === null) return null;

  return {
    directive,
    blockedUri: text(body.blockedURL) ?? "unknown",
    documentUri,
    sourceFile: text(body.sourceFile),
    lineNumber: integer(body.lineNumber),
    disposition: text(body.disposition),
  };
}

/**
 * Normalisiert einen Meldungskoerper in null bis mehrere Verstoesse. Beide
 * Formen kommen vor: Chromium und Firefox senden fuer `report-uri` die alte
 * Form, fuer `report-to` die Reporting-API-Form, und ein Stapel der zweiten
 * Form traegt mehrere Meldungen auf einmal.
 *
 * Unverstaendliches ergibt eine leere Liste statt eines Fehlers: der
 * Endpunkt ist oeffentlich und soll auf Unsinn mit einer stillen
 * Bestaetigung antworten, nicht mit einer Fehlerseite, die zum Ausprobieren
 * einlaedt.
 */
export function normalizeCspReport(payload: unknown): readonly CspViolation[] {
  if (Array.isArray(payload)) {
    return payload
      .slice(0, 20)
      .map((entry) => fromReportingApi(entry))
      .filter((violation): violation is CspViolation => violation !== null);
  }

  const single = record(payload);
  if (single === null) return [];
  const legacy = fromReportUri(single);
  if (legacy !== null) return [legacy];
  const modern = fromReportingApi(single);
  return modern === null ? [] : [modern];
}
