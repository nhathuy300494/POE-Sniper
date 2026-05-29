import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/trade2': {
        target: 'https://www.pathofexile.com',
        changeOrigin: true,
        headers: {
          'Referer': 'https://www.pathofexile.com/trade2/search/poe2/Standard',
        }
      }
    }
  }
})
