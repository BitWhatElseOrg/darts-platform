import { eq } from "drizzle-orm";

import { encounterCommands } from "@darts-platform/database";

import type { DatabaseService } from "../database/database.service.js";

type DatabaseTransaction = Parameters<
  Parameters<DatabaseService["database"]["transaction"]>[0]
>[0];

/**
 * Die gespeicherte Nutzlast kommt als `jsonb` zurück: Postgres normalisiert
 * dabei die Schlüsselreihenfolge, die Wiederholung des Clients tut das nicht.
 * Verglichen wird deshalb über eine kanonische Form, nicht über
 * `JSON.stringify` der beiden Seiten.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function isSameCommandPayload(stored: unknown, incoming: unknown): boolean {
  return JSON.stringify(canonicalize(stored)) === JSON.stringify(canonicalize(incoming));
}

/**
 * Der Primaerschluessel von `encounter_commands` ist die letzte Instanz gegen
 * eine doppelt vergebene `commandId`. Postgres meldet den Verstoss als 23505.
 */
export function isDuplicateEncounterCommandIdError(error: unknown): boolean {
  // Drizzle verpackt den Treiberfehler; die Kennung steht erst in `cause`.
  for (let candidate = error, depth = 0; depth < 5; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) return false;
    const row = candidate as {
      readonly code?: unknown;
      readonly constraint_name?: unknown;
      readonly cause?: unknown;
    };
    if (row.code === "23505" && row.constraint_name === "encounter_commands_pkey") return true;
    candidate = row.cause;
  }
  return false;
}

/**
 * Liefert die Antwort auf eine bereits vergebene `commandId`: `ok` fuer die
 * Wiederholung desselben Kommandos, `command-id-reused`, wenn Typ, Umfang
 * oder Nutzlast abweichen. Eine andere Mutation still als `ok` zu
 * quittieren hiesse, dem Aufrufer einen Vorgang zu bestaetigen, der nie
 * stattgefunden hat.
 *
 * Gemeinsam fuer alle Begegnungskommandos: die des
 * `EncountersRepository` und die Resultatkorrektur im `MatchesRepository`.
 */
export async function findDuplicateEncounterCommand(
  transaction: DatabaseTransaction,
  input: { readonly organizationId: string; readonly encounterId: string },
  payload: { readonly commandId: string },
  type: string,
): Promise<"ok" | "command-id-reused" | null> {
  const [duplicate] = await transaction
    .select({
      organizationId: encounterCommands.organizationId,
      encounterId: encounterCommands.encounterId,
      type: encounterCommands.type,
      payload: encounterCommands.payload,
    })
    .from(encounterCommands)
    .where(eq(encounterCommands.commandId, payload.commandId))
    .limit(1);
  if (duplicate === undefined) return null;
  return duplicate.organizationId === input.organizationId &&
    duplicate.encounterId === input.encounterId &&
    duplicate.type === type &&
    isSameCommandPayload(duplicate.payload, payload)
    ? "ok"
    : "command-id-reused";
}
