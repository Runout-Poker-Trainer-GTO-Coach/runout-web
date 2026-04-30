import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
// Expose VITE_* plus ADMIN_* so .env can use ADMIN_PASSWORD without the VITE_ prefix.
export default defineConfig({
  envPrefix: ['VITE_', 'ADMIN_'],
  plugins: [react(), tailwindcss()],
})
