import { useState } from 'react';
import { SAFETY_GROUPS, SAFETY_GUIDES, findGuide, guidesInGroup, type SafetyGuide } from '../lib/safety';
import { Icon } from './Icon';

/**
 * Safety & preparedness.
 *
 * A list of hazards, and for each one what to do before, during and after. All
 * of it is bundled with the app, so it opens with the radio off — which is the
 * state a phone is often in at the moment somebody needs it.
 *
 * Master and detail live in the same tab rather than a route, so returning to
 * the list is one obvious control and never leaves the screen the person is on.
 */
export function SafetyPanel() {
  const [openId, setOpenId] = useState<string | null>(null);
  const guide = openId ? findGuide(openId) : undefined;

  if (guide) return <GuideDetail guide={guide} onBack={() => setOpenId(null)} />;

  return (
    <section className="safety">
      <header className="safety-head">
        <h2>Safety &amp; preparedness</h2>
        <p>{SAFETY_GUIDES.length} guides. All of this works without a connection.</p>
      </header>

      {SAFETY_GROUPS.map((group) => (
        <div key={group.id} className="safety-group">
          <h3 className="safety-group-h">{group.label}</h3>
          <ul className="safety-list">
            {guidesInGroup(group.id).map((g) => (
              <li key={g.id}>
                <button type="button" className="safety-card" onClick={() => setOpenId(g.id)}>
                  <span className="safety-card-icon"><Icon name={g.icon} /></span>
                  <span className="safety-card-text">
                    <b>{g.title}</b>
                    <small>{g.summary}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {/* Said on the list rather than buried at the end of each guide: somebody
          deciding whether to trust this should see it before they read it. */}
      <p className="safety-disclaimer">
        General guidance to help you prepare and act. It does not replace training, your
        organisation's own procedures, or the instructions of emergency services. If your life is in
        danger, call your local emergency services.
      </p>
    </section>
  );
}

function GuideDetail({ guide, onBack }: { guide: SafetyGuide; onBack: () => void }) {
  return (
    <section className="safety">
      <button type="button" className="btn back-btn" onClick={onBack}>
        <Icon name="arrow-left" /> All guides
      </button>

      <header className="safety-head">
        <h2><Icon name={guide.icon} /> {guide.title}</h2>
        <p>{guide.summary}</p>
      </header>

      <Phase title="During" tone="now" steps={guide.during} />
      <Phase title="Before" tone="prep" steps={guide.before} />
      <Phase title="After" tone="prep" steps={guide.after} />
    </section>
  );
}

/**
 * "During" comes first, and not in chronological order, because somebody who
 * opens this while something is happening needs the middle section — and
 * scrolling past preparation advice to reach it is exactly the wrong cost at
 * exactly the wrong moment.
 */
function Phase({ title, tone, steps }: { title: string; tone: 'now' | 'prep'; steps: string[] }) {
  return (
    <div className={`safety-phase safety-phase-${tone}`}>
      <h3>{title}</h3>
      <ol>
        {steps.map((s) => <li key={s}>{s}</li>)}
      </ol>
    </div>
  );
}
