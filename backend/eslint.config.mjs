// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Global ignores
  {
    ignores: ["dist/**", "dist-test/**", "node_modules/**"],
  },
  // JS recommended for all files
  eslint.configs.recommended,
  // TypeScript rules — type-unaware (no parserOptions.project needed)
  // Using recommendedTypeChecked requires a tsconfig; skip for now to keep
  // CI fast. Switch to recommendedTypeChecked once tsconfig paths are stable.
  ...tseslint.configs.recommended,
  // Enforce AppConfigService — no direct process.env access in src/
  {
    files: ["src/**/*.ts"],
    ignores: ["src/config/**", "**/*.spec.ts", "**/*.test.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message:
            "Do not read process.env directly. Use AppConfigService instead (src/config/app-config.service.ts).",
        },
      ],
    },
  },
  // Override rules that are noisy during early development
  {
    rules: {
      // Allow void-returning async handlers in express routes
      "@typescript-eslint/no-floating-promises": "off",
      // Allow empty catch blocks with a comment
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Allow underscore-prefixed params/vars to be unused (convention for intentionally unused)
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
    },
  },
  // Relaxed rules for test/spec files
  {
    files: ["**/*.spec.ts", "**/*.test.ts", "test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
    },
  },
);
