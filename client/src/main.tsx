import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { VercelInsights } from './components/VercelInsights';
import { PUBLIC_REPORT_PATTERN } from './lib/routes';
import { registerNativeBackButton } from './lib/nativeBack';
import { loadLocale } from './lib/i18n';
import { loadSettings } from './lib/settings';
// Bundled, not fetched. An emergency PWA has to render identically on a locked
// -down site network or offline, so the typeface ships with the app rather than
// coming from a font CDN. One variable file: the monospace face that used to
// ship alongside it was ~40KB for timers and IDs, and the system monospace
// (see --mono in styles.css) does that job on a low-bandwidth first load.
import '@fontsource-variable/dm-sans';
import './styles.css';
import './command-center.css';
import './platform.css';
import './billing.css';
import './landing.css';
import './demo.css';
import './home.css';

registerSW({ immediate: true });
registerNativeBackButton();

// /r/<site code> is the public reporting page. Routed here rather than inside
// App so it never mounts the relay socket, the alarm state, or the auth gate —
// a page anyone can open should carry none of that.
const publicCode = window.location.pathname.match(PUBLIC_REPORT_PATTERN)?.[1];
// Its own chunk: only a visitor to /r/<code> ever needs it.
const PublicReport = lazy(() => import('./components/PublicReport').then((m) => ({ default: m.PublicReport })));

function render() {
  createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {publicCode ? (
        <Suspense fallback={null}><PublicReport publicCode={publicCode.toUpperCase()} /></Suspense>
      ) : <App />}
      {/* Inside the boundary on purpose: if analytics ever threw during render,
          it should degrade through the same recoverable fallback as anything
          else rather than take the tree down unprotected. It renders nothing
          off Vercel — see VercelInsights. */}
      <VercelInsights />
    </ErrorBoundary>
  </StrictMode>,
  );
}

// Kiswahili is in this bundle; English, when it is the saved choice, is one
// small precached chunk. Waiting for it (bounded) avoids a first paint in the
// wrong language; a slow or failed fetch still renders, in Kiswahili.
if (loadSettings().locale === 'en') {
  void Promise.race([loadLocale('en'), new Promise((r) => setTimeout(r, 800))]).then(render);
} else {
  render();
}
