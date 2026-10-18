// Only verified responders are sent emergencies (server/db.js). Someone who
// opted in but is not verified yet must be told so, not told they are helping.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const api = vi.hoisted(() => ({ fetchResponderStatus: vi.fn(), setResponderStatus: vi.fn() }));
vi.mock('../lib/api', () => api);

import { NearbyHelpOptIn } from './NearbyHelpOptIn';

const base = { isAvailable: true, categories: ['general'], hasLocation: true, capturedAt: Date.now(), verifiedAt: null };

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('NearbyHelpOptIn', () => {
  it('an available but unverified responder is told they will not be sent emergencies yet', async () => {
    api.fetchResponderStatus.mockResolvedValue({ ...base, verified: false });
    render(<NearbyHelpOptIn token="t" locale="en" />);
    expect(await screen.findByText(/Waiting for verification/)).toBeTruthy();
  });

  it('a verified responder does not see the waiting note', async () => {
    api.fetchResponderStatus.mockResolvedValue({ ...base, verified: true, verifiedAt: Date.now() });
    render(<NearbyHelpOptIn token="t" locale="en" />);
    expect(await screen.findByText(/available to help people near you/)).toBeTruthy();
    expect(screen.queryByText(/Waiting for verification/)).toBeNull();
  });
});
