import { defineConfig } from 'vitest/config'

// Standalone test config — deliberately does NOT load the app's Vite plugins
// (React/PWA) so the pure-function unit tests run fast in a plain node env.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // Only measure the logic we can meaningfully unit-test in a node env.
      // UI components, engine adapters (WebGPU/WASM), entry points, and type-only
      // files are exercised via runtime/browser checks, not these unit tests.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.d.ts',
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
    },
  },
})
