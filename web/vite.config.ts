import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// GitHub Pages serveert de site onder /designaanvraag/. Lokaal en in tests gewoon de root.
const base = process.env.VITE_BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  server: {
    fs: { allow: ['..'] },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    // Twee pagina's: het formulier, en de preview van het torenscherm uit de opleveringsmail
    // (torenscherm/?p=<sleutel>, zie shared/torenscherm-preview.ts).
    rolldownOptions: {
      input: {
        formulier: fileURLToPath(new URL('index.html', import.meta.url)),
        torenscherm: fileURLToPath(new URL('torenscherm/index.html', import.meta.url)),
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts', '../shared/**/*.test.ts'],
    environment: 'node',
  },
})
