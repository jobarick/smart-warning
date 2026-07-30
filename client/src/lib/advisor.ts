import type { AlertMessage, AlertType, Severity, SystemStatusLevel, WorkerInfo } from '../types';

/**
 * Incident advisor — decision support for the person running the response.
 *
 * This is a deterministic rules engine, not a model. That is a deliberate
 * choice, not a placeholder for one:
 *
 *  - It runs with no network. The app is offline-capable by design and ships in
 *    an APK; advice that needs a round trip to a provider is advice that is
 *    missing exactly when the building has lost connectivity.
 *  - It is auditable. Every score carries the factors that produced it, so a
 *    supervisor can disagree with it on the spot and an investigator can
 *    reconstruct it months later. "The system told me to" is only a defensible
 *    answer if the system can be asked why.
 *  - It is stable. The same site state yields the same advice on every device
 *    in the org, which matters when two people are reading it at once.
 *
 * A model-backed classifier belongs upstream of this — reading images, audio
 * and sensor feeds to decide *what is happening* — and its output would arrive
 * here as another input. It does not belong in the place where we decide what
 * to tell someone to do next.
 *
 * Everything below is a judgement about emergency response encoded as numbers.
 * The numbers are arguable; the point is that they are visible and consistent.
 */

export type RiskBand = 'low' | 'elevated' | 'high' | 'severe';
export type Urgency = 'now' | 'soon' | 'watch';

export interface AdvisorAction {
  text: string;
  urgency: Urgency;
}

export interface Assessment {
  /** 0–100. Not a probability — a ranking of how hard this needs attention. */
  risk: number;
  band: RiskBand;
  headline: string;
  actions: AdvisorAction[];
  resources: string[];
  /** Why the score is what it is. Rendered, never hidden. */
  factors: string[];
}

export interface AdvisorInput {
  alert: AlertMessage | null;
  roster: WorkerInfo[];
  /** How long the alert has been running, in ms. Ignored when there is none. */
  elapsedMs: number;
  standing: SystemStatusLevel;
  pendingReports: number;
}

/**
 * How fast each class of incident gets worse when nobody intervenes. Fire and
 * evacuation lead because their cost is measured in the time people spend
 * inside; cyber trails because its damage is real but rarely measured in
 * seconds, and treating it as urgent movement is how you end up evacuating a
 * building over a phishing email.
 */
const BASE_RISK: Record<AlertType, number> = {
  fire: 46,
  evacuation: 44,
  hazard: 40,
  security: 38,
  medical: 30,
  cyber: 24,
};

const SEVERITY_RISK: Record<Severity, number> = { low: 0, medium: 8, high: 18, critical: 28 };

/** Incidents whose whole response is "people must move, now". */
const MOVEMENT_TYPES = new Set<AlertType>(['fire', 'evacuation', 'hazard']);

const RESOURCES: Record<AlertType, string[]> = {
  fire: ['Fire service', 'Evacuation marshals', 'First aid team', 'Assembly point warden'],
  medical: ['Ambulance', 'First aid responder', 'Someone to guide the crew in'],
  security: ['Police', 'Site security', 'Lockdown warden per floor'],
  hazard: ['Spill response kit', 'PPE for responders', 'Ventilation or shutdown control'],
  cyber: ['IT security on call', 'Network isolation authority', 'Comms that do not use the affected network'],
  evacuation: ['Evacuation marshals', 'Assembly point warden', 'Accessibility assistance'],
};

/** First move for each class of incident, independent of how the site looks. */
const OPENING_MOVE: Record<AlertType, AdvisorAction> = {
  fire: { text: 'Confirm the assembly point is upwind and clear of the fire before directing anyone to it', urgency: 'now' },
  medical: { text: 'Send a named person to the entrance to guide the ambulance crew in', urgency: 'now' },
  security: { text: 'Do not broadcast anyone’s position on an open channel', urgency: 'now' },
  hazard: { text: 'Establish wind direction before choosing where to muster', urgency: 'now' },
  // The same call the routing engine makes: a compromised network is not a
  // reason to put people outdoors.
  cyber: { text: 'Keep people in place — isolate systems, do not evacuate the building', urgency: 'now' },
  evacuation: { text: 'Confirm the route to the assembly point is passable', urgency: 'now' },
};

const URGENCY_RANK: Record<Urgency, number> = { now: 0, soon: 1, watch: 2 };

