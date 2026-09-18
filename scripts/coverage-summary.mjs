import { readFileSync, globSync } from "node:fs";

const files = globSync("{apps,packages}/*/coverage/coverage-summary.json");

if (files.length === 0) {
  console.error(
    "Keine coverage-summary.json gefunden (Muster {apps,packages}/*/coverage/coverage-summary.json). " +
      "Lief `pnpm test:coverage` vorher?",
  );
  process.exitCode = 1;
}

const entries = files.map((file) => {
  const pkg = file.split("/").slice(0, 2).join("/");
  try {
    const total = JSON.parse(readFileSync(file, "utf8")).total;
    if (!total?.lines || !total?.branches || !total?.functions) {
      throw new Error("'total.lines/branches/functions' fehlt");
    }
    return {
      pkg,
      line: `| ${pkg} | ${total.lines.pct} | ${total.branches.pct} | ${total.functions.pct} |`,
    };
  } catch {
    return { pkg, line: `| ${pkg} (Bericht unlesbar) | – | – | – |` };
  }
});

console.log("| Paket | Zeilen % | Zweige % | Funktionen % |\n| --- | --- | --- | --- |");
console.log(
  entries
    .sort((a, b) => a.pkg.localeCompare(b.pkg))
    .map((entry) => entry.line)
    .join("\n"),
);
