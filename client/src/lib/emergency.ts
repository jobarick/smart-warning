// Emergency call directory: what numbers to show, and what this device can
// actually do with them.
//
// Two things matter here and they pull in different directions. The directory
// has to be *current* — it follows the user across borders — and it has to be
// *available*, including when the network that would refresh it is the thing
// that just failed. So: fetch when we can, cache what we get, and keep a
// hard-coded last resort that ships in the bundle and can never fail to load.
import { fetchDirectory, type EmergencyDirectory, type EmergencyService } from './api';

const CACHE_KEY = 'sw-emergency-directory-v1';

/** Shown when the position is unknown. */
export const DEFAULT_COUNTRY = 'TZ';

// Bundled evidence for the offline copy below (server/emergency-numbers.js
// TZ_EVIDENCE is the source of truth; re-checked 2026-10-17).
const GOV_LISTED = (sources: string[]) => ({ level: 'government-listed' as const, checked: '2026-10-17', note: null, sources });
const GOV_PORTAL = 'https://www.tanzania.go.tz/topics/health';

/**
 * Tanzania's list for when the position is unknown AND the network is down
 * with nothing saved for Tanzania: only the numbers an official government
 * website lists, so an offline phone never offers an unconfirmed one. Shown
 * as a saved copy (stale), never as fresh.
 */
export const TZ_OFFLINE: EmergencyDirectory = {
  country: { code: 'TZ', name: 'Tanzania', dial: '+255' },
  services: ([
    ['112', 'police', 'Police', 'Polisi', 'Police emergencies', 'Dharura za kipolisi'],
    ['114', 'fire', 'Fire & Rescue', 'Zimamoto na Uokoaji', 'Fire and rescue emergencies', 'Moto na uokoaji'],
    ['115', 'ambulance', 'Ambulance · Mama na Mtoto', 'Gari la Wagonjwa · Mama na Mtoto', 'Emergency transport, especially for pregnant women and newborns', 'Usafiri wa dharura, hasa kwa mama mjamzito na mtoto mchanga'],
    ['111', 'security', 'Crime Stoppers', 'Kuzuia Uhalifu', 'Report and help prevent crime', 'Toa taarifa za uhalifu'],
    ['116', null, 'Child Helpline', 'Msaada wa Watoto', 'Child emergencies and support', 'Dharura na msaada kwa mtoto'],
    ['199', null, 'Health line (Afya)', 'Afya (Kituo cha Simu)', 'Health advice from the Ministry of Health. In a medical emergency call 112 or 115.', 'Ushauri wa afya, Wizara ya Afya. Kwa dharura ya kiafya piga 112 au 115.'],
    ['113', null, 'TAKUKURU (Anticorruption)', 'TAKUKURU', 'Report corruption', 'Kuripoti rushwa'],
    ['119', null, 'Drug Control', 'Kupambana na Dawa za Kulevya', 'Report drug related emergencies', 'Kuripoti masuala ya dawa za kulevya'],
    ['190', 'disaster', 'Zanzibar', 'Zanzibar', 'Zanzibar disaster services', 'Huduma za maafa Zanzibar'],
  ] as const).map(([n, category, label, labelSw, description, descriptionSw]): EmergencyService => ({
    id: n, numbers: [n], category, label, labelSw, description, descriptionSw,
    evidence: GOV_LISTED(n === '119' ? ['https://www.dcea.go.tz/'] : [GOV_PORTAL]),
  })),
};

/**
 * A directory is only used if it has the shape the screens need. A malformed
 * answer (a proxy's error page parsed as JSON, a truncated cache entry, a
 * string where a list belongs) must fall through to the next source rather
 * than render nothing, or crash the panel that holds the emergency numbers.
 */
export function isUsableDirectory(d: unknown): d is EmergencyDirectory {
  const dir = d as EmergencyDirectory | null;
  if (!dir || typeof dir !== 'object' || !dir.country || typeof dir.country.name !== 'string') return false;
  if (!Array.isArray(dir.services) || dir.services.length === 0) return false;
  return dir.services.every((s) => s && typeof s.id === 'string' && typeof s.label === 'string'
    && Array.isArray(s.numbers) && s.numbers.length > 0 && s.numbers.every((n) => typeof n === 'string' && n.length > 0));
}

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
  // Names the country shown without a position. Before 2026-10-16 this was
  // plain 'unknown' and held the international fallback; a new key makes
  // those week-long cache entries miss instead of hiding Tanzania's list.
  if (lat == null || lng == null) return `unknown:${DEFAULT_COUNTRY}`;
  return `${lat.toFixed(0)},${lng.toFixed(0)}`;
}

function readCache(): Cached | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cached;
    if (!parsed || typeof parsed.key !== 'string' || !Number.isFinite(parsed.at) || !isUsableDirectory(parsed.directory)) return null;
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

/**
 * What to draw on the very first paint, before anything is fetched. Without a
 * position only a saved Tanzania list counts (an old "International" entry
 * must not flash up, or stay up if the fetch hangs); otherwise the bundled
 * Tanzania copy. With a position, any saved copy is a fair first guess.
 */
export function initialDirectory(lat: number | null, lng: number | null): EmergencyDirectory {
  const cached = readCache();
  if (lat == null || lng == null) {
    return cached && cached.directory.country.code === DEFAULT_COUNTRY ? cached.directory : TZ_OFFLINE;
  }
  return cached?.directory ?? LAST_RESORT;
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
    // No position (location refused or unavailable): Tanzania's own numbers,
    // the audience this app is built for, rather than the international
    // fallback (112/911). A known position still follows the device abroad.
    const directory = lat == null || lng == null ? await fetchDirectory(null, null, DEFAULT_COUNTRY) : await fetchDirectory(lat, lng);
    if (isUsableDirectory(directory)) {
      writeCache({ at: Date.now(), key, directory });
      return { directory, stale: false };
    }
  } catch {
    // Offline, or the backend is cold. Fall through — this is exactly the case
    // the cache and the last resort exist for.
  }

  // No network. Without a position, a saved Tanzania list (of any age) or the
  // bundled Tanzania copy; never a saved list for another country.
  if (lat == null || lng == null) {
    if (cached && cached.directory.country.code === DEFAULT_COUNTRY) return { directory: cached.directory, stale: cached.key !== key };
    return { directory: TZ_OFFLINE, stale: true };
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
