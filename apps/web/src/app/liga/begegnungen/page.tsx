import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * `/liga/begegnungen` trägt keine eigene Ansicht: eine Begegnung wird immer
 * mit ihrer Kennung geöffnet. Ohne diese Seite fiele die Adresse auf
 * `/liga/[id]` zurück und fragte einen Wettbewerb namens „begegnungen" ab.
 */
export default function EncounterIndexPage(): never {
  notFound();
}
