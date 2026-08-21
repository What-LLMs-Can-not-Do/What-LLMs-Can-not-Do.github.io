import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    watch: {
      // Shared/network mounts can report empty file contents to Vite without polling
      usePolling: true,
      interval: 1000,
    },
  },
})
