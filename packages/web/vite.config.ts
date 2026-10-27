import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// In development the page and the match server run separately; forward the
// account API so the page can call it at its own address, as in production.
export default defineConfig({
  server: {
    proxy: { '/api': `http://localhost:${process.env.SERVER_PORT ?? 2567}` },
  },
  build: {
    // The game, plus the owner's stats dashboard at /admin.html.
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), admin: resolve(__dirname, 'admin.html') } },
  },
});
