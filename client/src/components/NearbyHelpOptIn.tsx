import { useEffect, useRef, useState } from 'react';
import { fetchResponderStatus, setResponderStatus, type ResponderCategory, type ResponderStatus } from '../lib/api';
import { Icon } from './Icon';

interface Props {
  token: string;
}

const DISMISSED_KEY = 'sw-nearby-help-dismissed-v1';

const CATEGORY_OPTIONS: { id: ResponderCategory; label: string }[] = [
  { id: 'fire', label: 'Fire' },
  { id: 'medical', label: 'Medical' },
  { id: 'security', label: 'Security' },
  { id: 'hazard', label: 'Hazard' },
  { id: 'general', label: 'General' },
];

// How often a responder's position refreshes while available. Comfortably
// inside the server's 5-minute freshness cutoff (nearbyHelp.js's
// RESPONDER_FRESHNESS_MS) without holding a continuous GPS lock — battery
// use was one of the explicit constraints this was built against.
const HEARTBEAT_MS = 2 * 60 * 1000;

function toggle(list: ResponderCategory[], id: ResponderCategory): ResponderCategory[] {
  return list.includes(id) ? list.filter((c) => c !== id) : [...list, id];
}

/**
 * "Help people near you when they need it." — the Nearby Help opt-in.
 *
 * Explicitly opt-in, explicitly reversible, and never the default: a person
 * who has never decided either way sees the onboarding pitch with an equally
 * weighted ENABLE / NOT NOW, not a pre-checked toggle. Once opted in, a
 * position refresh runs on a timer only while `isAvailable` is true — turning
 * it off stops the timer immediately, not just the notifications.
 */
export function NearbyHelpOptIn({ token }: Props) {
  const [status, setStatus] = useState<ResponderStatus | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISSED_KEY) === '1'; } catch { return false; }
  });
  const [categories, setCategories] = useState<ResponderCategory[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heartbeatRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchResponderStatus(token)
      .then((s) => { if (!cancelled) { setStatus(s); setCategories(s.categories); } })
      .catch(() => { if (!cancelled) setStatus({ isAvailable: false, categories: [], hasLocation: false, updatedAt: null }); });
    return () => { cancelled = true; };
  }, [token]);

  // The position heartbeat — only while this account is actually available,
  // and cleared the instant it stops being available (including on unmount).
  useEffect(() => {
    if (!status?.isAvailable) return;
    const tick = () => {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          void setResponderStatus(
            { isAvailable: true, lat: pos.coords.latitude, lng: pos.coords.longitude, categories },
            token,
          ).catch(() => { /* a missed heartbeat just means the next one is due sooner from the server's freshness check */ });
        },
        () => { /* declined mid-session — the next PATCH from the UI itself will surface it properly */ },
        { timeout: 8000 },
      );
    };
    tick();
    heartbeatRef.current = window.setInterval(tick, HEARTBEAT_MS);
    return () => { if (heartbeatRef.current) window.clearInterval(heartbeatRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.isAvailable, token]);

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISSED_KEY, '1'); } catch { /* private mode — dismissal just won't stick across sessions */ }
  };

  const enable = () => {
    if (!navigator.geolocation) { setError("This device can't share its location, so it can't be found as nearby help."); return; }
    const wanted = categories.length ? categories : (['general'] as ResponderCategory[]);
    setBusy(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setResponderStatus({ isAvailable: true, lat: pos.coords.latitude, lng: pos.coords.longitude, categories: wanted }, token)
          .then((s) => { setStatus(s); setCategories(s.categories); })
          .catch((e) => setError(e instanceof Error ? e.message : 'could not enable Nearby Help'))
          .finally(() => setBusy(false));
      },
      () => { setError('Location permission is needed to enable Nearby Help.'); setBusy(false); },
      { timeout: 10000 },
    );
  };

  const disable = () => {
    setBusy(true);
    setResponderStatus({ isAvailable: false }, token)
      .then((s) => setStatus(s))
      .catch((e) => setError(e instanceof Error ? e.message : 'could not turn off Nearby Help'))
      .finally(() => setBusy(false));
  };

  /** While already available, a category tap saves immediately — there is no separate "save" step to forget. */
  const toggleCategoryLive = (id: ResponderCategory) => {
    const next = toggle(categories, id);
    setCategories(next);
    void setResponderStatus({ isAvailable: true, categories: next.length ? next : ['general'] }, token)
      .then(setStatus)
      .catch((e) => setError(e instanceof Error ? e.message : 'could not update categories'));
  };

  /** Before enabling, a category tap is just a local draft, applied by the Enable button. */
  const toggleCategoryDraft = (id: ResponderCategory) => setCategories((prev) => toggle(prev, id));

  if (!status) return null; // loading — nothing worth showing yet

  const categoryPicker = (onTap: (id: ResponderCategory) => void) => (
    <div className="nearby-cats">
      {CATEGORY_OPTIONS.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`nearby-cat ${categories.includes(c.id) ? 'active' : ''}`}
          onClick={() => onTap(c.id)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );

  if (status.isAvailable) {
    return (
      <section className="panel nearby-opt">
        <h2><Icon name="navigation" /> Nearby Help</h2>
        <p className="hint">
          You're available to help people near you. Not a Safety Coordinator, not an emergency
          service — just a fellow opted-in person nearby.
        </p>
        {categoryPicker(toggleCategoryLive)}
        <button className="btn" onClick={disable} disabled={busy}>
          {busy ? 'Turning off…' : 'Turn off Nearby Help'}
        </button>
        {error && <p className="hint error">{error}</p>}
      </section>
    );
  }

  if (dismissed) {
    return (
      <section className="panel nearby-opt">
        <h2><Icon name="navigation" /> Nearby Help</h2>
        <p className="hint">Off. Turn it on to be notified about serious emergencies near you.</p>
        {categoryPicker(toggleCategoryDraft)}
        <button className="btn btn-primary" onClick={enable} disabled={busy}>
          {busy ? 'Enabling…' : 'Enable Nearby Help'}
        </button>
        {error && <p className="hint error">{error}</p>}
      </section>
    );
  }

  return (
    <section className="panel nearby-opt nearby-opt-pitch">
      <h2><Icon name="navigation" /> Help people near you when they need it.</h2>
      <p className="hint">
        Allow Smart Warning to use your location to notify you about serious emergencies nearby.
        You choose which kinds of emergencies, and you can turn this off at any time.
      </p>
      {categoryPicker(toggleCategoryDraft)}
      <div className="nearby-opt-actions">
        <button className="btn btn-primary" onClick={enable} disabled={busy}>
          {busy ? 'Enabling…' : 'Enable Nearby Help'}
        </button>
        <button className="btn" onClick={dismiss} disabled={busy}>Not now</button>
      </div>
      {error && <p className="hint error">{error}</p>}
    </section>
  );
}
