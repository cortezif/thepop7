import "dotenv/config"; // carrega .env (DATABASE_URL etc.) p/ os helpers Prisma dos specs
import { defineConfig, devices } from "@playwright/test";

// E2E do painel (ADR-038). Sobe API (3001) + web (3000) e roda no Chromium.
// Requer Postgres de pé + .env (mesma exigência dos testes de integração).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    { command: "npm run dev:api", port: 3001, reuseExistingServer: true, timeout: 120_000 },
    { command: "npm run dev:web", port: 3000, reuseExistingServer: true, timeout: 120_000 },
  ],
});
