import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Bis hierher lief die Web-Suite ohne eigene Konfiguration. Das ging, solange
 * nur reine Funktionen und Hooks mit relativen Importen geprueft wurden — die
 * Alias-Schreibweise `@/…` aus `tsconfig.json` kennt Vite von sich aus aber
 * nicht, und jeder Test an einer Komponente oder einem ihrer Hooks scheiterte
 * schon am Aufloesen der Importe. Diese Datei bildet den Alias nach, mehr
 * nicht; Testumgebung und -verzeichnis bleiben wie bisher (die Pragma-Zeile
 * `@vitest-environment happy-dom` je Hook-Datei gilt unveraendert).
 *
 * `oxc.jsx` steht hier separat von `tsconfig.json`: dessen `"preserve"` gilt
 * fuer Next.js, das JSX selbst uebersetzt, und darf dafuer nicht angetastet
 * werden. Vites eigener Transform (Vite 8 nutzt standardmaessig oxc statt
 * esbuild) kennt dieses `"preserve"` aber nicht als reale Option -- er liess
 * bislang jede `.tsx`-Datei mit tatsaechlichem JSX am Parsen scheitern
 * (Task 6, `share-panel.tsx`: reine Funktionen UND eine Komponente in
 * derselben Datei). `"automatic"` gilt deshalb nur fuer diesen Testlauf.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  oxc: {
    jsx: { runtime: "automatic" },
  },
});
