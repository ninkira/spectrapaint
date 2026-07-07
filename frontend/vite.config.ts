import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        // Use 127.0.0.1 (not "localhost"): Node 17+ resolves "localhost" to IPv6 ::1 first, but
        // the backend binds IPv4 127.0.0.1, so a "localhost" target fails with ECONNREFUSED.
        target: 'http://127.0.0.1:8000',   // FastAPI server
        changeOrigin: true,
        // No rewrite: the backend now serves routes under /api directly, so the same
        // /api/* urls work in dev (proxied) and in the packaged app (same origin).
      },
    },
  },
})