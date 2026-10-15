// When a new version of the app may take over the page.
//
// The service worker is in autoUpdate mode: when a new deploy activates, the
// plugin reloads every open page. Alarm state lives in memory, so a reload in
// the middle of an emergency would clear the alarm screen, the "seen by" news
// and the fallback buttons on every phone at once, because of a deploy. This
// holds that reload while something urgent is on screen and runs it the moment
// it is not.
//
// It also asks for updates on a timer and when the app comes back to the
// foreground: an installed app that stays open for days never navigates, so
// without this it would keep running the old version indefinitely.
//
// No React and no imports, so the light Quick SOS page can use it too.

let held = false;
let pending = false;
let doReload: () => void = () => window.location.reload();

/** For tests. */
export function _resetUpdateGate(reload?: () => void) {
  held = false;
  pending = false;
  doReload = reload ?? (() => window.location.reload());
}

/** True while an alarm, an SOS being sent, or its fallback is on screen. */
export function holdUpdates(on: boolean) {
  held = on;
  if (!on && pending) {
    pending = false;
    doReload();
  }
}

/** Passed to registerSW as onNeedReload: reload now, or once nothing is held. */
export function newVersionReady() {
  if (held) pending = true;
  else doReload();
}

export function reloadPending() {
  return pending;
}

export const UPDATE_CHECK_MS = 30 * 60 * 1000;

/** Passed to registerSW as onRegisteredSW. */
export function checkForUpdates(_swUrl: string, registration: ServiceWorkerRegistration | undefined) {
  if (!registration) return;
  const check = () => {
    if (navigator.onLine === false) return;
    registration.update().catch(() => { /* offline or flaky: next check */ });
  };
  setInterval(check, UPDATE_CHECK_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}
