import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

// In de Claude Code-cloudomgeving staat Chromium voorgeïnstalleerd; lokaal/CI installeert Playwright zelf.
const preinstalled = '/opt/pw-browsers/chromium'
const launchOptions = existsSync(preinstalled) ? { executablePath: preinstalled } : {}

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    locale: 'nl-NL',
    timezoneId: 'Europe/Amsterdam',
    trace: 'retain-on-failure',
    launchOptions,
  },
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
})
