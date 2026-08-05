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
export const TERMS_VERSION = '1.2';

export const TERMS_EFFECTIVE_DATE = '5 August 2026';

export const SUPPORT_EMAIL = 'jobarick@gmail.com';
export const SUPPORT_PHONE = '+255 713 455 454';

/**
 * Who provides the Service.
 *
 * Named in one place and used everywhere — the terms, the privacy policy, the
 * About screen and the support page — because a document that asks somebody to
 * agree to something should say who they are agreeing with, and three
 * different spellings of that across an app is its own kind of unreliable.
 */
export const PROVIDER = 'Idefenda Lab';

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
      `Smart Warning is an emergency communication, safety coordination, and incident management platform designed to help individuals and organizations report emergencies, share location information, coordinate responses, and improve situational awareness. The Service, and the software and product design behind it, are provided by ${PROVIDER}.`,
      `Smart Warning is an assistance tool and is not a replacement for police, fire departments, ambulance services, hospitals, government emergency agencies, or any official emergency response organization. ${PROVIDER} is not an emergency service, is not an emergency dispatch provider, and has no partnership with, authorization from, or affiliation to any emergency service or government authority unless a specific arrangement is stated in writing.`,
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
      'Safety Coordinator availability',
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
      'By activating an emergency, you authorize Smart Warning to collect, process, transmit, and display your live location to authorized Safety Coordinators, responders, or organization administrators for the duration of the incident.',
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
    body: [
      'Data is processed according to our Privacy Policy, which is included in this application and forms part of these Terms.',
    ],
  },
  {
    heading: '9a. Your data rights and account deletion',
    body: [
      'You may request access to, correction of, or deletion of your personal data at any time.',
      'A Safety Coordinator who administers an organization may delete that organization from within the application. Deleting an organization permanently removes its account, its members, its incident history, its stored location records and its reports. This cannot be undone.',
      'If you do not administer an organization, you may request deletion by contacting us using the details in section 16, and we will action it within 30 days.',
      'Some records may be retained where a law, regulation or a legitimate safety or accounting obligation requires it. Where that applies, only the data covered by that obligation is kept, and only for as long as the obligation lasts.',
    ],
  },
  {
    heading: '9b. Data retention',
    body: [
      'Incident records, roll-call answers and location traces recorded during an emergency are retained for as long as the organization holding them keeps its account, because they are that organization’s safety record.',
      'Location is recorded only between an alert being raised and its all-clear. It is not recorded at other times.',
      'Deleting an organization deletes those records with it.',
    ],
  },
  {
    heading: '9c. Eligibility',
    body: [
      'The Service is intended for use by adults and by workers within an organization that has adopted it. It is not directed at children.',
      'If you are under the age of majority in your jurisdiction, you may use the Service only with the consent of a parent, guardian or employer responsible for you.',
    ],
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
    body: [
      `For support, technical assistance, data requests, or inquiries: ${SUPPORT_EMAIL} · ${SUPPORT_PHONE}`,
      'We aim to respond to support requests within 5 working days, and to data access or deletion requests within 30 days.',
    ],
  },
  {
    heading: '17. Governing law',
    body: [
      'These Terms are governed by the laws of the United Republic of Tanzania. Nothing in this section removes any protection you have under the mandatory law of the country in which you live.',
    ],
  },
];

/**
 * The Privacy Policy.
 *
 * Section 9 of the Terms points at this, and the acceptance checkbox says the
 * person agrees to it — so it has to exist and be readable in the same place,
 * or the consent record is for a document nobody could see. It is also a hard
 * Google Play requirement for any app that collects location.
 *
 * Written to describe what the software actually does. Every claim here is
 * checkable against the code: location is written only between an alert and its
 * all-clear (server/relay.js trackPosition), the roster carries position only
 * to Safety Coordinators (broadcastRoster), and deleting an organization
 * cascades to incidents, location_pings, feedback, mail and device tokens
 * (db.js).
 */
