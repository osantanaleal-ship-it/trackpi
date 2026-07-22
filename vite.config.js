import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Ruta base del sitio. Vacío por defecto = raíz "/" (APK y dev).
  // Para GitHub Pages en subruta se pasa VITE_BASE_PATH=/trackpi/ al build.
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  server: { port: 4173 },
  preview: { port: 4173 },
})
