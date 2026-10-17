// A directory request that hangs must give up, so the emergency numbers panel
// falls back to its saved or bundled list instead of waiting forever.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DIRECTORY_TIMEOUT_MS, fetchDirectory } from './api';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('fetchDirectory', () => {
  it('aborts after the timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    const p = fetchDirectory(null, null, 'TZ');
    const assertion = expect(p).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(DIRECTORY_TIMEOUT_MS + 10);
    await assertion;
  });

  it('asks for the country it is given', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ country: { name: 'Tanzania' }, services: [] }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    await fetchDirectory(null, null, 'TZ');
    expect(String((f.mock.calls[0] as unknown[])[0])).toContain('country=TZ');
  });
});
