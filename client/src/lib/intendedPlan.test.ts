import { beforeEach, describe, expect, it } from 'vitest';
import { INTENDED_PLAN_TTL_MS, peekIntendedPlan, saveIntendedPlan, takeIntendedPlan } from './intendedPlan';

describe('intended plan', () => {
  beforeEach(() => localStorage.clear());

  it('carries the tapped plan to sign-in, once', () => {
    saveIntendedPlan('personal', 'individual', 1000);
    expect(peekIntendedPlan(2000)?.planId).toBe('personal');
    expect(takeIntendedPlan(2000)?.planId).toBe('personal');
    expect(takeIntendedPlan(2000)).toBeNull();
  });

  it('forgets a choice older than an hour', () => {
    saveIntendedPlan('team', 'business', 0);
    expect(peekIntendedPlan(INTENDED_PLAN_TTL_MS + 1)).toBeNull();
  });

  it('ignores garbage in storage', () => {
    localStorage.setItem('sw-intended-plan-v1', '{not json');
    expect(peekIntendedPlan()).toBeNull();
  });
});
