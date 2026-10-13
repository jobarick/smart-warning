import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Separate from vite.config.ts on purpose: the production build's config
// (the PWA plugin, manifest, __APP_VERSION__ define) has no reason to run
// under a test process, and keeping this file standalone means a change to
// one can never accidentally break the other.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { 'virtual:pwa-register': fileURLToPath(new URL('./src/test/pwa-register-stub.ts', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // Loads the lazily split English strings before any test renders.
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Vitest's default 'forks' pool spawns workers via child_process.fork,
    // which hangs waiting for a worker to respond under at least one
    // sandboxed CI/dev shell this project runs test in (observed as a 60s
    // "Timeout waiting for worker to respond" with zero tests ever run).
    // 'threads' (worker_threads) does not hit whatever restricts that and
    // has no known downside for this suite — plain, IO-light unit/DOM tests
    // with nothing that needs real process isolation.
    pool: 'threads',
  },
});
