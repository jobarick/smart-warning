import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { spaNavigationRoutes } from './src/lib/routes';

// Surfaced in the About screen. Google Play support requests and bug reports
// are close to useless without knowing which build someone is running, and
// reading it from package.json means it cannot drift from what was shipped.
const appVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'logo.svg', 'apple-touch-icon.png', 'push-sw.js'],
      // Pull our push / notificationclick handlers into the generated SW.
      //
      // The allowlist matters more than it looks. Left to itself the generated
      // SW answers EVERY navigation with index.html, so once installed it
      // shadowed the hosted legal pages in public/legal/ — real files, and the
      // URLs a Play reviewer opens from the listing — with the app shell.
      //
      // An allowlist rather than a denylist of /legal/: a denylist has to
      // predict every static path that will ever exist, while an allowlist only
      // has to know the app's own routes, which are enumerated in one place and
      // imported here so the two cannot drift.
      workbox: {
        importScripts: ['push-sw.js'],
        navigateFallbackAllowlist: spaNavigationRoutes(),
      },
      devOptions: { enabled: true },
      manifest: {
        name: 'Smart Warning — Emergency Alert System',
        short_name: 'Smart Warning',
        description:
          'Instant emergency alerts with red warning border, flashing lights, and customizable sirens across all connected devices.',
        theme_color: '#080808',
        background_color: '#080808',
        display: 'standalone',
        icons: [
          // SVG first for hosts that take it, then raster at the two sizes
          // installers actually look for. A maskable entry is listed separately
          // rather than sharing `purpose` — a launcher that crops an "any" icon
          // would clip the exclamation off the bottom of the mark.
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: { host: true, port: 5300, strictPort: true },
});
