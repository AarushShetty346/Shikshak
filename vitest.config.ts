import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: ".",
    include: ["shared/**/*.test.ts", "server/**/*.test.ts", "scripts/**/*.test.ts", "web/src/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
});
