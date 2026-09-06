import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// This config file runs as ESM (package.json "type": "module"), so
// __dirname isn't natively available — derived from import.meta.url instead.
const __dirname = dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // Multi-page: the main one-shot app (index.html), the Phase 7
      // continuous-session mock-interview demo (demo-interview.html) —
      // which imports only src/realityCheck/index.js's public interface,
      // never App.jsx or any of its one-shot-flow internals — and the
      // Phase 9 external-consumer integration proof
      // (oa-integration-demo.html), which additionally opens its own
      // camera/MediaRecorder and hands that stream to Reality Check via
      // the same public interface's `mediaStream` option.
      input: {
        main: resolve(__dirname, 'index.html'),
        demo: resolve(__dirname, 'demo-interview.html'),
        oaDemo: resolve(__dirname, 'oa-integration-demo.html')
      }
    }
  },
  server: {
    port: 5173,
    open: false,
    proxy: {
      // Same-origin path for the Phase 1 verification-session backend, so
      // the browser fetch in src/api/sessionApi.js is never cross-origin.
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
});
