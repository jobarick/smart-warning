import { describe, expect, it } from 'vitest';
import { describePosition, STALE_POSITION_MS } from './position';

const now = 10_000_000;

describe('describePosition', () => {
  it('says plainly when no position was shared, and never invents one', () => {
    const d = describePosition({ lat: null, lng: null, accuracy: null, updatedAt: now }, now);
    expect(d.coords).toBeNull();
    expect(d.mapUrl).toBeNull();
    expect(d.accuracy).toBe('no position shared');
  });

  it('carries the accuracy and the age with the coordinates', () => {
    const d = describePosition({ lat: -6.79241, lng: 39.20832, accuracy: 24.6, updatedAt: now - 12_000 }, now);
    expect(d.coords).toBe('-6.7924, 39.2083');
    expect(d.accuracy).toBe('±25 m');
    expect(d.age).toBe('12s ago');
    expect(d.stale).toBe(false);
    expect(d.rough).toBe(false);
  });

  it('flags an old fix as stale', () => {
    const d = describePosition({ lat: 1, lng: 2, accuracy: 10, updatedAt: now - STALE_POSITION_MS - 1 }, now);
    expect(d.stale).toBe(true);
    expect(d.age).toBe('1m ago');
  });

  it('treats an unknown or wide accuracy as rough', () => {
    expect(describePosition({ lat: 1, lng: 2, accuracy: null, updatedAt: now }, now).rough).toBe(true);
    expect(describePosition({ lat: 1, lng: 2, accuracy: 450, updatedAt: now }, now).rough).toBe(true);
    expect(describePosition({ lat: 1, lng: 2, accuracy: null, updatedAt: now }, now).accuracy).toBe('accuracy unknown');
  });

  it('shows more decimals only when the fix is precise enough for them', () => {
    expect(describePosition({ lat: 1.123456, lng: 2.123456, accuracy: 5, updatedAt: now }, now).coords).toBe('1.12346, 2.12346');
  });
});

describe('directionsUrl', () => {
  it('opens Google Maps directions to the point, from the phone\'s own location', async () => {
    const { directionsUrl } = await import('./position');
    expect(directionsUrl(-6.7924, 39.2083)).toBe('https://www.google.com/maps/dir/?api=1&destination=-6.792400,39.208300&travelmode=driving');
    expect(directionsUrl(1, 2, 'walking')).toContain('travelmode=walking');
  });
});
