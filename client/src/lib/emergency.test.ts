// With location refused, the numbers shown must still be Tanzania's own, not
// the international fallback; a known position still decides the country.
// Offline, malformed answers and corrupted saved copies must never leave the
// panel empty, or show another country's list without a position.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ fetchDirectory: vi.fn() }));
vi.mock('./api', () => api);

import { DEFAULT_COUNTRY, LAST_RESORT, TZ_OFFLINE, initialDirectory, isUsableDirectory, resolveDirectory } from './emergency';
import { NOT_GOVERNMENT_LISTED } from './emergencyGrid';

const KEY = 'sw-emergency-directory-v1';
const tz = { country: { code: 'TZ', name: 'Tanzania', dial: '+255' }, services: [{ id: '112', label: 'Police', numbers: ['112'] }] };
const intl = { country: { code: null, name: 'International', dial: '' }, services: [{ id: 'police', label: 'Police', numbers: ['112', '911'] }] };

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
    localStorage.setItem(KEY, JSON.stringify({ at: Date.now() - 10 * 3600e3, key: 'unknown', directory: intl }));
    api.fetchDirectory.mockResolvedValue(tz);
    const { directory } = await resolveDirectory(null, null);
    expect(api.fetchDirectory).toHaveBeenCalledWith(null, null, DEFAULT_COUNTRY);
    expect(directory.country.code).toBe('TZ');
  });

  it('offline, no position, nothing saved: the bundled Tanzania copy, marked as saved', async () => {
    api.fetchDirectory.mockRejectedValue(new Error('offline'));
    const { directory, stale } = await resolveDirectory(null, null);
    expect(directory).toBe(TZ_OFFLINE);
    expect(stale).toBe(true);
  });

  it('offline with a position and nothing saved: the international floor, never empty', async () => {
    api.fetchDirectory.mockRejectedValue(new Error('offline'));
    const { directory, stale } = await resolveDirectory(-1.29, 36.82);
    expect(directory).toBe(LAST_RESORT);
    expect(stale).toBe(true);
  });

  it('offline, no position, only an old International entry saved: Tanzania, never International', async () => {
    localStorage.setItem(KEY, JSON.stringify({ at: Date.now() - 3600e3, key: 'unknown', directory: intl }));
    api.fetchDirectory.mockRejectedValue(new Error('offline'));
    const { directory } = await resolveDirectory(null, null);
    expect(directory.country.code).toBe('TZ');
  });

  it('offline, no position, an old Tanzania list saved: that list', async () => {
    localStorage.setItem(KEY, JSON.stringify({ at: Date.now() - 30 * 86400e3, key: 'unknown:TZ', directory: tz }));
    api.fetchDirectory.mockRejectedValue(new Error('offline'));
    const r = await resolveDirectory(null, null);
    expect(r.directory.country.code).toBe('TZ');
    expect(r.directory.services[0].numbers).toEqual(['112']);
  });

  it('a malformed answer is not used or saved; the bundled Tanzania copy is shown instead', async () => {
    const bad = [
      { country: { name: 'Tanzania' }, services: 'abc' },
      { services: [{ id: '112' }] },
      '<html>',
      null,
      { country: { name: 'T' }, services: [{ id: 'x', label: 'y', numbers: [] }] },
    ];
    for (const b of bad) {
      localStorage.clear();
      api.fetchDirectory.mockResolvedValue(b);
      const { directory } = await resolveDirectory(null, null);
      expect(directory).toBe(TZ_OFFLINE);
      expect(localStorage.getItem(KEY)).toBeNull();
    }
  });

  it('a corrupted saved entry is ignored and the network is asked', async () => {
    localStorage.setItem(KEY, '{"at":1,"key":"unknown:TZ","directory":{"country":{"name":"Tanzania"},"services":"x"}}');
    api.fetchDirectory.mockResolvedValue(tz);
    const { directory } = await resolveDirectory(null, null);
    expect(api.fetchDirectory).toHaveBeenCalled();
    expect(directory.services[0].id).toBe('112');
  });
});

describe('first paint and the offline copy', () => {
  it('without a position, an old International entry never shows first; Tanzania does', () => {
    localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), key: 'unknown', directory: intl }));
    expect(initialDirectory(null, null)).toBe(TZ_OFFLINE);
    localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), key: 'unknown:TZ', directory: tz }));
    expect(initialDirectory(null, null).services[0].id).toBe('112');
  });

  it('the bundled Tanzania copy holds only government-listed numbers, 112 first, 199 for health, never 117', () => {
    expect(isUsableDirectory(TZ_OFFLINE)).toBe(true);
    const nums = TZ_OFFLINE.services.map((s) => s.numbers[0]);
    expect(nums[0]).toBe('112');
    expect(nums).toContain('199');
    expect(nums).not.toContain('117');
    for (const n of nums) expect(NOT_GOVERNMENT_LISTED.has(n)).toBe(false);
    for (const s of TZ_OFFLINE.services) {
      expect(s.evidence?.level).toBe('government-listed');
      expect(s.labelSw).toBeTruthy();
    }
    expect(TZ_OFFLINE.services.find((s) => s.id === '199')!.description).toMatch(/112 or 115/);
  });
});
