// Emergency services near you: must stay useful when location is refused,
// say plainly that open data is unconfirmed, and send directions to the place
// listed, not somewhere else.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  fetchFacilities: vi.fn(),
  fetchFacilityAreas: vi.fn(),
}));
vi.mock('../lib/api', () => api);
vi.mock('../lib/emergency', () => ({ canDial: () => true, telHref: (n: string) => `tel:${n}` }));

import { NearbyHelp } from './NearbyHelp';

const answer = (results: unknown[], mode = 'nearby') => ({ mode, notice: 'From OpenStreetMap…', attribution: '© OSM', results });
const amana = {
  id: 'node/1', name: 'Amana Hospital', kind: 'hospital', subtype: 'hospital', lat: -6.8301, lng: 39.2502,
  region: 'Dar-es-salaam', district: 'Ilala', locality: 'Ilala', address: null, verified: false, distanceM: 1830,
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('NearbyHelp', () => {
  it('with location: lists the nearest, marks it unconfirmed, and directs to that exact place', async () => {
    api.fetchFacilities.mockResolvedValue(answer([amana]));
    render(<NearbyHelp lat={-6.816} lng={39.28} locale="en" />);
    await screen.findByText('Amana Hospital');
    expect(api.fetchFacilities).toHaveBeenCalledWith({ lat: -6.816, lng: 39.28 }, ['hospital'], 10);
    expect(screen.getByText('Open data, unconfirmed')).toBeTruthy();
    const go = screen.getByRole('link', { name: /Directions/ });
    expect(go.getAttribute('href')).toContain('destination=-6.830100,39.250200');
    expect(screen.getByRole('link', { name: /Call 115/ }).getAttribute('href')).toBe('tel:115');
  });

  it('with location refused: the number is still there and a region can be chosen', async () => {
    api.fetchFacilityAreas.mockResolvedValue([
      { code: 'TZ07', name: 'Dar-es-salaam', counts: { police: 40 }, districts: [{ code: 'TZ0702', name: 'Ilala', counts: { police: 10 } }] },
    ]);
    api.fetchFacilities.mockResolvedValue(answer([{ ...amana, kind: 'police', subtype: 'station', name: 'Central Police', distanceM: undefined }], 'area'));
    render(<NearbyHelp lat={null} lng={null} locale="en" />);
    fireEvent.click(screen.getByRole('button', { name: /Police/ }));
    expect(screen.getByRole('link', { name: /Call 112/ })).toBeTruthy();
    const select = await screen.findByRole('combobox');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Dar-es-salaam' })).toBeTruthy());
    fireEvent.change(select, { target: { value: 'TZ07' } });
    await screen.findByText('Central Police');
    expect(api.fetchFacilities).toHaveBeenLastCalledWith({ region: 'TZ07', district: null }, ['police'], 30);
  });

  it('says so plainly when nothing is mapped nearby', async () => {
    api.fetchFacilities.mockResolvedValue(answer([]));
    render(<NearbyHelp lat={-9.6} lng={38.9} locale="en" />);
    await screen.findByText(/None found within 25 km/);
  });

  it('a kind with no national line shows no invented number', async () => {
    api.fetchFacilities.mockResolvedValue(answer([]));
    render(<NearbyHelp lat={-6.8} lng={39.28} locale="en" />);
    fireEvent.click(screen.getByRole('button', { name: /Pharmacy/ }));
    await waitFor(() => expect(api.fetchFacilities).toHaveBeenLastCalledWith(expect.anything(), ['pharmacy'], 10));
    expect(screen.queryByRole('link', { name: /Call/ })).toBeNull();
  });
});
