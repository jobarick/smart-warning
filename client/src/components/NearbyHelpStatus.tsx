import { useEffect, useState } from 'react';
import { fetchIncidentOffers, type IncidentOfferView } from '../lib/api';

interface Props {
  incidentId: string;
}

const POLL_MS = 5000;

/**
 * "N notified, M responding, nearest ~180m — help is on the way", for the
 * device that raised the alert.
 *
 * Renders nothing when there is nothing to show — never "searching…" for an
 * incident Nearby Help never ran for (no location shared, an unmapped
 * category, or nobody nearby), because this endpoint's [] response cannot
 * currently distinguish "not attempted" from "attempted, found nobody". That
 * is an honest gap, not a guess: showing a fabricated status here would be
 * exactly the kind of thing this feature exists to avoid doing.
 */
export function NearbyHelpStatus({ incidentId }: Props) {
  const [offers, setOffers] = useState<IncidentOfferView[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const poll = () => {
      fetchIncidentOffers(incidentId)
        .then((o) => { if (!cancelled) setOffers(o); })
        .catch(() => { /* a missed poll just retries next tick */ });
    };
    poll();
    timer = window.setInterval(poll, POLL_MS);
    return () => { cancelled = true; if (timer) window.clearInterval(timer); };
  }, [incidentId]);

  if (!offers || offers.length === 0) return null;

  const responding = offers.filter((o) => o.status === 'accepted');
  const nearest = [...offers].sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity))[0];

  return (
    <div className="nearby-status" role="status">
      <p className="nearby-status-line">
        {offers.length} nearby {offers.length === 1 ? 'person' : 'people'} notified
        {responding.length > 0 && ` · ${responding.length} responding`}
      </p>
      {responding.length > 0 && nearest.distanceM != null && (
        <p className="nearby-status-eta">Nearest: ~{nearest.distanceM}m away — help is on the way</p>
      )}
    </div>
  );
}
