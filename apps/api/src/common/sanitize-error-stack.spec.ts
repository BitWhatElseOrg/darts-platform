import { describe, expect, it } from "vitest";

import { sanitizeErrorStack } from "./sanitize-error-stack.js";

describe("sanitizeErrorStack", () => {
  it("entfernt die Bind-Parameter eines DrizzleQueryError, laesst SQL und Rahmen stehen", () => {
    const stack = [
      'DrizzleQueryError: Failed query: insert into "email_deliveries" ("kind", "recipient", "payload") values ($1, $2, $3)',
      'params: INVITATION,gast@example.test,{"invitationUrl":"https://dartbase.test/einladung/abc#code=geheim"}',
      "    at NodePgPreparedQuery.execute (/app/node_modules/drizzle-orm/pg-core/session.js:64:15)",
      "    at OrganizationsRepository.invite (/app/dist/organizations/organizations.repository.js:120:5)",
    ].join("\n");

    expect(sanitizeErrorStack(stack)).toBe(
      [
        'DrizzleQueryError: Failed query: insert into "email_deliveries" ("kind", "recipient", "payload") values ($1, $2, $3)',
        "params: <redigiert>",
        "    at NodePgPreparedQuery.execute (/app/node_modules/drizzle-orm/pg-core/session.js:64:15)",
        "    at OrganizationsRepository.invite (/app/dist/organizations/organizations.repository.js:120:5)",
      ].join("\n"),
    );
  });

  it("findet die Zeile auch eingerueckt, etwa in einer verschachtelten Ursache", () => {
    const stack =
      "Error: boom\n  [cause]: Failed query: select 1\n    params: geheim@example.test\n    at run (x.js:1:1)";

    expect(sanitizeErrorStack(stack)).toBe(
      "Error: boom\n  [cause]: Failed query: select 1\n    params: <redigiert>\n    at run (x.js:1:1)",
    );
  });

  it("laesst einen Stack ohne Parameterzeile unveraendert und reicht undefined durch", () => {
    const stack = "Error: keine Abfrage\n    at handler (server.js:10:3)";

    expect(sanitizeErrorStack(stack)).toBe(stack);
    expect(sanitizeErrorStack(undefined)).toBeUndefined();
  });

  it("schneidet nur am Zeilenanfang, nicht mitten im Text", () => {
    const stack = "Error: der Bericht nennt params: nichts Geheimes";

    expect(sanitizeErrorStack(stack)).toBe(stack);
  });
});
