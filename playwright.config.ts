import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: { baseURL: 'http://localhost:4684/crypto-lab-privacy-pass/', colorScheme: 'dark' },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4684 --strictPort',
    url: 'http://localhost:4684/crypto-lab-privacy-pass/',
    reuseExistingServer: !process.env.CI,
  },
})