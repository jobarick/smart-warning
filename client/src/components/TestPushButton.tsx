import { useState } from 'react';
import { sendTestPush } from '../lib/api';
import { Icon } from './Icon';

interface Props {
  creds: { token?: string; orgCode?: string };
}

/**
 * Rehearsal only (shown for a drill organisation): sends a test notification
 * to every device registered to the team, with no incident behind it. The
 * counts are what the push providers accepted; each tester still has to say
 * whether their phone actually showed it.
 */
export function TestPushButton({ creds }: Props) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await sendTestPush(creds);
      const time = new Date(r.at).toLocaleTimeString();
      setNote(`Test sent ${time}: accepted for ${r.fcm.sent} phone(s) and ${r.webPush.sent} browser(s), ${r.fcm.failed + r.webPush.failed} failed. Ask each tester if it showed.`);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="mc-actions">
        <button className="mc-btn" onClick={send} disabled={busy} title="Send a test notification to every device registered to this team">
          <Icon name="bell" /> {busy ? 'Sending…' : 'Send test notification'}
        </button>
      </div>
      <p className="mc-hint" role="status">
        {note ?? 'No emergency is raised. Counts show what the push services accepted, not what phones showed.'}
      </p>
    </>
  );
}
