import { useEffect, useState } from 'react';
import { pushSupported, notificationPermission, isSubscribed, subscribe, unsubscribe } from '../lib/push';
import { Icon } from './Icon';

interface Props {
  /** Org credentials to register the subscription under. */
  creds: { token?: string; orgCode?: string };
}

/** A compact bell button that subscribes/unsubscribes this device to push alerts. */
export function PushToggle({ creds }: Props) {
  const [supported] = useState(() => pushSupported());
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supported) return;
    isSubscribed().then(setOn);
  }, [supported]);

  if (!supported) return null;

  const blocked = notificationPermission() === 'denied';

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      if (on) {
        await unsubscribe();
        setOn(false);
      } else {
        await subscribe(creds);
        setOn(true);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      className={`push-toggle${on ? ' is-on' : ''}`}
      onClick={toggle}
      disabled={busy || blocked}
      title={blocked ? 'Notifications are blocked in your browser settings' : error || (on ? 'Alerts on — tap to turn off' : 'Get alerts on this device')}
    >
      <Icon name={on ? 'bell' : 'bell-off'} />
      {busy ? '…' : on ? 'Alerts on' : blocked ? 'Blocked' : 'Enable alerts'}
    </button>
  );
}
