import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Two pages: the landing page and the marketplace listing.
export default defineConfig({
  build: {
    rollupOptions: {
      input: { main: resolve(__dirname, 'index.html'), marketplace: resolve(__dirname, 'marketplace.html') },
    },
  },
});
