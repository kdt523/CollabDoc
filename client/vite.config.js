import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER_PORT = 3001;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // REST API proxy
      '/api': `http://localhost:${SERVER_PORT}`,
    },
  },
});