export const PRIVACY_SECTIONS: TermsSection[] = [
  {
    heading: 'Who we are',
    body: [
      `Smart Warning is provided by ${PROVIDER}, which is responsible for the personal data described in this policy. For any privacy question, or to exercise the rights below, contact ${SUPPORT_EMAIL} or ${SUPPORT_PHONE}.`,
      `Your employer or the organization whose team code you joined decides who in that organization can see your information. ${PROVIDER} operates the Service on their behalf.`,
    ],
  },
  {
    heading: 'What we collect, and why',
    body: ['We collect only what the Service needs to work:'],
    bullets: [
      'Account details — name, email address, phone number and password, so Safety Coordinators can sign in. Passwords are stored only as a salted hash and are never readable by us.',
      'Organization membership — which site or team you belong to, so an emergency reaches the right people and no others.',
      'Device information — device name, battery level, network status and app version, so a Safety Coordinator can tell a silent phone from a flat one during an incident.',
      'Location — see the section below.',
      'Emergency history — the alerts raised, who raised them, when they were resolved and who reported themselves safe. This is the organization’s safety record.',
      'Incident reports — including reports submitted from a public link, which are held for a Safety Coordinator to review.',
      'System logs — technical records used to keep the Service running and to investigate faults.',
      'Payment records — plan, amount, currency and a masked reference. Card and mobile money credentials are handled by the payment provider and never reach our servers.',
    ],
  },
  {
    heading: 'Location — when it is and is not collected',
    body: [
      'Your live position is shared with your organization’s Safety Coordinators while you are signed in and location sharing is switched on, so that a Safety Coordinator can find you if something happens.',
      'Your position is written down and kept only between an emergency alert being raised and its all-clear. Outside an active incident, no location history is stored.',
      'Your position is visible to Safety Coordinators of your own organization only. It is never shared with other organizations, and it is not sold or used for advertising.',
      'You can stop sharing at any time by turning off location sharing in Settings, by signing out, or by revoking the permission in your device settings. The application will keep working; a Safety Coordinator will simply not be able to see where you are.',
      'The app does not collect location in the background when it is closed.',
    ],
  },
  {
    heading: 'Who your data is shared with',
    body: ['We do not sell personal data. It is shared only with:'],
    bullets: [
      'Safety Coordinators and administrators of your own organization.',
      'Service providers who host or deliver the Service on our behalf — hosting, database, push notification delivery, mapping and routing, email delivery and payment processing. They may process data only to provide those services to us.',
      'Authorities, where we are legally required to disclose it.',
    ],
  },
  {
    heading: 'How long we keep it',
    body: [
      'Incident records, roll-call answers and location traces from an incident are kept for as long as the organization keeps its account, because they are its safety record.',
      'Deleting an organization deletes its members, incidents, location records, reports, feedback, queued email and device registrations.',
      'Records we are required to keep by law — for example payment records for accounting purposes — are retained for the period the law requires and no longer.',
    ],
  },
  {
    heading: 'Your rights',
    body: ['You may ask us to:'],
    bullets: [
      'Give you a copy of the personal data we hold about you.',
      'Correct data that is wrong.',
      'Delete your data. A Safety Coordinator who administers an organization can delete it directly in the application; anyone else can ask us and we will action it within 30 days.',
      'Withdraw consent to location sharing, by switching it off at any time.',
    ],
  },
  {
    heading: '',
    body: [
      'Some data may survive a deletion request where a law or a legitimate safety or accounting obligation requires it. We will tell you if that applies to your request.',
    ],
  },
  {
    heading: 'How we protect it',
    body: [
      'All traffic between the application and our servers uses HTTPS and secure WebSockets. Passwords are stored as salted hashes. Sign-in tokens expire. Every request that reads an organization’s data is checked against that organization, so one site cannot read another’s.',
      'No system is perfectly secure, and we do not claim otherwise.',
    ],
  },
  {
    heading: 'Children',
    body: [
      'The Service is not directed at children and we do not knowingly collect data from them. If you believe a child has provided us with personal data, contact us and we will delete it.',
    ],
  },
  {
    heading: 'Changes',
    body: [
      'If this policy changes materially, the application will ask you to read and accept it again before you continue using the Service.',
    ],
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
    label: 'I consent to sharing my live location with authorized Safety Coordinators and responders during an active emergency.',
  },
  {
    id: 'misuse',
    label: 'I understand that misuse of emergency alerts may result in account suspension or other action as permitted by law.',
  },
];
