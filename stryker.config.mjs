/** @type {import('@stryker-mutator/api/core').StrykerOptions} */
export default {
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  vitest: {
    configFile: "vitest.config.ts",
    related: false,
  },
  coverageAnalysis: "perTest",
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
