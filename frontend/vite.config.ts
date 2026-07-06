import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',   // FastAPI server
        changeOrigin: true,
        // No rewrite: the backend now serves routes under /api directly, so the same
        // /api/* urls work in dev (proxied) and in the packaged app (same origin).
      },
    },
  },
})