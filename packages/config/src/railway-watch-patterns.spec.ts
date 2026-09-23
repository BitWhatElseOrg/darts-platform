// Haelt die `watchPatterns` in `.railway/railway.ts` an den tatsaechlichen
// Abhaengigkeiten der Dienste fest. Faellt ein Paket heraus, deployt Railway
// den betroffenen Dienst nach einer Aenderung daran nicht — Web und API
// bekommen den neuen Stand, der uebergangene Dienst laeuft still auf dem
// alten weiter. Genau so blieb `packages/notifications` beim Worker liegen,
// als es am 20.09.2026 dazukam, und `scoring-engine` und `league-engine`
// fehlten dem Web-Dienst von Anfang an.
//
// Die Pruefung liest die IaC-Datei als Text statt sie auszuwerten: `railway/iac`
// dafuer zu laden hiesse, eine Deployment-Beschreibung in einem Testlauf
// auszufuehren. Der Zugriff ueber die Paketgrenze hinaus ist Absicht — die
// Datei gehoert zu keinem Workspace, und diese Suite ist die einzige, die
// Konfiguration prueft.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Die Wurzel des Workspace, gesucht statt gezaehlt: `import.meta` steht in
 * diesem Paket nicht zur Verfuegung (es baut nach CommonJS), und eine feste
 * Anzahl `..` bricht, sobald die Datei umzieht.
 */
function workspaceRoot(): string {
  let directory = resolve(process.cwd());
  while (!existsSync(join(directory, "pnpm-workspace.yaml"))) {
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error("pnpm-workspace.yaml oberhalb des Arbeitsverzeichnisses nicht gefunden.");
    }
    directory = parent;
  }
  return directory;
}

const root = workspaceRoot();

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

const railwayIac = read(".railway/railway.ts");

/**
 * Der Abschnitt der IaC, der zu genau einem Dienst gehoert: von seiner
 * `service(`-Deklaration bis zur naechsten. Die Grenze ist wichtig — ohne sie
 * liefe die Suche nach `watchPatterns` bei einem Dienst, der keine hat,
 * einfach in den naechsten Dienst weiter und pruefte dessen Muster.
 */
function serviceBlock(serviceName: string): string {
  const start = railwayIac.indexOf(`service("${serviceName}"`);
  if (start === -1) {
    throw new Error(`Dienst ${serviceName} steht nicht in .railway/railway.ts.`);
  }
  const next = railwayIac.indexOf('service("', start + 1);
  return next === -1 ? railwayIac.slice(start) : railwayIac.slice(start, next);
}

/**
 * Entfernt Zeilen- und Blockkommentare. Ein auskommentiertes Muster ist fuer
 * Railway keines — ohne diesen Schritt haette `// "/packages/notifications/**",`
 * den Abgleich befriedigt, waehrend der Dienst das Paket nicht mehr beobachtet.
 * In den Mustern selbst kommt keine Zeichenfolge `//` vor, sie sind einfache
 * Pfade mit genau einem fuehrenden Schraegstrich.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");
}

/** Der Inhalt der `watchPatterns` eines Dienstes, als Text ohne Kommentare. */
function watchPatternsOf(serviceName: string): string {
  const patterns = /watchPatterns: \[([\s\S]*?)\]/u.exec(serviceBlock(serviceName));
  if (patterns === null) {
    throw new Error(`Keine watchPatterns fuer ${serviceName} in .railway/railway.ts gefunden.`);
  }
  return withoutComments(patterns[1] ?? "");
}

/** Die Pakete, die die `watchPatterns` eines Dienstes beobachten. */
function watchedPackages(serviceName: string): readonly string[] {
  return [...watchPatternsOf(serviceName).matchAll(/"\/packages\/([a-z-]+)\/\*\*"/gu)].map(
    (match) => match[1] ?? "",
  );
}

const scope = "@darts-platform/";

/** Die direkten Workspace-Abhaengigkeiten aus einer package.json. */
function directDependencies(manifestPath: string): readonly string[] {
  const manifest = JSON.parse(read(manifestPath)) as {
    readonly dependencies?: Readonly<Record<string, string>>;
  };
  return Object.keys(manifest.dependencies ?? {})
    .filter((name) => name.startsWith(scope))
    .map((name) => name.slice(scope.length));
}

/**
 * Alle Workspace-Pakete, auf denen eine Anwendung aufbaut — auch die, die sie
 * nur ueber ein anderes Paket erreicht. Eine Aenderung an einem transitiv
 * erreichten Paket geht genauso in den Build ein wie eine an einem direkten:
 * `notifications` zieht `schemas` nach, also braucht auch der Worker, der nur
 * `notifications` nennt, ein Muster auf `schemas`.
 */
function requiredPackages(application: string): readonly string[] {
  const reached = new Set<string>();
  const queue = [...directDependencies(`apps/${application}/package.json`)];
  while (queue.length > 0) {
    const name = queue.pop();
    if (name === undefined || reached.has(name)) continue;
    reached.add(name);
    queue.push(...directDependencies(`packages/${name}/package.json`));
  }
  return [...reached].sort();
}

const services = [
  { application: "web", serviceName: "@darts-platform/web" },
  { application: "api", serviceName: "@darts-platform/api" },
  { application: "worker", serviceName: "@darts-platform/worker" },
] as const;

describe("Railway watchPatterns", () => {
  it.each(services)(
    "$application beobachtet jedes Paket, auf dem es aufbaut",
    ({ application, serviceName }) => {
      const watched = watchedPackages(serviceName);
      const missing = requiredPackages(application).filter((name) => !watched.includes(name));

      expect(missing).toEqual([]);
    },
  );

  it.each(services)("$application beobachtet die gemeinsamen Wurzeldateien", ({ serviceName }) => {
    const patterns = watchPatternsOf(serviceName);

    for (const shared of ["/package.json", "/pnpm-lock.yaml", "/pnpm-workspace.yaml", "/turbo.json"]) {
      expect(patterns).toContain(`"${shared}"`);
    }
  });

  it("findet die Muster jedes Dienstes in dessen eigenem Abschnitt", () => {
    // Ohne diese Schranke koennte ein Dienst ohne eigene `watchPatterns`
    // unbemerkt die des naechsten erben und der Abgleich grundlos gruen sein.
    for (const { serviceName } of services) {
      expect(serviceBlock(serviceName)).toContain("watchPatterns: [");
    }
  });
});
