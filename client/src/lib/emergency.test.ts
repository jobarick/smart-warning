// With location refused, the numbers shown must still be Tanzania's own, not
// the international fallback; a known position still decides the country.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ fetchDirectory: vi.fn() }));
vi.mock('./api', () => api);

import { DEFAULT_COUNTRY, LAST_RESORT, resolveDirectory } from './emergency';

const tz = { country: { code: 'TZ', name: 'Tanzania', dial: '+255' }, services: [{ id: '112', label: 'Police', numbers: ['112'] }] };

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.clearAllMocks(); });

describe('resolveDirectory', () => {
  it('location refused: asks for Tanzania, not the international fallback', async () => {
    api.fetchDirectory.mockResolvedValue(tz);
    const { directory } = await resolveDirectory(null, null);
    expect(api.fetchDirectory).toHaveBeenCalledWith(null, null, DEFAULT_COUNTRY);
    expect(directory.country.code).toBe('TZ');
  });

  it('with a position: the position decides', async () => {
    api.fetchDirectory.mockResolvedValue(tz);
    await resolveDirectory(-1.29, 36.82);
    expect(api.fetchDirectory).toHaveBeenCalledWith(-1.29, 36.82);
  });

  it('an old "unknown" cache entry holding the international list is not trusted', async () => {
    const intl = { country: { code: null, name: 'International', dial: '' }, services: [{ id: 'police', label: 'Police', numbers: ['112', '911'] }] };
    localStorage.setItem('sw-emergency-directory-v1', JSON.stringify({ at: Date.now() - 10 * 3600e3, key: 'unknown', directory: intl }));
    api.fetchDirectory.mockResolvedValue(tz);
    const { directory } = await resolveDirectory(null, null);
    expect(api.fetchDirectory).toHaveBeenCalledWith(null, null, DEFAULT_COUNTRY);
    expect(directory.country.code).toBe('TZ');
  });

  it('offline with nothing cached: the bundled last resort, never empty', async () => {
    api.fetchDirectory.mockRejectedValue(new Error('offline'));
    const { directory, stale } = await resolveDirectory(null, null);
    expect(directory).toBe(LAST_RESORT);
    expect(stale).toBe(true);
  });
});
