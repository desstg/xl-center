import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    host: true,
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:8899',
        changeOrigin: true,
      },
      '/images': {
        target: 'http://localhost:8899',
        changeOrigin: true,
      },
      '/stream': {
        target: 'http://localhost:8899',
        changeOrigin: true,
      },
    },
  },
})
