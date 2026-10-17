import type { EmergencyService } from './api';
import type { IconName } from '../components/Icon';

/**
 * One row of Tanzania's short-code directory (server/emergency-numbers.js,
 * `richServices`) plus the professional icon it renders with — shared between
 * the public landing page's grid and the signed-in Home tab's grid, which show
 * different subsets of the same numbers in a different order. See each grid's
 * own GRID_IDS for which ids it shows and in what order.
 *
 * Icons come from the app's own Icon component, never emoji: an emergency and
 * safety product reads as a serious public-safety interface, not a chat app.
 */
export type EmergencyGridService = EmergencyService & { iconName: IconName };

export const EMERGENCY_SERVICE_FALLBACK: Record<string, EmergencyGridService> = {
  '111': { id: '111', numbers: ['111'], iconName: 'shield-alert', label: 'Crime Stoppers', labelSw: 'Kuzuia Uhalifu' },
  '112': { id: '112', numbers: ['112'], iconName: 'shield-alert', label: 'Police', labelSw: 'Polisi' },
  '113': { id: '113', numbers: ['113'], iconName: 'shield-alert', label: 'TAKUKURU (Anticorruption)', labelSw: 'TAKUKURU' },
  '114': { id: '114', numbers: ['114'], iconName: 'flame', label: 'Fire & Rescue', labelSw: 'Zimamoto' },
  '115': { id: '115', numbers: ['115'], iconName: 'medical', label: 'Ambulance · Mama na Mtoto', labelSw: 'Gari la Wagonjwa · Mama na Mtoto' },
  '116': { id: '116', numbers: ['116'], iconName: 'child', label: 'Child Helpline', labelSw: 'Msaada wa Watoto' },
  '195': { id: '195', numbers: ['195'], iconName: 'lock', label: 'Human Trafficking', labelSw: 'Kupinga Usafirishaji Haramu' },
  '199': { id: '199', numbers: ['199'], iconName: 'epidemic', label: 'Health line (Afya)', labelSw: 'Afya (Kituo cha Simu)', description: 'Health advice from the Ministry of Health. In a medical emergency call 112 or 115.', descriptionSw: 'Ushauri wa afya, Wizara ya Afya. Kwa dharura ya kiafya piga 112 au 115.' },
  '0800110064': { id: '0800110064', numbers: ['0800110064'], iconName: 'hazard', label: 'Disaster Management', labelSw: 'Maafa (Bara)' },
  '181': { id: '181', numbers: ['181'], iconName: 'utility', label: 'DAWASA (Dar es Salaam water)', labelSw: 'DAWASA (Maji Dar es Salaam)' },
  '0800711113': { id: '0800711113', numbers: ['0800711113'], iconName: 'utility', label: 'Utility Emergency', labelSw: 'Huduma za Umeme/Maji' },
  '110': { id: '110', numbers: ['110'], iconName: 'coastguard', label: 'Lakes, Sea & Coast Guard', labelSw: 'Maziwa, Bahari' },
};

/**
 * Numbers no official government website lists (server TZ_EVIDENCE level
 * below "government-listed", re-checked 2026-10-17). Used where only the
 * bundled list is available (the landing page directory) to mark them.
 */
export const NOT_GOVERNMENT_LISTED = new Set(['110', '195', '181', '0800110064', '0800711113']);
