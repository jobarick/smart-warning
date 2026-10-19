import { useEffect, useState, useSyncExternalStore } from 'react';
import { pushSupported, notificationPermission, isSubscribed, subscribe, unsubscribe } from '../lib/push';
import { nativePushSupported, lastPushResult, onPushResult, ensurePushRegistered } from '../lib/nativePush';
import { Icon } from './Icon';

interface Props {
  /** Org credentials to register the subscription under. */
  creds: { token?: string; orgCode?: string };
  /** This device's name, sent with a native re-registration. */
  label?: string;
}

/** A compact bell button that subscribes/unsubscribes this device to push alerts. */
export function PushToggle({ creds, label }: Props) {
  return nativePushSupported() ? <NativePushStatus creds={creds} label={label} /> : <WebPushToggle creds={creds} />;
}

/**
 * The Android app registers with FCM on its own (see App.tsx), so this only
 * reports whether that worked. It must never read "Alerts on" while the
 * system has notifications off: that is the one state where a worker believes
 * they will hear an alarm and will not. Tapping it while off tries again,
 * which shows the permission prompt if Android still allows one.
 */
function NativePushStatus({ creds, label }: Props) {
  const result = useSyncExternalStore(onPushResult, lastPushResult);
  const [busy, setBusy] = useState(false);
  const on = result?.status === 'registered';
  const off = result?.status === 'denied';
  const failed = result?.status === 'error';

  const retry = async () => {
    if (on || busy) return;
    setBusy(true);
    try {
      await ensurePushRegistered(creds, label, { force: true });
    } finally {
      setBusy(false);
    }
  };

  if (result?.status === 'unsupported') return null; // no push plugin in this build

  const title = on
    ? 'Alerts reach this phone even when the app is closed'
    : off
      ? 'Notifications are off for this app. Turn them on in Android Settings, then come back.'
      : failed
        ? 'Could not register this phone for alerts. Tap to try again.'
        : 'Setting up alerts on this phone';

  return (
    <button className={`push-toggle${on ? ' is-on' : ''}`} onClick={retry} disabled={busy || on} title={title}>
      <Icon name={on ? 'bell' : 'bell-off'} />
      {busy || !result ? '…' : on ? 'Alerts on' : off ? 'Alerts off' : 'Retry alerts'}
    </button>
  );
}

function WebPushToggle({ creds }: Props) {
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
      title={blocked ? 'Notifications are blocked in your browser settings' : error || (on ? 'Alerts on, tap to turn off' : 'Get alerts on this device')}
    >
      <Icon name={on ? 'bell' : 'bell-off'} />
      {busy ? '…' : on ? 'Alerts on' : blocked ? 'Blocked' : 'Enable alerts'}
    </button>
  );
}
