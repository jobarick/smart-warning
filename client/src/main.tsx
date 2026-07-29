import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { PublicReport } from './components/PublicReport';
import { ErrorBoundary } from './components/ErrorBoundary';
import { VercelInsights } from './components/VercelInsights';
// Bundled, not fetched. An emergency PWA has to render identically on a locked
// -down site network or offline, so the typefaces ship with the app rather than
// coming from a font CDN. Variable weights keep that to two files.
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';
import './command-center.css';
import './platform.css';

registerSW({ immediate: true });

// /r/<site code> is the public reporting page. Routed here rather than inside
// App so it never mounts the relay socket, the alarm state, or the auth gate —
// a page anyone can open should carry none of that.
const publicCode = window.location.pathname.match(/^\/r\/([A-Za-z0-9]{4,16})\/?$/)?.[1];

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {publicCode ? <PublicReport publicCode={publicCode.toUpperCase()} /> : <App />}
      {/* Inside the boundary on purpose: if analytics ever threw during render,
          it should degrade through the same recoverable fallback as anything
          else rather than take the tree down unprotected. It renders nothing
          off Vercel — see VercelInsights. */}
      <VercelInsights />
    </ErrorBoundary>
  </StrictMode>,
);
