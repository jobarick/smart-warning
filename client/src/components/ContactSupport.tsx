import { canDial, telHref } from '../lib/emergency';
import { PROVIDER } from '../lib/terms';
import { Icon } from './Icon';

/** Smart Warning's own support contacts — not an emergency service. */
export const SUPPORT_PHONE = '+255 713 455 454';
export const SUPPORT_EMAIL = 'jobarick@gmail.com';

const TOPICS: { title: string; body: string; subject: string }[] = [
  {
    title: 'Technical support',
    body: 'Sign-in trouble, devices not receiving alerts, sirens or notifications not firing, deployment questions.',
    subject: 'Technical support',
  },
  {
    title: 'Product inquiries',
    body: 'Rolling Smart Warning out to a new site, pricing, multi-site setups, and what the platform does today.',
    subject: 'Product inquiry',
  },
  {
    title: 'Feature requests',
    body: 'Something your site needs that the platform does not do yet. Safety Coordinators can also send these from the dashboard.',
    subject: 'Feature request',
  },
  {
    title: 'System updates',
    body: 'What changed in the latest release, and what a deploy will require from your team.',
    subject: 'System updates',
  },
  {
    title: 'Maintenance',
    body: 'Planned maintenance windows, database retention, and scheduled downtime for the relay.',
    subject: 'Maintenance',
  },
];

interface Props {
  onBack?: () => void;
}

export function ContactSupport({ onBack }: Props) {
  const dialable = canDial();

  return (
    <section className="support">
      {onBack && (
        <button className="support-back" onClick={onBack} type="button">
          <Icon name="arrow-left" /> Back
        </button>
      )}

      <header className="support-head">
        <h2>Contact &amp; support</h2>
        <p>
          For help with the Smart Warning platform itself. In an emergency, use the alert
          button or your local emergency number — not this page.
        </p>
      </header>

      <div className="support-cards">
        <div className="support-card">
          <span className="support-lbl"><Icon name="phone" /> Phone</span>
          {dialable ? (
            <a className="support-value" href={telHref(SUPPORT_PHONE)}>{SUPPORT_PHONE}</a>
          ) : (
            <span className="support-value">{SUPPORT_PHONE}</span>
          )}
        </div>

        <div className="support-card">
          <span className="support-lbl"><Icon name="mail" /> Email</span>
          <a className="support-value" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </div>
      </div>

      <ul className="support-topics">
        {TOPICS.map((t) => (
          <li key={t.title}>
            <div>
              <b>{t.title}</b>
              <span>{t.body}</span>
            </div>
            <a
              className="support-topic-link"
              href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`[Smart Warning] ${t.subject}`)}`}
            >
              Email
            </a>
          </li>
        ))}
      </ul>

      <p className="support-provider">
        Smart Warning is by <strong>{PROVIDER}</strong>. It is a safety coordination tool, not an
        emergency service, and it has no partnership with or authorization from any emergency
        service or government authority.
      </p>
    </section>
  );
}
