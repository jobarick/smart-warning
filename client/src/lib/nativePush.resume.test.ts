// A tester who declined notifications, then allowed them in Android Settings
// and came back to the app, stayed unregistered until the process was killed:
// registration only ran when the session started. It now retries when the
// app returns to the foreground, without ever prompting from there.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } }));

const state = vi.hoisted(() => ({
  permission: 'denied' as string,
  appStateListeners: [] as Array<(s: { isActive: boolean }) => void>,
  pushListeners: {} as Record<string, Array<(e: { value?: string; error?: string }) => void>>,
}));

const push = vi.hoisted(() => ({
  checkPermissions: vi.fn(async () => ({ receive: state.permission })),
  requestPermissions: vi.fn(async () => ({ receive: state.permission })),
  createChannel: vi.fn(async () => {}),
  removeAllListeners: vi.fn(async () => { state.pushListeners = {}; }),
  addListener: vi.fn(async (event: string, fn: (e: { value?: string }) => void) => {
    (state.pushListeners[event] ??= []).push(fn);
    return { remove: async () => {} };
  }),
  register: vi.fn(async () => {
    queueMicrotask(() => state.pushListeners.registration?.forEach((fn) => fn({ value: 'fcm-token-1' })));
  }),
}));
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: push }));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (_event: string, fn: (s: { isActive: boolean }) => void) => {
      state.appStateListeners.push(fn);
      return { remove: async () => { state.appStateListeners = state.appStateListeners.filter((l) => l !== fn); } };
    }),
  },
}));

const api = vi.hoisted(() => ({
  registerDeviceToken: vi.fn(async () => ({ delivery: 'active' as const })),
  unregisterDeviceToken: vi.fn(async () => {}),
}));
vi.mock('./api', () => api);

import { act, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { ensurePushRegistered, lastPushResult, retryPushOnForeground, unregisterFromPush } from './nativePush';
import { PushToggle } from '../components/PushToggle';

const creds = { token: 'session-token' };

/** Let the lazy imports and listener attachment inside the module settle. */
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };

function resume() {
  for (const fn of [...state.appStateListeners]) fn({ isActive: true });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('native push retry on resume', () => {
  let stop: () => void = () => {};

  beforeEach(async () => {
    await unregisterFromPush(creds);
    localStorage.clear();
    state.appStateListeners = [];
    vi.clearAllMocks();
  });

  afterEach(() => stop());

  it('registers once after notifications are allowed in Settings and the app resumes', async () => {
    state.permission = 'denied';
    const first = await ensurePushRegistered(creds, 'Gate 2', { force: true });
    expect(first.status).toBe('denied');
    expect(api.registerDeviceToken).not.toHaveBeenCalled();

    stop = retryPushOnForeground(() => ({ creds, label: 'Gate 2' }));
    await flush();

    // Still denied: a resume checks, but never prompts and never registers.
    resume();
    await flush();
    expect(push.requestPermissions).not.toHaveBeenCalled();
    expect(api.registerDeviceToken).not.toHaveBeenCalled();

    // The tester switches notifications on in Android Settings and comes back.
    // appStateChange and visibilitychange both fire; only one attempt runs.
    state.permission = 'granted';
    resume();
    await flush();
    expect(api.registerDeviceToken).toHaveBeenCalledTimes(1);
    expect(api.registerDeviceToken).toHaveBeenCalledWith('fcm-token-1', creds, { platform: 'android', label: 'Gate 2' });
    expect(lastPushResult()?.status).toBe('registered');
    expect(push.requestPermissions).not.toHaveBeenCalled();
  });

  it('does not re-register on every resume once registered', async () => {
    state.permission = 'granted';
    stop = retryPushOnForeground(() => ({ creds, label: 'Gate 2' }));
    await ensurePushRegistered(creds, 'Gate 2', { force: true });
    await flush();
    expect(api.registerDeviceToken).toHaveBeenCalledTimes(1);

    resume();
    resume();
    resume();
    await flush();
    expect(api.registerDeviceToken).toHaveBeenCalledTimes(1);
    expect(push.register).toHaveBeenCalledTimes(1);
  });

  it('prompts only on the first registration, and only while Android still allows a prompt', async () => {
    state.permission = 'prompt';
    await ensurePushRegistered(creds, 'Gate 2', { force: true });
    expect(push.requestPermissions).toHaveBeenCalledTimes(1);

    stop = retryPushOnForeground(() => ({ creds, label: 'Gate 2' }));
    await flush();
    // Closing the system dialog resumes the app. That must not reopen it.
    resume();
    resume();
    await flush();
    expect(push.requestPermissions).toHaveBeenCalledTimes(1);
  });

  it('removes its listeners when stopped, so a later session does not stack them', async () => {
    state.permission = 'denied';
    await ensurePushRegistered(creds, 'Gate 2', { force: true });
    stop = retryPushOnForeground(() => ({ creds, label: 'Gate 2' }));
    await flush();
    expect(state.appStateListeners).toHaveLength(1);
    stop();
    await flush();
    expect(state.appStateListeners).toHaveLength(0);

    state.permission = 'granted';
    resume();
    await flush();
    expect(push.checkPermissions).toHaveBeenCalledTimes(1); // only the initial attempt
    expect(api.registerDeviceToken).not.toHaveBeenCalled();
  });
});

describe('alerts button inside the Android app', () => {
  beforeEach(async () => {
    await unregisterFromPush(creds);
    localStorage.clear();
  });

  it('never reads "Alerts on" while notifications are denied, and flips once registered', async () => {
    state.permission = 'denied';
    render(createElement(PushToggle, { creds, label: 'Gate 2' }));
    await act(async () => { await ensurePushRegistered(creds, 'Gate 2', { force: true }); });
    expect(screen.queryByText('Alerts on')).toBeNull();
    expect(screen.getByText('Alerts off')).toBeTruthy();

    state.permission = 'granted';
    await act(async () => { await ensurePushRegistered(creds, 'Gate 2'); await flush(); });
    expect(screen.getByText('Alerts on')).toBeTruthy();
  });
});
