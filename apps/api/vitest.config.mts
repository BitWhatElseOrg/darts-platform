import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 10_000,
    // test/staging laeuft nur gegen die echte Staging-API (pnpm test:staging,
    // eigene vitest.config.mts) und darf hier nie mitgesammelt werden. Die
    // Standardausschluesse (node_modules, dist, ...) bleiben erhalten statt
    // durch eine handgeschriebene Liste ersetzt zu werden.
    exclude: [...configDefaults.exclude, "test/staging/**"],
  },
});
