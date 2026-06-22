import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'path'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as { version: string }

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? './' : '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // These are referenced by index.html but live outside the JS graph (and
      // png is excluded from globPatterns below), so list them explicitly to get
      // them into the precache.
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Web LLM Studio',
        short_name: 'LLM Studio',
        description: 'Browser-based local LLM playground and model manager',
        theme_color: '#6366f1',
        background_color: '#f7f8fc',
        display: 'standalone',
        // Relative so the installed app works under any GitHub Pages sub-path.
        start_url: './',
        scope: './',
        icons: [
          // Transparent logo, shown as-is (install prompt, browser tab, app lists,
          // Windows taskbar) — the icon floats on whatever surface it lands on.
          { src: './icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: './icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // Android adaptive icons crop to a launcher-chosen shape, so this one needs
          // a solid full-bleed background (a transparent maskable gets its cropped
          // corners filled with white/black) and keeps the logo in the ~80% safe zone.
          { src: './icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // svg/png are intentionally omitted: favicon comes in via includeAssets
        // and the icons via vite-plugin-pwa's manifest-icon injection, so listing
        // them here too would only add duplicate (deduped) precache entries.
        globPatterns: ['**/*.{js,css,html,json,woff2}'],
        // App shell only. The WebLLM TVM runtime (~6 MB, the `webllm-*` chunk) and
        // the Wllama wasm (~2.8 MB) are intentionally left OUT of the eager
        // precache — they are lazy-loaded and runtime-cached on first use (see the
        // engine-assets rule below). A model can't be downloaded without first
        // loading its engine, so any *cached* model already has its engine cached;
        // offline inference still works without bloating first load by ~9 MB.
        globIgnores: ['**/node_modules/**/*', '**/webllm-*.js', '**/*.wasm'],
        // HashRouter serves every route from the base index.html.
        navigateFallback: 'index.html',
        // navigateFallback only applies to navigations; keep HF weight URLs out
        // of it defensively — the engines own that (OPFS/Cache API) storage.
        navigateFallbackDenylist: [/^https:\/\/huggingface\.co\//],
        runtimeCaching: [
          {
            // The live WebLLM model catalog is imported from esm.sh at runtime
            // (catalog/webllmDynamic.ts). Cache it so the list survives offline;
            // app already falls back to localStorage + the bundled catalog too.
            urlPattern: /^https:\/\/esm\.sh\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'webllm-cdn',
              expiration: { maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Our own content-hashed engine chunks (TVM runtime JS + Wllama wasm)
            // that are too big to precache. CacheFirst is safe because the hashed
            // filename changes on every rebuild, so stale serving is impossible;
            // old entries are evicted by maxEntries / maxAgeSeconds.
            urlPattern: /\/assets\/.*\.(?:js|wasm)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'engine-assets',
              expiration: { maxEntries: 30, maxAgeSeconds: 30 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    // Bind to all interfaces so the dev server is reachable from other devices
    // (e.g. a phone) on the same LAN — avoids needing the `--host` CLI flag.
    host: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'state': ['zustand'],
          // Give the ~6 MB WebLLM runtime a stable chunk name so the service
          // worker can exclude it from the precache by pattern (see workbox.globIgnores).
          'webllm': ['@mlc-ai/web-llm'],
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['@mlc-ai/web-llm', '@wllama/wllama'],
  },
}))
