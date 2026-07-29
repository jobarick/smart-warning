import { useEffect, useState } from 'react';
import {
  createDestination,
  deleteDestination,
  fetchDestinations,
  type Destination,
  type DestinationKind,
} from '../lib/api';
import type { WorkerInfo } from '../types';
import { Icon } from './Icon';

interface Props {
  token?: string;
  /** Live roster, so a destination can be assigned to a specific person. */
  roster: WorkerInfo[];
}

const KINDS: { id: DestinationKind; label: string; hint: string }[] = [
  { id: 'assembly', label: 'Assembly point', hint: 'Fire, evacuation and hazard alerts route here' },
  { id: 'clinic', label: 'Medical point', hint: 'Medical alerts route here before any public hospital' },
  { id: 'safe', label: 'Safe location', hint: 'Security alerts route here' },
  { id: 'shelter', label: 'Shelter', hint: 'Severe weather and shelter-in-place' },
  { id: 'muster', label: 'Muster station', hint: 'Secondary roll-call point' },
];

/**
 * Supervisor management of where each kind of emergency sends people.
 *
 * A row with no assignee applies to the whole organization; naming an operator
 * overrides the org default for that one person — which is what makes this work
 * for a site where the night shift musters somewhere different.
 */
export function DestinationsManager({ token, roster }: Props) {
  const [items, setItems] = useState<Destination[]>([]);
  const [kind, setKind] = useState<DestinationKind>('assembly');
  const [label, setLabel] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [address, setAddress] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    fetchDestinations({ token })
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : 'could not load destinations'));
  };

  useEffect(load, [token]);

  const useMyPosition = () => {
    if (!navigator.geolocation) { setError('This device cannot report a position.'); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { setLat(p.coords.latitude.toFixed(6)); setLng(p.coords.longitude.toFixed(6)); setError(null); },
      () => setError('Could not read this device’s position — enter the coordinates by hand.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const latN = Number(lat);
    const lngN = Number(lng);
    if (!label.trim()) { setError('Give the destination a name.'); return; }
    if (!Number.isFinite(latN) || !Number.isFinite(lngN)) { setError('Enter valid coordinates.'); return; }
    setBusy(true); setError(null);
    try {
      await createDestination(
        { kind, label: label.trim(), lat: latN, lng: lngN, address: address.trim() || undefined, assignedTo: assignedTo || undefined },
        token,
      );
      setLabel(''); setLat(''); setLng(''); setAddress(''); setAssignedTo('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not save the destination');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteDestination(id, token);
      setItems((l) => l.filter((d) => d.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not remove the destination');
    }
  };

  const nameFor = (operatorId: string) => roster.find((w) => w.id === operatorId)?.name || operatorId;

  return (
    <section className="dest">
      <header className="dest-head">
        <Icon name="map-pin" />
        <span>Safe destinations</span>
      </header>
      <p className="dest-intro">
        Where each kind of emergency sends people. Leave the assignee blank to apply it to
        everyone; pick a person to override it for them. With nothing configured, the app
        falls back to the nearest public facility and hides assembly distance entirely.
      </p>

      {error && <p className="dest-error">{error}</p>}

      <ul className="dest-list">
        {items.length === 0 && <li className="dest-empty">No destinations configured yet.</li>}
        {items.map((d) => (
          <li key={d.id}>
            <div className="dest-item">
              <span className="dest-kind">{KINDS.find((k) => k.id === d.kind)?.label || d.kind}</span>
              <b>{d.label}</b>
              <span className="dest-coords">{d.lat.toFixed(5)}, {d.lng.toFixed(5)}</span>
              {d.address && <span className="dest-addr">{d.address}</span>}
              <span className={`dest-scope ${d.assignedTo ? 'personal' : ''}`}>
                {d.assignedTo ? `Assigned to ${nameFor(d.assignedTo)}` : 'Whole organization'}
              </span>
            </div>
            <button className="dest-del" onClick={() => remove(d.id)} title="Remove" type="button">
              <Icon name="trash" />
            </button>
          </li>
        ))}
      </ul>

      <form className="dest-form" onSubmit={add}>
        <div className="dest-row">
          <label>
            <span>Type</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as DestinationKind)}>
              {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
          </label>
          <label>
            <span>Name</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. North gate muster" maxLength={120} />
          </label>
        </div>

        <p className="dest-hint">{KINDS.find((k) => k.id === kind)?.hint}</p>

        <div className="dest-row">
          <label>
            <span>Latitude</span>
            <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="-6.792354" inputMode="decimal" />
          </label>
          <label>
            <span>Longitude</span>
            <input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="39.208328" inputMode="decimal" />
          </label>
          <button type="button" className="dest-here" onClick={useMyPosition}>Use my position</button>
        </div>

        <div className="dest-row">
          <label>
            <span>Address <small>optional</small></span>
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, city" maxLength={200} />
          </label>
          <label>
            <span>Assign to <small>optional</small></span>
            <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
              <option value="">Whole organization</option>
              {roster.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
        </div>

        <button className="dest-add" type="submit" disabled={busy}>
          <Icon name="plus" /> {busy ? 'Saving…' : 'Add destination'}
        </button>
      </form>
    </section>
  );
}
