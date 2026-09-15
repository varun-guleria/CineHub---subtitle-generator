import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiProxy = {
  '/api': {
    target: 'http://localhost:5000',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api/, '')
  }
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: apiProxy
  },
  preview: {
    proxy: apiProxy
  }
})
