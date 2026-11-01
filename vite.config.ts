import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // Listen on all network addresses (LAN / mobile phone access)
    port: 5174,
    strictPort: true,
    proxy: {
      // Event streams must not be buffered or compressed by the dev proxy.
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/health': { target: 'http://localhost:3001', changeOrigin: true },
      '/screen-view': { target: 'http://localhost:3001', changeOrigin: true },
    }
  }
})
