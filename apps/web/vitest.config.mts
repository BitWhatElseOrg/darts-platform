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
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
