import { Capacitor } from '@capacitor/core';
import { registerDeviceToken, unregisterDeviceToken } from './api';

/**
 * Native push registration for the Android app.
 *
 * Web Push already covers browsers, and does not work here: a Capacitor webview
 * has no push service of its own. Without this, closing the app makes a worker
 * unreachable — and closed is the normal state of an app between emergencies,
 * so this is the difference between an alerting product and a dashboard.
 *
 * Two constraints shape the code:
 *
 *  - **One bundle, three targets.** The same build is served from Render, from
 *    Vercel and from inside the APK, so the platform check has to happen at
 *    runtime. Nothing here may run in a browser.
 *  - **The plugin is imported lazily.** A static import would pull the plugin
 *    into the web bundle for the majority of users who can never use it.
 */

const TOKEN_KEY = 'sw-device-token-v1';

type PushPlugin = typeof import('@capacitor/push-notifications')['PushNotifications'];

export function nativePushSupported(): boolean {
  return Capacitor.isNativePlatform();
}

async function plugin(): Promise<PushPlugin | null> {
  if (!nativePushSupported()) return null;
  try {
    const mod = await import('@capacitor/push-notifications');
    return mod.PushNotifications;
  } catch {
    // Plugin not installed in this build — the web bundle path.
    return null;
  }
}

/** The token this device last registered, if any. */
export function currentToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Two channels, because Android lets the user silence them independently and
 * those two decisions are not the same decision.
 *
 * `sw_emergency` is IMPORTANCE_HIGH: it heads-up, sounds and vibrates, and is
 * what a critical or high-severity alert arrives on. `sw_alerts` carries
 * everything else — advisories, stand-downs — so someone who mutes routine
 * traffic has not also muted the evacuation. The ids match the `channel_id`
 * the server sets in server/fcm.js; they must be changed together.
 */
const CHANNELS = [
  {
    id: 'sw_emergency',
    name: 'Emergency alerts',
    description: 'Evacuations, fire, medical and security alarms. Do not disable.',
    importance: 5 as const,
    visibility: 1 as const,
    vibration: true,
    sound: 'default',
  },
  {
    id: 'sw_alerts',
    name: 'Advisories and updates',
    description: 'Standing advisories, all-clears and routine site updates.',
    importance: 4 as const,
    visibility: 1 as const,
    vibration: true,
  },
];

async function ensureChannels(Push: PushPlugin): Promise<void> {
  for (const channel of CHANNELS) {
    // Creating an existing channel is a no-op, and its settings cannot be
    // changed once the user has adjusted them — which is the correct behaviour,
    // not a limitation to work around.
    await Push.createChannel(channel).catch(() => {});
  }
}

export interface RegisterResult {
  status: 'registered' | 'denied' | 'unsupported' | 'error';
  token?: string;
  /** 'pending-credentials' means the server accepted the token but cannot send yet. */
  delivery?: 'active' | 'pending-credentials';
  error?: string;
}

/**
 * Ask for permission, register with FCM, and hand the token to the backend.
 *
 * Safe to call repeatedly — FCM returns the same token, and the server upsert
 * is keyed on it. Listeners are attached once per call and removed first, so a
 * re-register after a sign-in does not double-fire.
 */
export async function registerForPush(creds: { token?: string; orgCode?: string }, label?: string): Promise<RegisterResult> {
  const Push = await plugin();
  if (!Push) return { status: 'unsupported' };

  try {
    let perm = await Push.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await Push.requestPermissions();
    }
    if (perm.receive !== 'granted') return { status: 'denied' };

    await ensureChannels(Push);
    await Push.removeAllListeners();

    const token = await new Promise<string>((resolve, reject) => {
      // FCM hands the token back asynchronously through an event rather than
      // from register(), so the promise is settled by whichever listener fires.
      const timeout = setTimeout(() => reject(new Error('timed out waiting for a push token')), 20_000);
      Push.addListener('registration', (t) => {
        clearTimeout(timeout);
        resolve(t.value);
      });
      Push.addListener('registrationError', (e) => {
        clearTimeout(timeout);
        reject(new Error(String(e?.error || 'registration failed')));
      });
      Push.register().catch((e) => {
        clearTimeout(timeout);
        reject(e);
      });
    });

    const res = await registerDeviceToken(token, creds, { platform: Capacitor.getPlatform(), label });
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* storage is a convenience here, not a requirement */
    }
    return { status: 'registered', token, delivery: res.delivery };
  } catch (e) {
    return { status: 'error', error: e instanceof Error ? e.message : 'registration failed' };
  }
}

/**
 * Stop this device receiving the current org's alerts.
 *
 * Called on sign-out. Unregistering server-side matters more than locally:
 * leaving a token attached to an org someone has left would keep delivering
 * that site's emergencies to a phone that is no longer part of it.
 */
export async function unregisterFromPush(): Promise<void> {
  const token = currentToken();
  if (token) await unregisterDeviceToken(token);
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
  const Push = await plugin();
  if (Push) await Push.removeAllListeners().catch(() => {});
}

/**
 * Wire up what happens when a notification arrives.
 *
 * `onAction` fires when the user taps one. The relay is the authority on state,
 * so tapping only needs to bring the app forward — the socket reconciles the
 * rest — but the callback is here so a deep link can be added without touching
 * this file's registration logic.
 */
export async function attachHandlers(handlers: {
  onReceived?: (data: Record<string, unknown>) => void;
  onAction?: (data: Record<string, unknown>) => void;
}): Promise<void> {
  const Push = await plugin();
  if (!Push) return;
  if (handlers.onReceived) {
    await Push.addListener('pushNotificationReceived', (n) => handlers.onReceived!(n.data ?? {}));
  }
  if (handlers.onAction) {
    await Push.addListener('pushNotificationActionPerformed', (a) => handlers.onAction!(a.notification?.data ?? {}));
  }
}
