import type { TermsSection } from '../lib/terms';

/**
 * Renders one of the legal documents.
 *
 * Shared so the copy shown on the consent screen and the copy reachable later
 * from Settings are the same text from the same source. Two renderers would
 * eventually disagree, and the one a person actually agreed to would become a
 * question rather than a fact.
 */
export function LegalText({ sections }: { sections: TermsSection[] }) {
  return (
    <>
      {sections.map((section, i) => (
        <section key={i}>
          {section.heading && <h2>{section.heading}</h2>}
          {section.body.map((para, j) => (
            <p key={j}>{para}</p>
          ))}
          {section.bullets && (
            <ul>
              {section.bullets.map((b, k) => (
                <li key={k}>{b}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </>
  );
}
