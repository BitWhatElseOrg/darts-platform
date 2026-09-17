import { readFileSync, globSync } from "node:fs";

const files = globSync("{apps,packages}/*/coverage/coverage-summary.json");
const rows = files.map((file) => {
  const total = JSON.parse(readFileSync(file, "utf8")).total;
  const pkg = file.split("/").slice(0, 2).join("/");
  return `| ${pkg} | ${total.lines.pct} | ${total.branches.pct} | ${total.functions.pct} |`;
});
console.log("| Paket | Zeilen % | Zweige % | Funktionen % |\n| --- | --- | --- | --- |");
console.log(rows.sort().join("\n"));
