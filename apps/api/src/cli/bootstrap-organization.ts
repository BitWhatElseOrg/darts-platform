import { parseArgs } from "node:util";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { createDatabaseConnection } from "@darts-platform/database";
import { bootstrapOrganizationSchema } from "@darts-platform/schemas";

import {
  assertNoExistingOrganization,
  createBootstrapOrganization,
  OrganizationAlreadyExistsError,
} from "./bootstrap-organization.service.js";

const USAGE = `Usage: node apps/api/dist/cli/bootstrap-organization.js \\
  --name "Dart Ost" --slug "dart-ost" --email "admin@example.test" \\
  [--timezone Europe/Zurich] [--locale de-CH] [--expires-in-days 7]`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      slug: { type: "string" },
      email: { type: "string" },
      timezone: { type: "string" },
      locale: { type: "string" },
      "expires-in-days": { type: "string" },
    },
    strict: true,
  });

  const expiresInDays = values["expires-in-days"];

  const parsed = bootstrapOrganizationSchema.safeParse({
    name: values.name,
    slug: values.slug,
    email: values.email,
    ...(values.timezone === undefined ? {} : { timezone: values.timezone }),
    ...(values.locale === undefined ? {} : { locale: values.locale }),
    ...(expiresInDays === undefined ? {} : { expiresInDays }),
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || "input"}: ${issue.message}`)
      .join("\n");
    process.stderr.write(`Ungueltige Eingabe:\n${issues}\n\n${USAGE}\n`);
    return 1;
  }

  const environment = parseApplicationEnvironment(process.env);
  const connection = createDatabaseConnection(environment.DATABASE_URL);

  try {
    await assertNoExistingOrganization(connection.database);
    const result = await createBootstrapOrganization(
      connection.database,
      parsed.data,
      { enforceExclusivity: true },
    );

    process.stdout.write(
      [
        "Bootstrap erfolgreich.",
        `  Organisation: ${result.name} (${result.slug})`,
        `  Organisation-ID: ${result.organizationId}`,
        `  Eingeladen: ${result.email} als ${result.role}`,
        `  Einladung gueltig bis: ${result.expiresAt.toISOString()}`,
        "",
        "Naechster Schritt: Mit genau dieser Adresse unter",
        "https://app.dartbase.ch registrieren, anmelden und die Einladung annehmen.",
        "",
      ].join("\n"),
    );
    return 0;
  } catch (error) {
    if (error instanceof OrganizationAlreadyExistsError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }

    process.stderr.write(
      `Bootstrap fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  } finally {
    try {
      await connection.close();
    } catch (closeError) {
      process.stderr.write(
        `Warnung: Datenbankverbindung konnte nicht sauber geschlossen werden: ${closeError instanceof Error ? closeError.message : String(closeError)}\n`,
      );
    }
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(
      `Bootstrap abgebrochen: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
