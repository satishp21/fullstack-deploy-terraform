import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Mirrors production, where CloudFront routes /api/* to the backend:
    // the browser always calls relative /api URLs, so no CORS setup is needed.
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API_URL ?? 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
