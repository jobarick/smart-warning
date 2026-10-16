// Inside the Android app the offline service worker served the previous
// install's code after an update. It is now website-only, and the app removes
// one an earlier build left behind, reloading once onto the bundled code.
import { afterEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ on: false }));
const sw = vi.hoisted(() => ({ registerSW: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.on } }));
vi.mock('virtual:pwa-register', () => sw);

import { retireServiceWorker, startServiceWorker } from './serviceWorker';

function fakeNavigator(controlled: boolean) {
  const unregister = vi.fn(async () => true);
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { controller: controlled ? {} : null, getRegistrations: async () => [{ unregister }, { unregister }] },
  });
  const del = vi.fn(async () => true);
  Object.defineProperty(window, 'caches', { configurable: true, value: { keys: async () => ['workbox-precache-v2', 'tiles'], delete: del } });
  return { unregister, del };
}

afterEach(() => { vi.clearAllMocks(); native.on = false; });

describe('service worker', () => {
  it('on the website: registered as before', () => {
    startServiceWorker();
    expect(sw.registerSW).toHaveBeenCalledTimes(1);
  });

  it('in the Android app: never registered', () => {
    native.on = true;
    fakeNavigator(false);
    startServiceWorker();
    expect(sw.registerSW).not.toHaveBeenCalled();
  });

  it('removes a leftover worker and its caches, and asks for one reload only if it was serving the page', async () => {
    const { unregister, del } = fakeNavigator(true);
    expect(await retireServiceWorker()).toBe(true);
    expect(unregister).toHaveBeenCalledTimes(2);
    expect(del).toHaveBeenCalledTimes(2);
    fakeNavigator(false);
    expect(await retireServiceWorker()).toBe(false);
  });
});
