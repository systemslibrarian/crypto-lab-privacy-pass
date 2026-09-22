import { defineConfig } from '@playwright/test'

// Three projects, for one reason: the verdict-coverage rules judge what the OTHER specs executed,
// so they have to run after them, and Playwright's only ordering guarantee between files is
// `dependencies:`. e2e/claims.spec.ts is the project the coverage project depends on; a11y is
// independent of both.
//
// A dependency project also runs its complete file list even when the command line names a single
// file, which is what keeps the `verdict-coverage` CI job honest: `npx playwright test
// e2e/verdicts.spec.ts` still runs claims.spec first, so the coverage rules still have a run to
// judge. Without that the job would read an empty observation sink, and an empty sink must never
// look like a clean one.
export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  globalSetup: './e2e/global-setup.ts',
  use: { baseURL: 'http://localhost:4684/crypto-lab-privacy-pass/', colorScheme: 'dark' },
  projects: [
    { name: 'a11y', testMatch: /a11y\.spec\.ts$/ },
    { name: 'claims', testMatch: /claims\.spec\.ts$/ },
    { name: 'verdict-coverage', testMatch: /verdicts\.spec\.ts$/, dependencies: ['claims'] },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4684 --strictPort',
    url: 'http://localhost:4684/crypto-lab-privacy-pass/',
    reuseExistingServer: !process.env.CI,
  },
})
