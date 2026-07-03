import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev-proxy /api → API gateway (nginx :8000) so the SPA is same-origin (no CORS).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
