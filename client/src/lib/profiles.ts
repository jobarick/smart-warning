import type { AlertType } from '../types';
import { ALERT_META, SAFETY_PROTOCOL } from '../types';

/**
 * An industry profile is a curated, relabelled view over the canonical alert
 * engine (fire / medical / security / hazard / cyber / evacuation). It changes
 * the wording, ordering, and protocol steps a sector sees — never the wire
 * protocol — so one codebase serves a hospital, a school, and a warehouse.
 */
export interface ProfileAlert {
  type: AlertType; // canonical engine type — drives icon, tone, and colour
  label: string; // sector wording, e.g. "Code Blue"
  protocol?: string[]; // sector-specific steps; falls back to SAFETY_PROTOCOL[type]
}

export interface IndustryProfile {
  id: string;
  label: string; // sector name shown in settings
  tagline: string;
  musterLabel: string; // what this sector calls the safe gathering place
  alerts: ProfileAlert[];
}

export const INDUSTRY_PROFILES: IndustryProfile[] = [
  {
    id: 'generic',
    label: 'General workplace',
    tagline: 'A sensible default for any team',
    musterLabel: 'assembly point',
    alerts: [
      { type: 'fire', label: 'Fire' },
      { type: 'medical', label: 'Medical' },
      { type: 'security', label: 'Security' },
      { type: 'hazard', label: 'Hazard' },
      { type: 'evacuation', label: 'Evacuate' },
    ],
  },
  {
    id: 'healthcare',
    label: 'Healthcare',
    tagline: 'Hospitals, clinics, care homes',
    musterLabel: 'muster point',
    alerts: [
      { type: 'medical', label: 'Code Blue', protocol: ['Start resuscitation if trained', 'Clear space around the patient', 'Send someone to guide the team in', 'Bring the crash cart'] },
      { type: 'fire', label: 'Code Red', protocol: ['Rescue anyone in immediate danger', 'Raise the alarm and close doors', 'Contain if safe, then evacuate', 'Do not use the lift'] },
      { type: 'security', label: 'Lockdown', protocol: ['Move patients to a secure area', 'Lock or barricade the door', 'Stay quiet and out of sight', 'Wait for the all-clear'] },
      { type: 'hazard', label: 'Hazmat / spill', protocol: ['Stop work and warn others', 'Move upwind and isolate the area', 'Wear the required PPE', 'Report the substance released'] },
      { type: 'evacuation', label: 'Evacuate', protocol: ['Move patients per the evacuation plan', 'Do not use the lift', 'Proceed to the muster point', 'Account for every patient and staff member'] },
    ],
  },
  {
    id: 'education',
    label: 'Education',
    tagline: 'Schools, colleges, universities',
    musterLabel: 'assembly area',
    alerts: [
      { type: 'security', label: 'Lockdown', protocol: ['Get everyone into the nearest room', 'Lock the door and turn off lights', 'Keep students quiet and away from windows', 'Wait for an official all-clear'] },
      { type: 'fire', label: 'Fire', protocol: ['Leave the building calmly', 'Do not stop for belongings', 'Follow your class to the assembly area', 'Take the register'] },
      { type: 'medical', label: 'Medical', protocol: ['Keep the person still and calm', 'Send someone for the first-aider', 'Clear onlookers', 'Guide help to the location'] },
      { type: 'hazard', label: 'Severe weather', protocol: ['Move away from windows', 'Go to the designated shelter area', 'Stay low if instructed', 'Wait for the all-clear'] },
      { type: 'evacuation', label: 'Evacuate', protocol: ['Leave immediately with your class', 'Do not use the lift', 'Go to the assembly area', 'Take the register'] },
    ],
  },
  {
    id: 'industrial',
    label: 'Industrial & construction',
    tagline: 'Factories, sites, warehouses, plants',
    musterLabel: 'muster station',
    alerts: [
      { type: 'fire', label: 'Fire', protocol: ['Stop work and raise the alarm', 'Isolate machinery if safe', 'Leave by the nearest safe route', 'Report to the muster station'] },
      { type: 'medical', label: 'Injury', protocol: ['Do not move the casualty unless in danger', 'Make the area safe', 'Send for the site first-aider', 'Preserve the scene for investigation'] },
      { type: 'hazard', label: 'Spill / release', protocol: ['Stop work and warn others', 'Move upwind of the release', 'Wear the required PPE', 'Report the substance and quantity'] },
      { type: 'security', label: 'Security', protocol: ['Move to a safe location', 'Secure the area if possible', 'Stay out of sight', 'Await instructions'] },
      { type: 'evacuation', label: 'Evacuate', protocol: ['Evacuate immediately', 'Do not use lifts or hoists', 'Follow the marked route to the muster station', 'Check in so everyone is accounted for'] },
    ],
  },
  {
    id: 'office',
    label: 'Office & retail',
    tagline: 'Offices, shops, hospitality',
    musterLabel: 'assembly point',
    alerts: [
      { type: 'medical', label: 'Medical', protocol: ['Keep the person still', 'Send someone for the first-aider', 'Clear the area around them', 'Guide help in'] },
      { type: 'fire', label: 'Fire', protocol: ['Leave by the nearest fire exit', 'Do not use the lift', 'Go to the assembly point', 'Do not re-enter'] },
      { type: 'security', label: 'Intruder', protocol: ['Move to a lockable room', 'Lock or barricade the door', 'Stay quiet and hidden', 'Wait for the all-clear'] },
      { type: 'evacuation', label: 'Evacuate', protocol: ['Leave calmly by the nearest exit', 'Do not use the lift', 'Proceed to the assembly point', 'Check in on arrival'] },
    ],
  },
];

export const DEFAULT_PROFILE_ID = 'generic';

export function getProfile(id: string): IndustryProfile {
  return INDUSTRY_PROFILES.find((p) => p.id === id) ?? INDUSTRY_PROFILES[0];
}

/** Sector label for a canonical type, falling back to the engine default. */
export function alertLabel(profile: IndustryProfile, type: AlertType): string {
  return profile.alerts.find((a) => a.type === type)?.label ?? ALERT_META[type].label;
}

/** Sector protocol steps for a type, falling back to the engine default. */
export function alertProtocol(profile: IndustryProfile, type: AlertType): string[] {
  const found = profile.alerts.find((a) => a.type === type);
  return found?.protocol ?? SAFETY_PROTOCOL[type];
}
