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
  '113': { id: '113', numbers: ['113'], iconName: 'shield-alert', label: 'TAKUKURU (Anti-Corruption)', labelSw: 'TAKUKURU' },
  '114': { id: '114', numbers: ['114'], iconName: 'flame', label: 'Fire & Rescue', labelSw: 'Zimamoto' },
  '115': { id: '115', numbers: ['115'], iconName: 'medical', label: 'Ambulance', labelSw: 'Gari la Wagonjwa' },
  '116': { id: '116', numbers: ['116'], iconName: 'child', label: 'Child Helpline', labelSw: 'Msaada wa Watoto' },
  '117': { id: '117', numbers: ['117'], iconName: 'medical', label: 'Health', labelSw: 'Afya' },
  '195': { id: '195', numbers: ['195'], iconName: 'lock', label: 'Anti-Trafficking', labelSw: 'Kupinga Usafirishaji Haramu' },
  '199': { id: '199', numbers: ['199'], iconName: 'epidemic', label: 'Epidemic Diseases', labelSw: 'Magonjwa ya Mlipuko' },
  '0800110064': { id: '0800110064', numbers: ['0800110064'], iconName: 'hazard', label: 'Disaster Management', labelSw: 'Maafa (Bara)' },
  '0800711113': { id: '0800711113', numbers: ['0800711113'], iconName: 'utility', label: 'Utility Emergency', labelSw: 'Huduma za Umeme/Maji' },
  '110': { id: '110', numbers: ['110'], iconName: 'coastguard', label: 'Lakes, Sea & Coast Guard', labelSw: 'Maziwa, Bahari' },
};
