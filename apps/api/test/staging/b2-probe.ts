// Block B2 (Betriebsprobe, kein Spec): Referenzdaten fuer die Restore-Probe.
//   before  – zaehlt die Organisationen des Testkontos (N), merkt sich T1, legt danach eine weitere
//             Organisation an (N+1). Ein Restore auf T1 darf diese letzte Organisation NICHT enthalten.
//   verify  – zaehlt erneut und vergleicht mit dem uebergebenen Erwartungswert.
// Aufruf aus apps/api: npx dotenv -e ../../.env.staging -- npx tsx test/staging/b2-probe.ts before
//                      npx dotenv -e ../../.env.staging -- npx tsx test/staging/b2-probe.ts verify <erwartet>
import { api, readStagingConfig, signIn } from "./staging-client.js";

const [phase, expectedArgument] = process.argv.slice(2);
const config = readStagingConfig();
const session = await signIn(config.baseUrl, config.email, config.password, config.origin);

async function countOrganizations(): Promise<{ count: number; slugs: string[] }> {
  const response = await api<{ slug: string }[]>(session, "GET", "/organizations");
  if (response.status !== 200) throw new Error(`GET /organizations: ${response.status}`);
  return { count: response.data.length, slugs: response.data.map((o) => o.slug).sort() };
}

if (phase === "before") {
  const before = await countOrganizations();
  const t1 = new Date();
  // Kurz warten, damit T1 eindeutig VOR der naechsten Schreiboperation liegt.
  await new Promise((r) => setTimeout(r, 5_000));
  const runId = `b2-after-${Date.now()}`;
  const created = await api<{ slug: string }>(session, "POST", "/organizations", { name: `B2 nach T1 ${runId}`, slug: `lasttest-${runId}` });
  if (created.status !== 201) throw new Error(`Organisation nicht angelegt: ${created.status}`);
  const after = await countOrganizations();
  console.log(JSON.stringify({ phase, countBefore: before.count, t1: t1.toISOString(), createdAfterT1: created.data.slug, countAfter: after.count }));
} else if (phase === "verify") {
  const expected = Number(expectedArgument);
  const now = await countOrganizations();
  const health = await fetch(`${config.baseUrl}/health`).then((r) => r.json() as Promise<{ status: string; services: Record<string, string> }>);
  const ok = now.count === expected;
  console.log(JSON.stringify({ phase, expected, count: now.count, ok, health: health.services, hasAfterOrg: now.slugs.some((s) => s.startsWith("lasttest-b2-after-")) }));
  process.exit(ok ? 0 : 1);
} else {
  throw new Error("Phase before|verify angeben.");
}
