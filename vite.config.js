import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // Project Pages URL: https://what-llms-can-not-do.github.io/website/
  base: mode === "production" ? "/website/" : "/",
  plugins: [react(), tailwindcss()],
  server: {
    watch: {
      // Shared/network mounts can report empty file contents to Vite without polling
      usePolling: true,
      interval: 1000,
    },
  },
}))
