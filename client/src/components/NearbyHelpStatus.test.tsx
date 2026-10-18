// "Help is on the way" must only ever describe someone actually coming: the
// distance is the nearest responder who accepted, and a withdrawn (revoked)
// acceptance or a mere notification never counts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const api = vi.hoisted(() => ({ fetchIncidentOffers: vi.fn() }));
vi.mock('../lib/api', () => api);

import { NearbyHelpStatus } from './NearbyHelpStatus';

const o = (distanceM: number, status: string, reached = true) => ({ distanceM, category: 'medical', status, reached, notifiedAt: Date.now() });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('NearbyHelpStatus', () => {
  it('counts only people a push actually reached, and says so when nobody was', async () => {
    api.fetchIncidentOffers.mockResolvedValue([o(200, 'notified', false), o(400, 'notified', false)]);
    render(<NearbyHelpStatus incidentId="i0" />);
    expect(await screen.findByText(/Nearby help requested, nobody reached yet/)).toBeTruthy();
    expect(screen.queryByText(/alerted|notified/)).toBeNull();
  });

  it('the distance shown is the nearest responder who accepted, not the nearest notified', async () => {
    api.fetchIncidentOffers.mockResolvedValue([o(120, 'notified'), o(900, 'accepted'), o(400, 'declined')]);
    render(<NearbyHelpStatus incidentId="i1" />);
    expect(await screen.findByText(/1 responding/)).toBeTruthy();
    expect(screen.getByText(/Nearest: ~900m away\. Help is on the way/)).toBeTruthy();
  });

  it('a withdrawn acceptance is not counted, and nobody coming means no "Help is on the way"', async () => {
    api.fetchIncidentOffers.mockResolvedValue([o(300, 'withdrawn'), o(500, 'notified')]);
    render(<NearbyHelpStatus incidentId="i2" />);
    expect(await screen.findByText(/2 nearby people alerted/)).toBeTruthy();
    expect(screen.queryByText(/responding/)).toBeNull();
    expect(screen.queryByText(/Help is on the way/)).toBeNull();
  });
});
