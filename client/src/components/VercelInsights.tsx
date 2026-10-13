import { lazy, Suspense } from 'react';

// Both scripts are measurement, never safety: their own chunk, fetched after
// the app is up, so they never compete with the SOS screen for a slow link.
const Insights = lazy(async () => {
  const [{ Analytics }, { SpeedInsights }] = await Promise.all([
    import('@vercel/analytics/react'),
    import('@vercel/speed-insights/react'),
  ]);
  return { default: () => (<><Analytics /><SpeedInsights /></>) };
});

/**
 * Vercel Web Analytics + Speed Insights, mounted only where they can work.
 *
 * The same `vite build` output is served from three places: Vercel, the Render
 * one-service host, and bundled inside the Android APK. Both Vercel components
 * inject a script from a `/_vercel/...` path that only exists on Vercel's edge,
 * so mounting them unconditionally would fire a guaranteed-404 request — and a
 * console error — on Render and on every phone that opens the app.
 *
 * The check is deliberately a denylist rather than an `endsWith('.vercel.app')`
 * allowlist: that way a custom domain added to the Vercel project later keeps
 * reporting, instead of silently going dark.
 *
 * Note this has to be a runtime check, not a build-time flag. One build
 * artifact is deployed to all three targets, so there is no compile step that
 * could know where it will end up.
 */
function onVercel(): boolean {
  if (typeof window === 'undefined') return false;

  // The Capacitor native shell serves from https://localhost — never Vercel.
  if (typeof (window as unknown as { Capacitor?: unknown }).Capacitor !== 'undefined') return false;

  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '' || host.endsWith('.local')) return false;
  if (host.endsWith('.onrender.com')) return false;

  return true;
}

export function VercelInsights() {
  if (!onVercel()) return null;
  return (
    <Suspense fallback={null}>
      <Insights />
    </Suspense>
  );
}
