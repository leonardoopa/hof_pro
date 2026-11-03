import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const mediapipeVersion = JSON.parse(
  readFileSync(new URL('./node_modules/@mediapipe/tasks-vision/package.json', import.meta.url), 'utf8'),
).version

export default defineConfig({
  plugins: [react()],
  define: { __MEDIAPIPE_VERSION__: JSON.stringify(mediapipeVersion) },
  server: {
    port: 5173,
    // No Docker, o backend é o serviço "backend" da rede do compose.
    proxy: { '/api': process.env.API_PROXY_TARGET ?? 'http://localhost:8000' },
  },
})
