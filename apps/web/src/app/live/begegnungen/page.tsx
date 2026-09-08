import { notFound } from "next/navigation";

/**
 * Wie unter `/liga/begegnungen`: ohne öffentliche Kennung gibt es nichts zu
 * zeigen, und die Adresse darf nicht auf die Turnier-Live-Ansicht fallen.
 */
export default function PublicEncounterIndexPage(): never {
  notFound();
}
