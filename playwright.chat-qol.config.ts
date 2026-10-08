import { defineConfig } from '@playwright/test'
import fixtures from './playwright.fixtures.config'

export default defineConfig({ ...fixtures,
  testMatch: ['chat-qol.spec.ts', 'chat-history-qol.spec.ts', 'chat-privacy.spec.ts'],
  workers: 4,
  use: { ...fixtures.use, baseURL: 'http://127.0.0.1:4182' },
  webServer: { command: 'npm run dev:web -- --mode test --port 4182 --strictPort', url: 'http://127.0.0.1:4182/tests/chat-history-harness/index.html', reuseExistingServer: false, timeout: 120_000 },
})
