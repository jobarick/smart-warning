import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'logo.svg', 'apple-touch-icon.png', 'push-sw.js'],
      // Pull our push / notificationclick handlers into the generated SW.
      workbox: { importScripts: ['push-sw.js'] },
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
