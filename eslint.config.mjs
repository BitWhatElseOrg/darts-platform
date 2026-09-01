import eslint from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import globals from "globals";
import tseslint from "typescript-eslint";

const webFiles = ["apps/web/**/*.{js,jsx,ts,tsx}"];

export default tseslint.config(
  {
    ignores: [
      "**/.claude/**",
      "**/.agents/**",
      "**/.next/**",
      "**/.next-e2e/**",
      "**/.worktrees/**",
      "**/coverage/**",
      "**/dist/**",
      "**/drizzle/**",
      "**/node_modules/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  ...nextVitals.map((configuration) => ({
    ...configuration,
    files: webFiles,
  })),
  ...nextTypeScript.map((configuration) => ({
    ...configuration,
    files: webFiles,
  })),
  {
    files: webFiles,
    rules: {
      "@next/next/no-html-link-for-pages": "off",
    },
  },
);
