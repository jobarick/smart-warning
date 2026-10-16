import { Capacitor } from '@capacitor/core';
import { registerSW } from 'virtual:pwa-register';
import { checkForUpdates, newVersionReady } from './updateGate';

/**
 * The offline service worker is for the website. Inside the Android app the
 * code already ships in the APK, and a service worker there serves whatever
 * it cached from the PREVIOUS install: an app update would keep running old
 * code (seen on an emulator: a fixed build still ran the old bundle). So in the
 * app it is never registered, and one left by an earlier build is removed.
 */
export function startServiceWorker(): void {
  if (Capacitor.isNativePlatform()) {
    void retireServiceWorker().then((removed) => { if (removed) window.location.reload(); });
    return;
  }
  // A new version never reloads a phone mid-alarm (see lib/updateGate.ts).
  registerSW({ immediate: true, onNeedReload: newVersionReady, onRegisteredSW: checkForUpdates });
}

/**
 * Unregisters every service worker and clears their caches. Resolves true
 * only if this page was being served by one, so the caller reloads once onto
 * the bundled code; the reloaded page has no controller and stops there.
 */
export async function retireServiceWorker(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  try {
    const controlled = !!navigator.serviceWorker.controller;
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    return controlled;
  } catch {
    return false;
  }
}
