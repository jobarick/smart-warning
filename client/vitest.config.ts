import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Separate from vite.config.ts on purpose: the production build's config
// (the PWA plugin, manifest, __APP_VERSION__ define) has no reason to run
// under a test process, and keeping this file standalone means a change to
// one can never accidentally break the other.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // No project-wide setup file yet — @testing-library/jest-dom's matchers
    // are imported directly in the one test file that needs them for now.
    // Add src/test/setup.ts and reference it here if that stops scaling.
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
