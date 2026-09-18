import { canDial, telHref } from '../lib/emergency';
import { t, type StringKey } from '../lib/i18n';
import { PROVIDER, SUPPORT_EMAIL, SUPPORT_PHONE } from '../lib/terms';
import type { Locale } from '../types';
import { Icon } from './Icon';

const TOPICS: { titleKey: StringKey; bodyKey: StringKey; subject: string }[] = [
  { titleKey: 'support.topic.technical.title', bodyKey: 'support.topic.technical.body', subject: 'Technical support' },
  { titleKey: 'support.topic.product.title', bodyKey: 'support.topic.product.body', subject: 'Product inquiry' },
  { titleKey: 'support.topic.feature.title', bodyKey: 'support.topic.feature.body', subject: 'Feature request' },
  { titleKey: 'support.topic.updates.title', bodyKey: 'support.topic.updates.body', subject: 'System updates' },
  { titleKey: 'support.topic.maintenance.title', bodyKey: 'support.topic.maintenance.body', subject: 'Maintenance' },
];

interface Props {
  onBack?: () => void;
  locale: Locale;
}

export function ContactSupport({ onBack, locale }: Props) {
  const dialable = canDial();
  const tt = (key: StringKey, vars?: Record<string, string>) => t(locale, key, vars);

  return (
    <section className="support">
      {onBack && (
        <button className="support-back" onClick={onBack} type="button">
          <Icon name="arrow-left" /> {tt('support.back')}
        </button>
      )}

      <header className="support-head">
        <h2>{tt('support.heading')}</h2>
        <p>{tt('support.lead')}</p>
      </header>

      <div className="support-cards">
        <div className="support-card">
          <span className="support-lbl"><Icon name="phone" /> {tt('support.phone')}</span>
          {dialable ? (
            <a className="support-value" href={telHref(SUPPORT_PHONE)}>{SUPPORT_PHONE}</a>
          ) : (
            <span className="support-value">{SUPPORT_PHONE}</span>
          )}
        </div>

        <div className="support-card">
          <span className="support-lbl"><Icon name="mail" /> {tt('support.email')}</span>
          <a className="support-value" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </div>
      </div>

      <ul className="support-topics">
        {TOPICS.map((topic) => (
          <li key={topic.subject}>
            <div>
              <b>{tt(topic.titleKey)}</b>
              <span>{tt(topic.bodyKey)}</span>
            </div>
            <a
              className="support-topic-link"
              href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`[Smart Warning] ${topic.subject}`)}`}
            >
              {tt('support.topic.emailAction')}
            </a>
          </li>
        ))}
      </ul>

      <p className="support-provider">{tt('support.providerNote', { provider: PROVIDER })}</p>
    </section>
  );
}
