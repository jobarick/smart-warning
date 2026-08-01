// The Terms & Conditions text, and the record of what a person agreed to.
//
// Held here rather than fetched so the consent screen works on a cold install
// with no connection — somebody must be able to read what they are agreeing to
// before this app will let them use it, and a blank panel with an "I agree"
// button under it would be worthless as a record and worse as a practice.

/**
 * Bump when the terms change materially.
 *
 * Consent is stored against this version, so raising it re-prompts everyone.
 * That is the point: agreement to a document is agreement to *that* document,
 * and silently carrying it forward to a rewritten one is not consent.
 */
export const TERMS_VERSION = '1.0';

export const TERMS_EFFECTIVE_DATE = '1 August 2026';

export const SUPPORT_EMAIL = 'jobarick@gmail.com';
export const SUPPORT_PHONE = '+255 713 455 454';

export interface TermsSection {
  heading: string;
  /** Paragraphs. */
  body: string[];
  /** Optional bulleted list rendered after the paragraphs. */
  bullets?: string[];
}

export const TERMS_SECTIONS: TermsSection[] = [
  {
    heading: '1. Purpose of the Service',
    body: [
      'Smart Warning is an emergency communication, safety coordination, and incident management platform designed to help individuals and organizations report emergencies, share location information, coordinate responses, and improve situational awareness.',
      'Smart Warning is an assistance tool and is not a replacement for police, fire departments, ambulance services, hospitals, government emergency agencies, or any official emergency response organization.',
    ],
  },
  {
    heading: '2. Emergency Response Disclaimer',
    body: [
      'Submitting an emergency alert through Smart Warning does not guarantee rescue, emergency dispatch, medical assistance, law enforcement response, or response within any specific time.',
      'Actual response depends on factors including but not limited to:',
    ],
    bullets: [
      'Network availability',
      'GPS availability and accuracy',
      'Device battery level',
      'Internet connectivity',
      'Organization configuration',
      'Supervisor availability',
      'Emergency service availability',
      'Third-party providers',
    ],
  },
  {
    heading: '',
    body: ['If your life is in immediate danger, contact your local emergency services immediately whenever possible.'],
  },
  {
    heading: '3. Location Services',
    body: [
      'By activating an emergency, you authorize Smart Warning to collect, process, transmit, and display your live location to authorized supervisors, responders, or organization administrators for the duration of the incident.',
      'Location tracking may continue until the emergency is resolved or cancelled.',
      'You are responsible for enabling GPS and location permissions.',
    ],
  },
  {
    heading: '4. User Responsibilities',
    body: ['You agree to:'],
    bullets: [
      'Provide accurate information.',
      'Use the Service only for lawful purposes.',
      'Use emergency alerts only during genuine emergencies or legitimate safety incidents.',
      'Keep your account credentials secure.',
      'Maintain a charged and functional device whenever reasonably possible.',
    ],
  },
  {
    heading: '5. False or Misleading Alerts',
    body: [
      'Knowingly submitting false, misleading, fraudulent, or malicious emergency reports is prohibited.',
      'Organizations may suspend or terminate accounts that abuse the Service.',
      'Where permitted by law, repeated misuse may be reported to relevant authorities.',
    ],
  },
  {
    heading: '6. No Guarantee of Availability',
    body: [
      'Although Smart Warning is designed for high reliability, uninterrupted operation cannot be guaranteed.',
      'The Service may be unavailable because of:',
    ],
    bullets: [
      'Internet outages',
      'Mobile network failures',
      'GPS interruptions',
      'Device malfunction',
      'Maintenance',
      'Power failures',
      'Third-party service interruptions',
      'Natural disasters',
      'Events beyond reasonable control',
    ],
  },
  {
    heading: '7. Third-Party Services',
    body: ['Smart Warning may rely on third-party services including:'],
    bullets: [
      'Mapping providers',
      'GPS providers',
      'Cloud hosting',
      'Push notification services',
      'Payment processors',
      'Email providers',
      'Mobile network operators',
    ],
  },
  {
    heading: '',
    body: ['Smart Warning is not responsible for failures caused solely by third-party services.'],
  },
  {
    heading: '8. Safety Guidance',
    body: [
      'Maps, evacuation routes, recommendations, estimated arrival times, hospitals, police stations, assembly points, and other guidance are provided to assist decision-making.',
      'Users must always exercise their own judgment and follow official emergency instructions where available.',
    ],
  },
  {
    heading: '9. Privacy',
    body: [
      'Smart Warning collects only the information necessary to operate the Service.',
      'Information may include:',
    ],
    bullets: [
      'Account details',
      'Device information',
      'Organization membership',
      'GPS location',
      'Emergency history',
      'Incident reports',
      'System logs',
    ],
  },
  {
    heading: '',
    body: ['Data is processed according to our Privacy Policy.'],
  },
  {
    heading: '10. Subscription Services',
    body: [
      'Certain features may require a paid subscription.',
      'Subscription level may determine available features, organizational management tools, reporting capabilities, analytics, and support priority.',
      'Emergency alerts themselves are not disabled because of subscription status.',
    ],
  },
  {
    heading: '11. Limitation of Liability',
    body: [
      'To the maximum extent permitted by applicable law, Smart Warning and its owners, employees, contractors, partners, and affiliates shall not be liable for indirect, incidental, consequential, special, exemplary, or punitive damages arising from the use of the Service.',
      'Nothing in these Terms excludes liability that cannot legally be excluded under applicable law.',
    ],
  },
  {
    heading: '12. User Acknowledgement',
    body: ['By using Smart Warning, you acknowledge that:'],
    bullets: [
      'Technology cannot prevent every emergency.',
      'GPS and communication systems may fail.',
      'Emergency notifications may be delayed or interrupted.',
      'Recommendations are informational and should not replace official emergency instructions.',
      'You remain responsible for your own decisions during an emergency.',
    ],
  },
  {
    heading: '13. Prohibited Uses',
    body: ['Users must not:'],
    bullets: [
      'Abuse emergency reporting.',
      'Attempt unauthorized access.',
      'Interfere with system operation.',
      'Upload malicious software.',
      'Use the Service for criminal activities.',
      'Impersonate another person or organization.',
    ],
  },
  {
    heading: '14. Suspension or Termination',
    body: [
      'Smart Warning may suspend or terminate accounts that violate these Terms or threaten the security, integrity, or availability of the platform.',
    ],
  },
  {
    heading: '15. Changes',
    body: [
      'These Terms may be updated periodically. Continued use of the Service after changes become effective constitutes acceptance of the revised Terms.',
    ],
  },
  {
    heading: '16. Contact',
    body: [`For support, technical assistance, or inquiries: ${SUPPORT_EMAIL} · ${SUPPORT_PHONE}`],
  },
];

/**
 * The four confirmations, each a separate decision.
 *
 * Deliberately not one "I agree to everything" box. Each of these is a distinct
 * thing a person is being asked to understand — particularly the second, which
 * is the one that could matter to somebody who otherwise assumes pressing SOS
 * summons an ambulance.
 */
export const CONSENT_POINTS: { id: string; label: string }[] = [
  {
    id: 'terms',
    label: 'I have read and agree to the Smart Warning Terms & Conditions and Privacy Policy.',
  },
  {
    id: 'no-guarantee',
    label: 'I understand Smart Warning assists with emergency communication but does not guarantee rescue or response.',
  },
  {
    id: 'location',
    label: 'I consent to sharing my live location with authorized supervisors and responders during an active emergency.',
  },
  {
    id: 'misuse',
    label: 'I understand that misuse of emergency alerts may result in account suspension or other action as permitted by law.',
  },
];
