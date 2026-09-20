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
    description: 'Standing advisories, all clears and routine site updates.',
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
 * The credentials/label from the most recent successful registerForPush()
 * call. FCM can reissue a token at any time — not just on reinstall — while
 * the app process stays alive, well after the call that originally requested
 * registration has already returned and its promise has settled. The
 * 'registration' listener attached below stays live for the rest of the
 * session to catch exactly that, and needs somewhere to find the credentials
 * a *later*, unprompted token belongs to, since nothing else asks for it
 * again. Cleared on sign-out so a straggling event after that finds nothing
 * to register against instead of registering a departed user's new token.
 */
let activeCreds: { token?: string; orgCode?: string } | null = null;
let activeLabel: string | undefined;

/** Hand a newly issued or refreshed token to the backend, and remember it locally. */
async function persistToken(Push: PushPlugin, token: string): Promise<void> {
  if (!activeCreds) return; // signed out since the listener was attached
  try {
    await registerDeviceToken(token, activeCreds, { platform: Capacitor.getPlatform(), label: activeLabel });
    localStorage.setItem(TOKEN_KEY, token);
  } catch (e) {
    console.warn('[push] could not register a refreshed token:', e instanceof Error ? e.message : e);
  }
  void Push; // kept in the signature for symmetry with the call site; unused today
}

/**
 * Ask for permission, register with FCM, and hand the token to the backend.
 *
 * Safe to call repeatedly — FCM returns the same token, and the server upsert
 * is keyed on it. Listeners are removed and re-attached on every call, so a
 * re-register after a sign-in does not double-fire.
 *
 * The 'registration' listener attached here is NOT scoped to this one call,
 * even though the promise it settles is. FCM's token-refresh event reuses the
 * exact same event name and fires for the life of the listener, not once per
 * register() invocation — so it keeps firing long after this function has
 * returned. A version of this that only resolved a promise and then let the
 * listener go stale silently dropped every later refresh: the device kept
 * using an old token until the app process was killed and relaunched (which
 * is the only other thing that re-runs this function), with no error raised
 * anywhere in between. Every firing after the first therefore still persists
 * the token — it just no longer needs to settle anything.
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

    activeCreds = creds;
    activeLabel = label;

    const token = await new Promise<string>((resolve, reject) => {
      // FCM hands the token back asynchronously through an event rather than
      // from register(), so the promise is settled by whichever listener fires
      // first. See this function's own doc comment for why the listener
      // itself outlives that settlement.
      const timeout = setTimeout(() => reject(new Error('timed out waiting for a push token')), 20_000);
      let settled = false;
      Push.addListener('registration', (t) => {
        if (settled) { void persistToken(Push, t.value); return; }
        settled = true;
        clearTimeout(timeout);
        resolve(t.value);
      });
      Push.addListener('registrationError', (e) => {
        if (settled) return; // a later, unrelated registration hiccup — this call is long done
        settled = true;
        clearTimeout(timeout);
        reject(new Error(String(e?.error || 'registration failed')));
      });
      Push.register().catch((e) => {
        if (settled) return;
        settled = true;
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
export async function unregisterFromPush(
  creds: { token?: string; orgCode?: string } = {},
): Promise<void> {
  const token = currentToken();
  if (token) await unregisterDeviceToken(token, creds);
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
  // Belt and suspenders alongside removeAllListeners() below: a 'registration'
  // event already in flight when sign-out happens would otherwise still find
  // activeCreds set and register this device's new token against an account
  // that just signed out.
  activeCreds = null;
  activeLabel = undefined;
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
