import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const API_PORT = 8790;
const WEB_PORT = 5174;
const dataDir = process.env.E2E_DATA_DIR ?? mkdtempSync(join(tmpdir(), "ostra-e2e-"));

/**
 * End-to-end tests against the real API in demo mode (seeded mail, local
 * provider, embedded Postgres in a throwaway directory) and the Vite app.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  // The e2e API runs on embedded single-connection Postgres; tests run one at a time.
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
  },
  webServer: [
    {
      command: "node --import tsx src/main.ts",
      cwd: "../api",
      port: API_PORT,
      reuseExistingServer: false,
      env: { OSTRA_DEMO: "true", PORT: String(API_PORT), OSTRA_DATA_DIR: dataDir, LOG_LEVEL: "error", OSTRA_INLINE_WORKERS: "true" },
      timeout: 120_000,
    },
    {
      // A production build: no dependency re-optimization reloads mid-test, and it's what ships.
      command: `pnpm exec vite build --logLevel error && pnpm exec vite preview --port ${WEB_PORT} --strictPort`,
      port: WEB_PORT,
      reuseExistingServer: false,
      env: { OSTRA_API_URL: `http://localhost:${API_PORT}` },
      timeout: 120_000,
    },
  ],
});
