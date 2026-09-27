import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const googleKey = env.VITE_GOOGLE_MAPS_API_KEY

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
        // Google content URIs are root-absolute (`/v1/3dtiles/...`). Without a proxy
        // those hit the Vite origin and fail — leaving coarse globe shards on screen.
        '/v1/3dtiles': {
          target: 'https://tile.googleapis.com',
          changeOrigin: true,
          secure: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (googleKey) proxyReq.setHeader('X-GOOG-API-KEY', googleKey)
            })
          },
        },
      },
    },
  }
})
