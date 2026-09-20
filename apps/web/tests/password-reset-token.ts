import { and, desc, eq, like } from "drizzle-orm";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { createDatabaseConnection, users, verifications } from "@darts-platform/database";

/**
 * Liest das juengste Reset-Token eines Kontos direkt aus Better Auths
 * `verifications`-Tabelle (`identifier = reset-password:<token>`, `value =
 * userId`). Unabhaengig vom Mailversand: der Link in der Mail traegt genau
 * dieses Token.
 */
export async function readLatestPasswordResetToken(email: string): Promise<string> {
  const environment = parseApplicationEnvironment(process.env);
  const connection = createDatabaseConnection(environment.DATABASE_URL);
  try {
    const [user] = await connection.database
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email.trim().toLowerCase()));
    if (user === undefined) throw new Error(`Kein Konto fuer ${email}.`);
    const [row] = await connection.database
      .select({ identifier: verifications.identifier })
      .from(verifications)
      .where(and(eq(verifications.value, user.id), like(verifications.identifier, "reset-password:%")))
      .orderBy(desc(verifications.createdAt))
      .limit(1);
    if (row === undefined) throw new Error(`Kein Reset-Token fuer ${email}.`);
    return row.identifier.slice("reset-password:".length);
  } finally {
    await connection.close();
  }
}
