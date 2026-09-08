import type { DisplayKeyState } from "./display-key-state";
import type { TournamentVisibility } from "./tournament-visibility";

export interface SubscriptionInput {
  /** Ob die oeffentliche Adresse ueberhaupt zu etwas gehoert. */
  readonly target: "known" | "unknown";
  readonly visibility: TournamentVisibility;
  readonly membership: "member" | "none";
  readonly displayKey: DisplayKeyState | "absent";
}

export type SubscriptionDecision =
  | { readonly kind: "allow" }
  | {
      readonly kind: "deny";
      readonly reason: "SUBSCRIPTION_FORBIDDEN" | "SUBSCRIPTION_UNKNOWN_ROOM";
    };

/**
 * Wer darf welchen Raum hoeren. Drei Eintrittskarten, alternativ zueinander:
 * das Turnier ist freigegeben, der Horchende ist Mitglied der Organisation,
 * oder er bringt einen gueltigen Anzeige-Schluessel mit.
 *
 * Ohne Datenbank und ohne Socket.IO — dieselbe Trennung wie in
 * `event-routing.ts`. Der Aufrufer beschafft die vier Angaben, diese Funktion
 * entscheidet, und die Entscheidung ist damit ohne Infrastruktur pruefbar.
 */
export function decideSubscription(input: SubscriptionInput): SubscriptionDecision {
  if (input.target === "unknown") {
    return { kind: "deny", reason: "SUBSCRIPTION_UNKNOWN_ROOM" };
  }
  if (input.visibility === "PUBLIC") return { kind: "allow" };
  if (input.membership === "member") return { kind: "allow" };
  if (input.displayKey === "valid") return { kind: "allow" };
  return { kind: "deny", reason: "SUBSCRIPTION_FORBIDDEN" };
}
