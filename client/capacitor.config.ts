import type { CapacitorConfig } from '@capacitor/cli';

// Native Android shell around the same Vite build the web app ships.
//
// The webview is served from https://localhost (a secure context), so
// navigator.geolocation works here even though plain-http LAN blocks it.
// The relay/API host comes from VITE_WS_URL in .env.production, baked in at
// build time — the app talks to the hosted backend, not to its own origin.
const config: CapacitorConfig = {
  appId: 'com.smartwarning.app',
  appName: 'Smart Warning',
  webDir: 'dist',
};

export default config;
