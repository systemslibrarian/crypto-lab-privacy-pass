import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  base: '/crypto-lab-privacy-pass/',
  test: {
    include: ['src/**/*.test.ts'],
  },
  build: {
    outDir: 'dist',
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
})