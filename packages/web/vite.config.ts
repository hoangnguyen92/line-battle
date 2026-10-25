import { defineConfig } from 'vite';

// In development the page and the match server run separately; forward the
// account API so the page can call it at its own address, as in production.
export default defineConfig({
  server: {
    proxy: { '/api': `http://localhost:${process.env.SERVER_PORT ?? 2567}` },
  },
});
