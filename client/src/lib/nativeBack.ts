import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

/**
 * Android hardware back button. A no-op on web/PWA — Capacitor.isNativePlatform()
 * is false there, so the browser's own back button (already handled by
 * useRoute's popstate listener) is untouched.
 *
 * `canGoBack` comes from the native WebView itself (webView.canGoBack()), so
 * this defers to the same history stack useRoute() already drives rather than
 * tracking a second notion of "how deep in the app am I".
 */
export function registerNativeBackButton() {
  if (!Capacitor.isNativePlatform()) return;
  App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else void App.exitApp();
  });
}
