import { Capacitor } from '@capacitor/core';

/**
 * True inside the Android/iOS shell, false in a browser.
 *
 * `nativePushSupported()` in lib/nativePush.ts asks the same question of
 * Capacitor, but it is named for what it gates. Callers that need the platform
 * itself — the landing page, which exists to convince a stranger to install
 * something they have, by definition, already installed — should say so.
 */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}
