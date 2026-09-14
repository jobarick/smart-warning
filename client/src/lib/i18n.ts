import type { Locale } from '../types';

/**
 * Deliberately not a library. Two languages, a few dozen strings, no plural
 * rules or ICU formatting this product actually needs — i18next or similar
 * would be the wrong size of tool for what this is, and this codebase avoids
 * dependencies it can go without (see payments/index.js's header comment on
 * the same principle). `t()` is a pure function of (locale, key, vars); the
 * current locale already lives on the existing persisted `Settings` object
 * alongside `theme`, so there is no new store or Context to introduce either.
 *
 * ⚠️ THE SWAHILI STRINGS BELOW ARE A DRAFT, WRITTEN BY AN AI, NOT REVIEWED BY
 * A FLUENT SPEAKER. They are a reasonable-effort starting point for exactly
 * the kind of natural-sounding, non-machine-translated copy this product
 * needs — not a substitute for that review, which must happen before this is
 * genuinely production-ready. Every string here is safety-critical SOS copy;
 * treat that review as a blocker, not a nice-to-have.
 */

export type StringKey =
  | 'sos.heading'
  | 'sos.tapToAlert'
  | 'sos.tapToSend'
  | 'sos.alertActive'
  | 'sos.alertActiveLong'
  | 'sos.choosePrompt'
  | 'sos.severityLabel'
  | 'sos.notePlaceholder'
  | 'sos.hint'
  | 'severity.low'
  | 'severity.medium'
  | 'severity.high'
  | 'severity.critical'
  | 'settings.language'
  | 'settings.languageEnglish'
  | 'settings.languageSwahili'
  | 'nearby.heading'
  | 'nearby.disclaimer'
  | 'nearby.empty'
  | 'nearby.loading'
  | 'nearby.error'
  | 'nearby.needLocation'
  | 'nearby.openInMaps'
  | 'nearby.kind.hospital'
  | 'nearby.kind.police'
  | 'nearby.kind.fire'
  | 'nearby.kind.shelter'
  | 'nearby.kind.pharmacy'
  | 'contacts.heading'
  | 'contacts.notice'
  | 'contacts.empty'
  | 'contacts.name'
  | 'contacts.relation'
  | 'contacts.relationPlaceholder'
  | 'contacts.phone'
  | 'contacts.email'
  | 'contacts.notify'
  | 'contacts.add'
  | 'contacts.saving'
  | 'contacts.remove'
  | 'contacts.limitReached'
  | 'contacts.nameRequired'
  | 'contacts.needReachable';

type Vars = Record<string, string>;

