// Client-side web push: subscribe this device to its org's alerts so it gets a
// notification even when the app is closed. Gracefully no-ops where push isn't
// supported (e.g. iOS Safari outside an installed PWA).
import { fetchVapidKey, savePushSubscription, deletePushSubscription } from './api';

export function pushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (!pushSupported()) return 'unsupported';
  return Notification.permission;
}

// VAPID public keys are base64url; the browser wants an ArrayBuffer-backed view.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** True if this device already has an active push subscription. */
export async function isSubscribed(): Promise<boolean> {
  if (!pushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    return !!(await reg.pushManager.getSubscription());
  } catch {
    return false;
  }
}

/**
 * Ask for permission, subscribe via the service worker, and register the
 * subscription with the backend under the given org credentials. Throws with a
 * user-facing message on failure.
 */
export async function subscribe(creds: { token?: string; orgCode?: string }): Promise<void> {
  if (!pushSupported()) throw new Error('This device does not support notifications.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are blocked. Enable them in your browser settings.');

  const { enabled, publicKey } = await fetchVapidKey();
  if (!enabled || !publicKey) throw new Error('Notifications are not available on this server.');

  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  await savePushSubscription(sub.toJSON(), creds);
}

/**
 * Remove this device's subscription locally and on the backend.
 *
 * Takes the org credentials rather than reading them itself: this is called
 * from sign-out, and it awaits the service worker before it does anything, by
 * which point the session has already been cleared. The caller captures them
 * synchronously and hands them over.
 */
export async function unsubscribe(creds: { token?: string; orgCode?: string } = {}): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await deletePushSubscription(sub.endpoint, creds);
      await sub.unsubscribe();
    }
  } catch {
    /* best effort */
  }
}