/** "Ana, Ben and 3 more" — enough to act on without becoming a wall of names. */
function nameList(workers: WorkerInfo[], max = 3): string {
  const names = workers.map((w) => w.name || 'Unnamed');
  if (names.length <= max) {
    if (names.length <= 1) return names[0] ?? '';
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}

function bandFor(risk: number): RiskBand {
  if (risk < 25) return 'low';
  if (risk < 50) return 'elevated';
  if (risk < 75) return 'high';
  return 'severe';
}

/**
 * Who the roll call is actually of.
 *
 * Supervisor devices are excluded. A supervisor is running the response from
 * the command centre — they have no "I am safe" button to press, so counting
 * them would pin Unaccounted permanently above zero and make the one number
 * the whole response is trying to drive to zero unreachable.
 */
export function musterPopulation(roster: WorkerInfo[]): WorkerInfo[] {
  return roster.filter((w) => w.role !== 'supervisor');
}

/** Who has personally answered the roll call for this specific alert. */
export function accountedFor(roster: WorkerInfo[], alert: AlertMessage | null): WorkerInfo[] {
  if (!alert) return [];
  return musterPopulation(roster).filter((w) => w.safeFor === alert.id);
}

export function unaccountedFor(roster: WorkerInfo[], alert: AlertMessage | null): WorkerInfo[] {
  if (!alert) return [];
  return musterPopulation(roster).filter((w) => w.safeFor !== alert.id);
}

/**
 * Produce an assessment of the site right now, or null when there is genuinely
 * nothing to say. Returning null matters: a panel that always has an opinion
 * teaches people to stop reading it.
 */
export function assess(input: AdvisorInput): Assessment | null {
  const { alert, roster, elapsedMs, standing, pendingReports } = input;

  if (!alert) {
    if (standing !== 'watch') return null;
    return {
      risk: 20,
      band: 'low',
      headline: 'Advisory in effect — no alarm sounding',
      actions: [
        { text: 'Set out what would move this to a full alert, and who makes that call', urgency: 'soon' },
        ...(pendingReports > 0
          ? [{ text: `${pendingReports} public report${pendingReports === 1 ? '' : 's'} waiting — review before the advisory expires`, urgency: 'soon' as Urgency }]
          : []),
      ],
      resources: [],
      factors: ['A supervisor has placed the site under advisory'],
    };
  }

  // Everything below is about the people being looked for, so it is measured
  // against the muster population rather than every connected device.
  const muster = musterPopulation(roster);
  const unaccounted = unaccountedFor(roster, alert);
  const accounted = accountedFor(roster, alert);
  const sos = muster.filter((w) => w.status === 'sos');
  const located = muster.filter((w) => w.lat !== null && w.lng !== null);
  const lowBattery = muster.filter((w) => w.battery !== null && w.battery < 0.2);
  const minutes = Math.max(0, elapsedMs) / 60000;
  const movement = MOVEMENT_TYPES.has(alert.type);

  const factors: string[] = [];
  let risk = BASE_RISK[alert.type];
  factors.push(`${alert.type} incident`);

  risk += SEVERITY_RISK[alert.severity];
  if (SEVERITY_RISK[alert.severity] > 0) factors.push(`${alert.severity} severity`);

  // Unaccounted people are the dominant term during anything that requires
  // movement — it is the number the whole response is trying to drive to zero.
  if (muster.length > 0 && unaccounted.length > 0) {
    const fraction = unaccounted.length / muster.length;
    const weight = movement ? 24 : 10;
    risk += fraction * weight;
    factors.push(`${unaccounted.length} of ${muster.length} not accounted for`);
  }

  if (sos.length > 0) {
    risk += Math.min(18, sos.length * 6);
    factors.push(`${sos.length} calling for help`);
  }

  // An incident that is still running has, by definition, not been contained.
  if (minutes >= 20) {
    risk += 16;
    factors.push('running over 20 minutes');
  } else if (minutes >= 10) {
    risk += 10;
    factors.push('running over 10 minutes');
  } else if (minutes >= 5) {
    risk += 5;
    factors.push('running over 5 minutes');
  }

  // Not knowing where people are is itself a risk, separate from where they are.
  if (muster.length > 0 && located.length / muster.length < 0.5) {
    risk += 6;
    factors.push('fewer than half the devices are reporting a position');
  }

  if (pendingReports > 0) {
    risk += 4;
    factors.push(`${pendingReports} unreviewed public report${pendingReports === 1 ? '' : 's'}`);
  }

  risk = Math.max(0, Math.min(100, Math.round(risk)));

  const actions: AdvisorAction[] = [OPENING_MOVE[alert.type]];

  if (sos.length > 0) {
    actions.push({ text: `Dispatch a responder to ${nameList(sos)}`, urgency: 'now' });
  }

  if (unaccounted.length > 0 && muster.length > 0) {
    actions.push({
      text: movement
        ? `Call the ${unaccounted.length} unaccounted by name: ${nameList(unaccounted)}`
        : `Chase a safety confirmation from ${nameList(unaccounted)}`,
      urgency: movement ? 'now' : 'soon',
    });
  } else if (muster.length > 0) {
    actions.push({
      text: 'Everyone has reported safe — stand down once the hazard itself is confirmed clear',
      urgency: 'now',
    });
  }

  if (minutes >= 10) {
    actions.push({ text: 'Past ten minutes — confirm external services are en route and log the ETA', urgency: 'now' });
  }

  if (muster.length > 0 && located.length / muster.length < 0.5) {
    actions.push({ text: 'Positions are sparse — fall back to a zone-by-zone roll call', urgency: 'soon' });
  }

  if (lowBattery.length > 0) {
    actions.push({
      text: `${lowBattery.length} device${lowBattery.length === 1 ? '' : 's'} under 20% — may drop off the roster before this ends`,
      urgency: 'watch',
    });
  }

  if (pendingReports > 0) {
    actions.push({
      text: `${pendingReports} public report${pendingReports === 1 ? '' : 's'} waiting — may describe this same incident`,
      urgency: 'soon',
    });
  }

  // Stable sort: urgency first, insertion order within a tier. The opening move
  // stays at the top of its tier because it was pushed first.
  actions.sort((a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency]);

  const headline =
    unaccounted.length > 0
      ? `${accounted.length} of ${muster.length} reported safe — ${unaccounted.length} outstanding`
      : muster.length > 0
        ? `All ${muster.length} reported safe`
        : 'No devices are reporting';

  return { risk, band: bandFor(risk), headline, actions, resources: RESOURCES[alert.type], factors };
}
