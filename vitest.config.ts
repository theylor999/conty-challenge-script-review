import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    poolOptions: { forks: { execArgv: ["--disable-warning=ExperimentalWarning"] } },
  },
});
