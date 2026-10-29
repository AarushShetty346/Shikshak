// Browser tests against a real server (no provider keys, so nothing is called or charged).
// Uses the Chrome already installed on the machine (channel "chrome"); no browser download.
//   npm run test:e2e
import { defineConfig, devices } from "@playwright/test";

const PORT = 8799;

export default defineConfig({
  testDir: "e2e",
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  webServer: {
    command: "npx tsx server/index.ts",
    url: `http://localhost:${PORT}/api/health`,
    timeout: 90_000,
    reuseExistingServer: false,
    env: {
      PORT: String(PORT),
      DATA_DIR: `e2e/.data/run-${Date.now()}`,
      GEMINI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      BOLNA_API_KEY: "",
      BOLNA_AGENT_ID: "",
      FAKE_CHECKER: "1",
      PHONE_CALLS_ENABLED: "",
      // Every test is a new browser from 127.0.0.1; the production sign-up limit would throttle the suite.
      DEVICE_SIGNUPS_PER_MINUTE: "600",
    },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    { name: "phone", use: { ...devices["Pixel 7"], channel: "chrome" } },
  ],
});
