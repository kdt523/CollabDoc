import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER_PORT = 3001;

export default defineConfig({
  plugins: [react()],
  server: {
    // Dev proxy — only active during `npm run dev`
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
});

