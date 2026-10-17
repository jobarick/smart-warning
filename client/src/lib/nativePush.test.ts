// The Capacitor plugin is a proxy that answers every property, `then`
// included, and on Android calling proxy.then() throws. Returning it as a
// promise's value broke native push registration on every device; it must
// come back wrapped.
import { describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } }));

const proxy = new Proxy({}, {
  get(_t, prop) {
    if (prop === 'then') return () => { throw new Error('"PushNotifications.then()" is not implemented on android'); };
    return async () => ({ receive: 'granted' });
  },
});
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: proxy }));

import { _loadPluginForTest } from './nativePush';

describe('native push plugin loading', () => {
  it('resolves with the plugin wrapped, never by resolving a promise with the proxy itself', async () => {
    const loaded = await _loadPluginForTest();
    expect(loaded).not.toBeNull();
    expect(loaded!.push).toBe(proxy);
  });
});
