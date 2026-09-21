import { defineConfig } from 'vitest/config'
import { RFC9497_VECTOR_COUNT } from './src/kat/rfc9497.ts'
import { RFC9578_VECTOR_COUNT } from './src/kat/rfc9578.ts'

// The KAT counter on the page is measured here from the vector corpus the unit
// suite iterates, so adding or removing a vector moves the number the page shows.
// It used to be a sentence typed by hand, cross-checked only against itself.
export default defineConfig({
  base: '/crypto-lab-privacy-pass/',
  define: {
    __RFC9497_VECTOR_COUNT__: JSON.stringify(RFC9497_VECTOR_COUNT),
    __RFC9578_VECTOR_COUNT__: JSON.stringify(RFC9578_VECTOR_COUNT),
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
  build: {
    outDir: 'dist',
  },
})
