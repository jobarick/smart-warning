import { currentBriefing } from '../lib/safetyBriefing';
import { Icon } from './Icon';

interface Props {
  /** Any tier other than 'free' — see App.tsx's tier fetch. */
  premium: boolean;
}

/**
 * The Premium safety briefing at the top of the Safety tab.
 *
 * Two visually distinct blocks, always labelled, per the product brief this
 * was built against: official TMA information (none exists yet — see
 * lib/safetyBriefing.ts) is never merged into or confused with Smart
 * Warning's own guidance, which itself is not new advice text but a pointer
 * into the existing, singly-disclaimed safety library.
 *
 * A non-Premium visitor sees what the feature is, never a paywall in front of
 * the guides themselves — those stay free below, unaffected by this card.
 */
export function SafetyBriefingCard({ premium }: Props) {
  const briefing = currentBriefing();
  if (!briefing) return null;

  if (!premium) {
    return (
      <section className="briefing briefing-locked">
        <h2 className="briefing-heading"><Icon name="check-circle" /> Weekly safety briefing</h2>
        <p className="briefing-teaser">
          Premium members get a dated, seasonal safety briefing here each week — this week's is about{' '}
          <b>{briefing.guideTitle.toLowerCase()}</b> — plus official Tanzania Meteorological Authority
          bulletins once that integration is live.
        </p>
      </section>
    );
  }

  return (
    <section className="briefing">
      <h2 className="briefing-heading">
        <Icon name="check-circle" /> Your Premium safety briefing
        <span className="briefing-week">{briefing.weekId}</span>
      </h2>

      <div className="briefing-block briefing-tma">
        <span className="briefing-source">Official information: TMA</span>
        {briefing.tmaBulletin ? (
          <>
            <p className="briefing-headline">{briefing.tmaBulletin.headline}</p>
            <p className="briefing-attribution">
              {briefing.tmaBulletin.attribution}
              {briefing.tmaBulletin.sourceUrl && (
                <> · <a href={briefing.tmaBulletin.sourceUrl} target="_blank" rel="noreferrer">Read the source</a></>
              )}
            </p>
          </>
        ) : (
          <p className="briefing-empty">No official TMA bulletin is available yet for your area.</p>
        )}
      </div>

      <div className="briefing-block briefing-sw">
        <span className="briefing-source">Safety guidance: Smart Warning</span>
        <p className="briefing-headline">{briefing.guideTitle}</p>
        <p className="briefing-sub">What you should do</p>
        <ul className="briefing-steps">
          {briefing.whatToDo.map((s) => <li key={s}>{s}</li>)}
        </ul>
      </div>
    </section>
  );
}
