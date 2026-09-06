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
  {
    // Rollenlisten gehoeren nicht in die Oberflaeche. Vor dieser Regel
    // pruefte die Oberflaeche an neun Stellen ["OWNER", "ADMIN", ...]
    // .includes(role) -- eine Kopie des Berechtigungsmodells, die bei jeder
    // Aenderung an `rolePermissions` von Hand nachzuziehen waere
    // (AGENTS.md §4, §25). Der Selektor trifft nur Array-Literale, die einen
    // Rollennamen enthalten; ein gewoehnliches `[a, b].includes(c)` bleibt
    // erlaubt.
    files: ["apps/web/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'MemberExpression[property.name="includes"] > ArrayExpression > Literal[value=/^(OWNER|ADMIN|TOURNAMENT_DIRECTOR|SCORER|MEMBER|VIEWER)$/]',
          message:
            "Rollenliste in der Oberflaeche: hasOrganizationPermission(organization.role, \"<permission>\") aus @darts-platform/domain verwenden statt eine Rollenliste zu kopieren.",
        },
      ],
    },
  },
);
