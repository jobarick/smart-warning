/**
 * Every path this single-page app owns.
 *
 * Shared deliberately between the app and the build. `App.tsx` uses it to decide
 * which URLs are real destinations, and `vite.config.ts` turns it into the
 * service worker's `navigateFallbackAllowlist` — the list of navigations the SW
 * may answer from its cached `index.html` instead of going to the network.
 *
 * Those two lists have to agree. When they lived apart, the SW answered *every*
 * navigation, which meant the hosted legal pages in `public/legal/` — real files,
 * and the URLs a Play reviewer opens — rendered the app shell instead of
 * themselves. An allowlist fixes that, but only while it is complete: a route
 * added here and forgotten there would be a route that silently stops working
 * offline, which is the exact failure this file exists to prevent.
 *
 * A THIRD list has to agree too: `client/vercel.json`'s `rewrites`, one layer
 * down from the SW — only a path listed there gets `index.html` from Vercel at
 * all; anything else (a typo, a stale asset URL, a bot probe) gets a real 404
 * instead of a 200'd app shell. It cannot read this file — it's evaluated by
 * Vercel's build system before any app code runs — so it stays a plain,
 * manually-kept list that has to be updated by hand alongside this one.
 *
 * So: add a path here, and update `client/vercel.json` to match.
 */
export const SPA_PATHS = [
  '/',
  '/dashboard',
  '/get-started',
  '/demo',
  // worker tabs
  '/emergency',
  '/safety',
  '/alerts',
  '/profile',
  // overlays
  '/settings',
  '/about',
  '/support',
  '/billing',
  '/setup',
] as const;

/**
 * The public reporting page, `/r/<site code>`. Served by the app (see main.tsx)
 * but not by `App` itself, so it is listed separately from the paths above.
 */
export const PUBLIC_REPORT_PATTERN = /^\/r\/([A-Za-z0-9]{4,16})\/?$/;

/** Anchored, escaped, optional-trailing-slash matcher for one literal path. */
function exact(path: string): RegExp {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return path === '/' ? /^\/$/ : new RegExp(`^${escaped}/?$`);
}

/**
 * The workbox `navigateFallbackAllowlist`.
 *
 * Anything not matched here is left to the network — the hosted legal pages, and
 * any static file added to `public/` later, without needing to be named.
 */
export function spaNavigationRoutes(): RegExp[] {
  return [...SPA_PATHS.map(exact), PUBLIC_REPORT_PATTERN];
}
