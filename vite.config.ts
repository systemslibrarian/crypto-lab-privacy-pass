import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: '/crypto-lab-privacy-pass/',
  test: {
    include: ['src/**/*.test.ts'],
  },
  build: {
    outDir: 'dist',
  },
})