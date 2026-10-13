/** @type {import('@stryker-mutator/api/core').StrykerOptions} */
export default {
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  vitest: {
    configFile: "vitest.config.ts",
    related: false,
  },
  // The Vitest runner's per-test isolation cannot reliably attribute imported
  // TypeScript modules in our HTTP/auth boundaries. Run the full suite for each
  // mutant so covered changes are always evaluated by the actual contracts.
  coverageAnalysis: "all",
  mutate: [
    "src/config.ts",
    "src/domain/**/*.ts",
    "src/providers/**/*.ts",
    "src/auth/**/*.ts",
    "src/tools/**/*.ts",
  ],
  reporters: ["clear-text", "progress", "html"],
  thresholds: {
    break: 80,
  },
};
