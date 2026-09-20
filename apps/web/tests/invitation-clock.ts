import { and, eq } from "drizzle-orm";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { createDatabaseConnection, organizationInvitations } from "@darts-platform/database";

/**
 * Datiert `updated_at` der offenen Einladung einer Adresse zurueck.
 *
 * Das erneute Senden ist erst 60 Sekunden nach der letzten Rotation erlaubt
 * (Sperre gegen Doppelklick und Retry). Ein Browsertest kann nicht so lange
 * warten, und die Uhr des Servers laesst sich von aussen nicht stellen —
 * also wird die Einladung selbst aelter gemacht.
 */
export async function backdateInvitationUpdatedAt(
  email: string,
  seconds: number,
): Promise<void> {
  const environment = parseApplicationEnvironment(process.env);
  const connection = createDatabaseConnection(environment.DATABASE_URL);
  try {
    const updated = await connection.database
      .update(organizationInvitations)
      .set({ updatedAt: new Date(Date.now() - seconds * 1_000) })
      .where(
        and(
          eq(organizationInvitations.email, email.trim().toLowerCase()),
          eq(organizationInvitations.status, "PENDING"),
        ),
      )
      .returning({ id: organizationInvitations.id });
    if (updated.length === 0) throw new Error(`Keine offene Einladung fuer ${email}.`);
  } finally {
    await connection.close();
  }
}
