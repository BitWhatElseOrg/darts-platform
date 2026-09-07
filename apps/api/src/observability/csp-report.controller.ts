import { Body, Controller, HttpCode, HttpStatus, Logger, Post } from "@nestjs/common";

import { Public } from "../auth/public.decorator.js";
import { normalizeCspReport } from "./csp-report.js";

/**
 * Nimmt die Verstoss-Meldungen der Content-Security-Policy entgegen. Ohne
 * diesen Endpunkt liefen die Meldungen der Report-Only-Policy ins Leere und
 * die Umstellung auf erzwingend liesse sich nur raten
 * (`apps/web/next.config.ts`, Umstellungskriterium M5).
 *
 * Oeffentlich und ohne Anmeldung: Der Browser sendet die Meldung ohne
 * Zugangsdaten, und zwar auch von einer Seite, auf der niemand angemeldet
 * ist. Geantwortet wird immer 204 — auch auf Unsinn: der Endpunkt soll nicht
 * zum Ausprobieren einladen, und ein Browser kann mit einer Fehlerseite
 * ohnehin nichts anfangen.
 *
 * Die Meldungen sind unvertrauter Fremdinhalt. `normalizeCspReport` uebernimmt
 * nur eine schmale Auswahl an Feldern, gekuerzt; die vollstaendige Policy und
 * der Script-Ausschnitt bleiben aussen vor.
 */
@Controller("csp-reports")
@Public()
export class CspReportController {
  private readonly logger = new Logger("CspReport");

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  public report(@Body() body: unknown): void {
    for (const violation of normalizeCspReport(body)) {
      this.logger.warn({ event: "csp.violation", ...violation });
    }
  }
}
