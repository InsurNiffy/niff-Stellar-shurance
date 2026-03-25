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
  // Override rules that are noisy during early development
  {
    rules: {
      // Allow void-returning async handlers in express routes
      "@typescript-eslint/no-floating-promises": "off",
      // Allow empty catch blocks with a comment
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  }
);
