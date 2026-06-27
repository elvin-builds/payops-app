import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    // Local development-da API request-ləri gateway-ə proxy edirik
    proxy: {
      '/api': {
        target: 'http://api-gateway:8080',
        changeOrigin: true,
      },
    },
  },
});
