import { defineConfig } from 'vitest/config';

// Separate from vite.config.js (which carries dev-server-only settings like
// the /api proxy, irrelevant to tests). Phase 7's tests are all against the
// pure, framework-agnostic modules in src/realityCheck/ (scheduler.js,
// monitor.js, eventBatcher.js) — no React rendering, so no jsdom/testing-library
// environment is needed, keeping this dependency-light.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js']
  }
});
