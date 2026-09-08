import { Inject, Injectable } from "@nestjs/common";
import type { IncomingHttpHeaders } from "node:http";

import { decideSubscription, type SubscriptionDecision } from "@darts-platform/domain";

import { AuthService } from "../auth/auth.service.js";
import { EncountersRepository } from "../encounters/encounters.repository.js";
import { OrganizationsRepository } from "../organizations/organizations.repository.js";
import { DisplayKeysService } from "../tournaments/display-keys.service.js";
import { TournamentsRepository } from "../tournaments/tournaments.repository.js";

/**
 * Beschafft, was `decideSubscription` braucht, und entscheidet nichts selbst.
 * Die Trennung ist Absicht: die Regel ist ohne Datenbank pruefbar, das
 * Beschaffen ohne Regel austauschbar.
 *
 * Die Sitzung kommt aus dem Cookie des Handshakes — der Socket verbindet mit
 * `withCredentials`, das Cookie liegt also an. `AuthService.getSession` nimmt
 * rohe Node-Header entgegen, und genau die liefert `socket.handshake.headers`.
 */
@Injectable()
export class SubscriptionAuthorization {
  public constructor(
    @Inject(TournamentsRepository) private readonly tournaments: TournamentsRepository,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(OrganizationsRepository) private readonly organizations: OrganizationsRepository,
    @Inject(DisplayKeysService) private readonly displayKeys: DisplayKeysService,
    @Inject(EncountersRepository) private readonly encounters: EncountersRepository,
  ) {}

  public async authorizeTournament(input: {
    readonly publicId: string;
    readonly headers: IncomingHttpHeaders;
    readonly displayKeySecret: string | undefined;
  }): Promise<SubscriptionDecision> {
    const tournament = await this.tournaments.getAccessFactsByPublicId(input.publicId);
    if (tournament === null) {
      return decideSubscription({
        target: "unknown",
        visibility: "PRIVATE",
        membership: "none",
        displayKey: "absent",
      });
    }

    // Nur beschaffen, was die Entscheidung noch braucht: ein oeffentliches
    // Turnier kostet damit weder eine Sitzungsaufloesung noch einen
    // Schluesselnachschlag.
    if (tournament.visibility === "PUBLIC") {
      return decideSubscription({
        target: "known",
        visibility: "PUBLIC",
        membership: "none",
        displayKey: "absent",
      });
    }

    const session = await this.auth.getSession(input.headers);
    const membership =
      session === null
        ? "none"
        : await this.organizations
            .getActiveMembership({
              organizationId: tournament.organizationId,
              userId: session.user.id,
            })
            .then((row) => (row === null ? "none" : "member"));

    const displayKey =
      input.displayKeySecret === undefined
        ? "absent"
        : await this.displayKeys.stateOf(tournament.id, input.displayKeySecret);

    return decideSubscription({
      target: "known",
      visibility: tournament.visibility,
      membership,
      displayKey,
    });
  }

  /**
   * Schwester von `authorizeTournament`, aber ohne Sichtbarkeit: Begegnungen
   * tragen keine `visibility`-Spalte, weil die Liga per Reglement oeffentlich
   * ist. Eine bekannte Begegnung ist damit unbedingt oeffentlich; einzig die
   * Unterscheidung bekannt/unbekannt bleibt zu treffen.
   *
   * `getPublicData` dient hier ausschliesslich als Existenzpruefung — dieselbe
   * Methode, die auch die oeffentliche Begegnungsroute nutzt. Eine eigene,
   * schlankere Repository-Methode nur fuer diese Pruefung lohnt sich nicht:
   * eine Zeile je Socket-Verbindung, nicht je Ereignis.
   */
  public async authorizeEncounter(input: {
    readonly publicId: string;
  }): Promise<SubscriptionDecision> {
    const encounter = await this.encounters.getPublicData(input.publicId);
    return decideSubscription({
      target: encounter === null ? "unknown" : "known",
      visibility: "PUBLIC",
      membership: "none",
      displayKey: "absent",
    });
  }
}
