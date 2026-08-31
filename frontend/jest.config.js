const nextJest = require("next/jest.js");

const createJestConfig = nextJest({ dir: "./" });

const ESM_PACKAGES = ["@creit\\.tech", "@stellar", "@preact", "preact", "htm", "@twind"].join("|");

/** @type {import('jest').Config} */
const config = {
  testEnvironment: "jest-environment-jsdom",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^next-intl(.*)$": "<rootDir>/src/__mocks__/next-intl.ts",
    "^use-intl(.*)$": "<rootDir>/src/__mocks__/next-intl.ts",
  },
  testMatch: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts", "<rootDir>/jest.flaky-retry.js"],
  globals: {
    "ts-jest": {
      tsconfig: "<rootDir>/tsconfig.test.json",
    },
  },
};

// nextJest sets its own transformIgnorePatterns; override after merge.
async function jestConfig() {
  const nextConfig = await createJestConfig(config)();
  return {
    ...nextConfig,
    transformIgnorePatterns: [
      `/node_modules/(?!(${ESM_PACKAGES})/)`,
    ],
  };
}

module.exports = jestConfig;
