import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  build: {
    // MapLibre GL alone is ~800 kB minified; it is isolated in its own lazily-loaded chunk.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          maplibre: ['maplibre-gl'],
          charts: ['recharts']
        }
      }
    },
  },

  preview: {
    allowedHosts: [
      'quantara-sih-2026-production-f9a1.up.railway.app'
    ],
  },

  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true
      },
      '/socket.io': {
        target: 'http://localhost:5000',
        ws: true
      },
    },
  },
})
