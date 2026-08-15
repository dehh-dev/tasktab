import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Encaminha /api para o Express. Mantem front e back na mesma origem
    // durante o desenvolvimento, dispensando CORS.
    proxy: {
      '/api': {
        // O E2E aponta para a API de teste (:3001) via API_URL, para nunca
        // tocar no banco de desenvolvimento.
        target: process.env.API_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
