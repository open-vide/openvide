import { defineConfig } from 'vite';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
    dedupe: ['react', 'react-dom', 'react-router', '@evenrealities/even_hub_sdk', 'upng-js', 'even-toolkit'],
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    open: true,
  },
});
