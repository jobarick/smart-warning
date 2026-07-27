import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { PublicReport } from './components/PublicReport';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';

registerSW({ immediate: true });

// /r/<site code> is the public reporting page. Routed here rather than inside
// App so it never mounts the relay socket, the alarm state, or the auth gate —
// a page anyone can open should carry none of that.
const publicCode = window.location.pathname.match(/^\/r\/([A-Za-z0-9]{4,16})\/?$/)?.[1];

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {publicCode ? <PublicReport publicCode={publicCode.toUpperCase()} /> : <App />}
    </ErrorBoundary>
  </StrictMode>,
);
