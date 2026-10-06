import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Unit tests for pure functions only (no Nest app, no database).
export default defineConfig({
  resolve: {
    alias: {
      '@nyx/schemas': fileURLToPath(new URL('../../packages/schemas/index.ts', import.meta.url)),
      '@nyx/types':   fileURLToPath(new URL('../../packages/types/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.spec.ts'],
  },
})
