import { findGuide } from './safety';

/**
 * The Premium "weekly safety briefing" — architecture for two clearly
 * separated sources, per the product brief this was built against:
 *
 *   Official information: TMA (Tanzania Meteorological Authority) — actual
 *   forecasts, warnings and climate assessments. No feed exists yet, so
 *   `tmaBulletin` is always null today. This type exists so a real integration
 *   later is a data change, not a UI rewrite — see `TmaBulletin` below.
 *
 *   Safety guidance: Smart Warning — this file's own rotation, and
 *   deliberately NOT new advice text. It points at an existing entry in
 *   lib/safety.ts's SAFETY_GUIDES and surfaces that guide's own `before`
 *   steps. That file carries one, deliberately singular, "not reviewed by a
 *   qualified professional" disclaimer; writing a second, differently-worded
 *   set of safety tips here would be a second unreviewed advice surface in
 *   the one part of the product where that is explicitly called out as the
 *   worst mistake to make.
 *
 * Never presented as one merged "briefing" — a reader must always be able to
 * tell which sentence came from an official authority and which is this
 * product's own guidance.
 */

/** A future TMA-sourced item. Nothing constructs one of these today. */
export interface TmaBulletin {
  /** As published by TMA, not reworded — see the header comment. */
  headline: string;
  /** e.g. "Tanzania Meteorological Authority, 2026-09-18" */
  attribution: string;
  /** Where a person can read the original. */
  sourceUrl?: string;
  issuedAt: string;
}

export interface SafetyBriefing {
  /** ISO week identifier, e.g. "2026-W38" — makes "this week's briefing" literal, not decorative. */
  weekId: string;
  /** Always null until a real TMA feed exists (see TmaBulletin above). */
  tmaBulletin: TmaBulletin | null;
  /** The Smart Warning-authored half: a pointer into lib/safety.ts, not new text. */
  guideId: string;
  guideTitle: string;
  whatToDo: string[];
}

// Seasonal hazards worth rotating through, in the order a Tanzanian year
// actually tends to raise them — not exhaustive, and easy to extend without
// touching the component that renders this.
const ROTATION = ['flood', 'lightning', 'heat', 'storm', 'wildfire', 'landslide'];

function isoWeek(d: Date): { year: number; week: number } {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: date.getUTCFullYear(), week };
}

/**
 * This week's briefing, deterministic from the date alone — no server round
 * trip, so it works offline like the rest of the safety library.
 */
export function currentBriefing(now: Date = new Date()): SafetyBriefing | null {
  const { year, week } = isoWeek(now);
  const guideId = ROTATION[week % ROTATION.length];
  const guide = findGuide(guideId);
  if (!guide) return null; // a rotation id drifted out of sync with SAFETY_GUIDES
  return {
    weekId: `${year}-W${String(week).padStart(2, '0')}`,
    tmaBulletin: null,
    guideId: guide.id,
    guideTitle: guide.title,
    whatToDo: guide.before,
  };
}
