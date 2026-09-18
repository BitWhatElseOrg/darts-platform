import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 10_000,
    // test/staging laeuft nur gegen die echte Staging-API (pnpm test:staging,
    // eigene vitest.config.mts) und darf hier nie mitgesammelt werden.
    exclude: ["test/**", "node_modules/**", "dist/**"],
  },
});