const STRINGS: Record<Locale, Record<StringKey, string>> = {
  en: {
    'sos.heading': 'Emergency SOS',
    'sos.tapToAlert': 'Tap to alert',
    'sos.tapToSend': 'Tap to send {type}',
    'sos.alertActive': 'Alert active',
    'sos.alertActiveLong': 'An alert is active',
    'sos.choosePrompt': 'Choose the emergency, then press SOS',
    'sos.severityLabel': '{severity} severity',
    'sos.notePlaceholder': 'Add a location or note (optional)',
    'sos.hint': '{profile} · alerts reach every connected device on your network',
    'severity.low': 'Low',
    'severity.medium': 'Medium',
    'severity.high': 'High',
    'severity.critical': 'Critical',
    'settings.language': 'Language',
    'settings.languageEnglish': 'English',
    'settings.languageSwahili': 'Kiswahili',
    'nearby.heading': 'Nearby help',
    'nearby.disclaimer': 'From OpenStreetMap, not a verified directory. Always follow official guidance where it is available.',
    'nearby.empty': 'Nothing found nearby',
    'nearby.loading': 'Looking nearby…',
    'nearby.error': "Couldn't look this up — try again in a moment",
    'nearby.needLocation': 'Turn on location sharing to see nearby help',
    'nearby.openInMaps': 'Open in maps',
    'nearby.kind.hospital': 'Hospital',
    'nearby.kind.police': 'Police',
    'nearby.kind.fire': 'Fire station',
    'nearby.kind.shelter': 'Shelter',
    'nearby.kind.pharmacy': 'Pharmacy',
    'contacts.heading': 'Trusted circle',
    'contacts.notice': 'These are people you trust, not an emergency service — they cannot dispatch help.',
    'contacts.empty': 'No one added yet',
    'contacts.name': 'Name',
    'contacts.relation': 'Relation',
    'contacts.relationPlaceholder': 'e.g. sister, neighbour',
    'contacts.phone': 'Phone',
    'contacts.email': 'Email',
    'contacts.notify': 'Notify this person',
    'contacts.add': 'Add to trusted circle',
    'contacts.saving': 'Saving…',
    'contacts.remove': 'Remove',
    'contacts.limitReached': 'You can have up to {max} trusted contacts',
    'contacts.nameRequired': 'Give this contact a name.',
    'contacts.needReachable': 'Add a phone number or an email so this person can be reached.',
  },
  sw: {
    'sos.heading': 'SOS ya Dharura',
    'sos.tapToAlert': 'Gusa kutuma SOS',
    'sos.tapToSend': 'Gusa kutuma {type}',
    'sos.alertActive': 'Tahadhari inaendelea',
    'sos.alertActiveLong': 'Kuna tahadhari inayoendelea',
    'sos.choosePrompt': 'Chagua dharura, kisha bonyeza SOS',
    'sos.severityLabel': 'Kiwango cha {severity}',
    'sos.notePlaceholder': 'Ongeza eneo au maelezo (si lazima)',
    'sos.hint': '{profile} · tahadhari hufika kwenye kila kifaa kilichounganishwa kwenye mtandao wako',
    'severity.low': 'Chini',
    'severity.medium': 'Wastani',
    'severity.high': 'Juu',
    'severity.critical': 'Hatari Kubwa',
    'settings.language': 'Lugha',
    'settings.languageEnglish': 'Kiingereza',
    'settings.languageSwahili': 'Kiswahili',
    'nearby.heading': 'Msaada wa Karibu',
    'nearby.disclaimer': 'Taarifa kutoka OpenStreetMap, si orodha iliyothibitishwa. Fuata maelekezo rasmi pale yanapopatikana.',
    'nearby.empty': 'Hakuna kilichopatikana karibu',
    'nearby.loading': 'Inatafuta karibu…',
    'nearby.error': 'Imeshindikana kupata taarifa — jaribu tena baadaye kidogo',
    'nearby.needLocation': 'Washa kushiriki eneo ili kuona msaada wa karibu',
    'nearby.openInMaps': 'Fungua kwenye ramani',
    'nearby.kind.hospital': 'Hospitali',
    'nearby.kind.police': 'Polisi',
    'nearby.kind.fire': 'Kituo cha Zimamoto',
    'nearby.kind.shelter': 'Kimbilio',
    'nearby.kind.pharmacy': 'Duka la Dawa',
    'contacts.heading': 'Mzunguko wa Watu wa Kuaminika',
    'contacts.notice': 'Hawa ni watu unaowaamini, si huduma ya dharura — hawawezi kutuma msaada.',
    'contacts.empty': 'Bado hakuna aliyeongezwa',
    'contacts.name': 'Jina',
    'contacts.relation': 'Uhusiano',
    'contacts.relationPlaceholder': 'mfano: dada, jirani',
    'contacts.phone': 'Simu',
    'contacts.email': 'Barua pepe',
    'contacts.notify': 'Mjulishe mtu huyu',
    'contacts.add': 'Ongeza kwenye mzunguko wa kuaminika',
    'contacts.saving': 'Inahifadhi…',
    'contacts.remove': 'Ondoa',
    'contacts.limitReached': 'Unaweza kuwa na watu {max} wa kuaminika',
    'contacts.nameRequired': 'Mpe mtu huyu jina.',
    'contacts.needReachable': 'Ongeza namba ya simu au barua pepe ili mtu huyu aweze kupatikana.',
  },
};

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => vars[name] ?? match);
}

/**
 * Falls back to English for any key missing in the target locale, rather
 * than showing a raw key — a partially-translated screen must never look
 * broken, especially one that might be the SOS screen.
 */
export function t(locale: Locale, key: StringKey, vars?: Vars): string {
  const template = STRINGS[locale]?.[key] ?? STRINGS.en[key] ?? key;
  return interpolate(template, vars);
}

export const SEVERITY_KEY: Record<'low' | 'medium' | 'high' | 'critical', StringKey> = {
  low: 'severity.low',
  medium: 'severity.medium',
  high: 'severity.high',
  critical: 'severity.critical',
};

export const PLACE_KIND_KEY: Record<'hospital' | 'police' | 'fire' | 'shelter' | 'pharmacy', StringKey> = {
  hospital: 'nearby.kind.hospital',
  police: 'nearby.kind.police',
  fire: 'nearby.kind.fire',
  shelter: 'nearby.kind.shelter',
  pharmacy: 'nearby.kind.pharmacy',
};
