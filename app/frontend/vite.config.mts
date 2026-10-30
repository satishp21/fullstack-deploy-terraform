import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

export default defineConfig({
  plugins: [react()],
  server: {
    // bind to all network interfaces so that cloud providers (like Render)
    // can reach the dev server. When using `--host` on the CLI Vite will
    // automatically set this to `0.0.0.0` but we can specify it here as
    // a default.
    host: '0.0.0.0',
    // allow the port to be supplied by the environment (e.g. Render sets
    // PORT) but fall back to 3000 for local development.
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
    proxy: {
      '/api': 'http://localhost:5000'
    },
    // For deployments with a fixed hostname, ensure the host check passes.
    // You can add more entries or use '*' to disable the check entirely.
    allowedHosts: ['game-zone-fe.onrender.com'],
  }
});

