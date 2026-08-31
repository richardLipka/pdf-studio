import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['pdfjs-dist', 'pdf-lib', 'signature_pad']
  },
  server: {
    port: 3000,
    open: false
  }
});
