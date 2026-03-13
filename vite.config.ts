import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('react-konva') || id.includes('/konva/')) {
            return 'konva'
          }

          if (id.includes('/react/') || id.includes('/react-dom/')) {
            return 'react'
          }

          return undefined
        },
      },
    },
  },
})
