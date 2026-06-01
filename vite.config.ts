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
          'Origin': 'https://www.pathofexile.com',
          'Referer': 'https://www.pathofexile.com/trade2/search/poe2/Standard',
        },
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            const sessionId = req.headers['x-session-id'];
            if (sessionId) {
              // Support full cookie strings or just single POESESSID
              const cookieHeader = String(sessionId).includes('=') 
                ? sessionId 
                : `POESESSID=${sessionId}`;
              
              proxyReq.setHeader('Cookie', cookieHeader);
              // Remove the custom header so it doesn't get sent to GGG
              proxyReq.removeHeader('X-Session-Id');
            }
          });
        }
      },
      '/poeninja': {
        target: 'https://poe.ninja',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/poeninja/, ''),
      },
    }
  }
})
