// Emergency call directory: what numbers to show, and what this device can
// actually do with them.
//
// Two things matter here and they pull in different directions. The directory
// has to be *current* — it follows the user across borders — and it has to be
// *available*, including when the network that would refresh it is the thing
// that just failed. So: fetch when we can, cache what we get, and keep a
// hard-coded last resort that ships in the bundle and can never fail to load.
import { fetchDirectory, type EmergencyDirectory } from './api';

const CACHE_KEY = 'sw-emergency-directory-v1';

/**
 * The floor. 112 is the GSM-standard emergency number and 911 is accepted by
 * most networks that don't use it; a handset will usually route either to a
 * local dispatcher even with no SIM. This is what shows when everything else
 * has failed, and it is deliberately never empty.
 */
export const LAST_RESORT: EmergencyDirectory = {
  country: { code: null, name: 'International', dial: '' },
  services: [
    { id: 'police', label: 'Police', numbers: ['112', '911'] },
    { id: 'fire', label: 'Fire', numbers: ['112'] },
    { id: 'ambulance', label: 'Ambulance', numbers: ['112'] },
  ],
};

interface Cached {
  at: number;
  key: string; // coarse position the directory was fetched for
  directory: EmergencyDirectory;
}

// ~100km. Fine enough that crossing a border re-fetches, coarse enough that
// ordinary movement doesn't.
function posKey(lat: number | null, lng: number | null): string {
  if (lat == null || lng == null) return 'unknown';
  return `${lat.toFixed(0)},${lng.toFixed(0)}`;
}

function readCache(): Cached | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cached;
    if (!parsed?.directory?.services?.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(entry: Cached) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Private mode / quota — the in-memory result for this session still works.
  }
}

/** The cached directory, if there is one. Used to render instantly on boot. */
export function cachedDirectory(): EmergencyDirectory | null {
  return readCache()?.directory ?? null;
}

/**
 * Resolve the directory for a position.
 *
 * Order: a cache entry for this area (instant, offline-safe) → the network →
 * any stale cache → the bundled last resort. The caller always gets something
 * dialable; `stale` says whether it reflects the current position.
 */
export async function resolveDirectory(
  lat: number | null,
  lng: number | null,
): Promise<{ directory: EmergencyDirectory; stale: boolean }> {
  const key = posKey(lat, lng);
  const cached = readCache();

  // Same area and fresh enough — no reason to ask again.
  if (cached && cached.key === key && Date.now() - cached.at < 7 * 24 * 60 * 60 * 1000) {
    return { directory: cached.directory, stale: false };
  }

  try {
    const directory = await fetchDirectory(lat, lng);
    if (directory?.services?.length) {
      writeCache({ at: Date.now(), key, directory });
      return { directory, stale: false };
    }
  } catch {
    // Offline, or the backend is cold. Fall through — this is exactly the case
    // the cache and the last resort exist for.
  }

  if (cached) return { directory: cached.directory, stale: cached.key !== key };
  return { directory: LAST_RESORT, stale: true };
}

/**
 * Can this device place a phone call?
 *
 * Native Android (Capacitor) and mobile browsers can hand `tel:` to a dialler.
 * A desktop browser usually cannot do anything useful with it, so the UI offers
 * contact alternatives there instead of a button that silently does nothing.
 */
export function canDial(): boolean {
  if (typeof navigator === 'undefined') return false;
  // Capacitor injects this global in the native shell.
  const native = typeof (window as unknown as { Capacitor?: unknown }).Capacitor !== 'undefined';
  if (native) return true;
  const ua = navigator.userAgent || '';
  const mobileUA = /Android|iPhone|iPad|iPod|Windows Phone|Mobile/i.test(ua);
  const coarsePointer = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return mobileUA || coarsePointer;
}

/** Strip formatting so `tel:` gets something a dialler will accept. */
export function telHref(number: string): string {
  return `tel:${number.replace(/[^\d+*#]/g, '')}`;
}

/**
 * A number is only dialable as typed if it is actually digits. Some published
 * "numbers" are vanity strings (the Philippine coast guard's 0917PCGUARD); those
 * are shown, but not turned into a call button that would fail.
 */
export function isDialable(number: string): boolean {
  return /^[+]?[\d\s()\-.]{3,}$/.test(number);
}

/** Icon hint per service category, kept out of the components. */
export const SERVICE_ICON: Record<string, string> = {
  police: 'shield-alert',
  fire: 'flame',
  ambulance: 'medical',
  disaster: 'hazard',
  coastguard: 'siren',
  security: 'lock',
  utility: 'hazard',
};
