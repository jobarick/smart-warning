import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      devOptions: { enabled: true },
      manifest: {
        name: 'Smart Emergency Warning & Threat Alert System',
        short_name: 'Alert System',
        description:
          'Instant emergency alerts with red warning border, flashing lights, and customizable sirens across all connected devices.',
        theme_color: '#060608',
        background_color: '#060608',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
    }),
  ],
  server: { host: true, port: 5300, strictPort: true },
});
