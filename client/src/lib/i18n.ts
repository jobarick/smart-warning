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
  | 'sos.personalSending'
  | 'sos.personalSent'
  | 'sos.personalSentNone'
  | 'sos.personalFailed'
  | 'overlay.titleTemplate'
  | 'overlay.triggeredBy'
  | 'overlay.acknowledgeBtn'
  | 'overlay.acknowledgedNote'
  | 'overlay.iAmSafeBtn'
  | 'overlay.safeNote'
  | 'overlay.retractConfirm'
  | 'overlay.retractBtn'
  | 'overlay.seenBy'
  | 'overlay.onTheWay'
  | 'overlay.etaAway'
  | 'overlay.estimated'
  | 'overlay.allClearConfirm'
  | 'overlay.allClearBtn'
  | 'severity.low'
  | 'severity.medium'
  | 'severity.high'
  | 'severity.critical'
  | 'settings.language'
  | 'settings.languageEnglish'
  | 'settings.languageSwahili'
  | 'pocket.heading'
  | 'pocket.urgentNote'
  | 'pocket.cannotDial'
  | 'aeg.heading'
  | 'aeg.callNow'
  | 'aeg.cannotDial'
  | 'aeg.reportButton'
  | 'emergencyGrid.heading'
  | 'emergencyGrid.sub'
  | 'emergencyGrid.cannotDial'
  | 'emergencyGrid.callNow'
  | 'emergencyGrid.reportButton'
  | 'emergencyReport.heading'
  | 'emergencyReport.messagePlaceholder'
  | 'emergencyReport.emailLabel'
  | 'emergencyReport.emailHint'
  | 'emergencyReport.recordStart'
  | 'emergencyReport.recordStop'
  | 'emergencyReport.recordAgain'
  | 'emergencyReport.recordDiscard'
  | 'emergencyReport.recording'
  | 'emergencyReport.recorded'
  | 'emergencyReport.recordUnsupported'
  | 'emergencyReport.recordDenied'
  | 'emergencyReport.shareLocation'
  | 'emergencyReport.locationShared'
  | 'emergencyReport.locStatusNotShared'
  | 'emergencyReport.locStatusRequesting'
  | 'emergencyReport.locStatusShared'
  | 'emergencyReport.locStatusDenied'
  | 'emergencyReport.locStatusUnavailable'
  | 'emergencyReport.anonymous'
  | 'emergencyReport.addContact'
  | 'emergencyReport.soundLabel'
  | 'emergencyReport.soundOn'
  | 'emergencyReport.soundOff'
  | 'emergencyReport.stopSound'
  | 'emergencyReport.cancel'
  | 'emergencyReport.submit'
  | 'emergencyReport.sending'
  | 'emergencyReport.sent'
  | 'emergencyReport.failed'
  | 'emergencyReport.sentHeading'
  | 'emergencyReport.sentSub'
  | 'emergencyReport.fieldIncident'
  | 'emergencyReport.fieldDescription'
  | 'emergencyReport.descBoth'
  | 'emergencyReport.descText'
  | 'emergencyReport.descVoice'
  | 'emergencyReport.fieldLocation'
  | 'emergencyReport.valShared'
  | 'emergencyReport.valNotShared'
  | 'emergencyReport.fieldContact'
  | 'emergencyReport.fieldIdefenda'
  | 'emergencyReport.idefendaReceived'
  | 'emergencyReport.fieldOrg'
  | 'emergencyReport.orgPending'
  | 'emergencyReport.fieldNearby'
  | 'emergencyReport.nearbyUnavailable'
  | 'emergencyReport.newReport'
  | 'nearby.heading'
  | 'nearby.disclaimer'
  | 'nearby.communitySourced'
  | 'nearby.verified'
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
  | 'contacts.needReachable'
  | 'landing.skipToContent'
  | 'landing.nav.how'
  | 'landing.nav.pricing'
  | 'landing.nav.privacy'
  | 'landing.nav.legal'
  | 'landing.nav.signin'
  | 'landing.hero.heading'
  | 'landing.hero.lead'
  | 'landing.hero.getStarted'
  | 'landing.hero.watchDemo'
  | 'landing.hero.noCard'
  | 'landing.hero.trust1'
  | 'landing.hero.trust2'
  | 'landing.hero.trust3'
  | 'landing.hero.trust4'
  | 'landing.pitch.withPrice'
  | 'landing.pitch.free'
  | 'landing.pitch.seeMore'
  | 'landing.honest.heading'
  | 'landing.honest.p1'
  | 'landing.honest.p2b'
  | 'landing.honest.p2'
  | 'landing.how.heading'
  | 'landing.how.step1Title'
  | 'landing.how.step1Body'
  | 'landing.how.step2Title'
  | 'landing.how.step2Body'
  | 'landing.how.step3Title'
  | 'landing.how.step3Body'
  | 'landing.who.heading'
  | 'landing.who.soloTitle'
  | 'landing.who.soloBody'
  | 'landing.who.soloPriceFree'
  | 'landing.who.soloPricePaid'
  | 'landing.who.teamTitle'
  | 'landing.who.teamBody'
  | 'landing.who.teamPrice'
  | 'landing.pricing.heading'
  | 'landing.pricing.sub'
  | 'landing.pricing.mostPopular'
  | 'landing.pricing.oneSeat'
  | 'landing.pricing.upToSeats'
  | 'landing.pricing.anySeats'
  | 'landing.pricing.free'
  | 'landing.pricing.perMonth'
  | 'landing.pricing.talkToUs'
  | 'landing.pricing.mobileMoney'
  | 'landing.pricing.cardsAccepted'
  | 'landing.pricing.termsNote'
  | 'landing.pricing.startTrial'
  | 'landing.privacy.heading'
  | 'landing.privacy.card1Title'
  | 'landing.privacy.card1Body'
  | 'landing.privacy.card2Title'
  | 'landing.privacy.card2Body'
  | 'landing.privacy.card3Title'
  | 'landing.privacy.card3Body'
  | 'landing.privacy.card4Title'
  | 'landing.privacy.card4Body'
  | 'landing.privacy.linkPrivacy'
  | 'landing.privacy.linkTerms'
  | 'landing.privacy.linkDelete'
  | 'landing.final.heading'
  | 'landing.final.body'
  | 'landing.footer.aboutHeading'
  | 'landing.footer.aboutP1'
  | 'landing.footer.aboutP2'
  | 'landing.footer.aboutAnswer'
  | 'landing.footer.terms'
  | 'landing.footer.privacy'
  | 'landing.footer.accountDeletion'
  | 'landing.footer.support'
  | 'landing.footer.copyright';

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
    'sos.personalSending': 'Sending SOS to your Circle…',
    'sos.personalSent': 'SOS sent — {count} of your Circle notified',
    'sos.personalSentNone': 'SOS recorded — nobody in your Circle could be reached. Add an email address in your Circle so they can be.',
    'sos.personalFailed': 'Could not reach your Circle — call for help directly',
    'overlay.titleTemplate': '{type} ALERT',
    'overlay.triggeredBy': 'Triggered by {sender} at {time}',
    'overlay.acknowledgeBtn': 'Acknowledge (this device)',
    'overlay.acknowledgedNote': 'Acknowledged: alert still active',
    'overlay.iAmSafeBtn': 'I am safe',
    'overlay.safeNote': 'Reported safe: your Safety Coordinator can see this',
    'overlay.retractConfirm': 'Tap again: this was a false alarm',
    'overlay.retractBtn': 'I raised this by mistake',
    'overlay.seenBy': '{name} has seen this alert',
    'overlay.onTheWay': '{name} is on the way',
    'overlay.etaAway': 'about {min} min away',
    'overlay.estimated': '(estimated)',
    'overlay.allClearConfirm': 'Tap again to confirm all clear',
    'overlay.allClearBtn': 'All clear (all devices)',
    'severity.low': 'Low',
    'severity.medium': 'Medium',
    'severity.high': 'High',
    'severity.critical': 'Critical',
    'settings.language': 'Language',
    'settings.languageEnglish': 'English',
    'settings.languageSwahili': 'Kiswahili',
    'pocket.heading': 'Emergency numbers',
    'pocket.urgentNote': 'Call the service you need. This does not replace the alert already sent to your team.',
    'pocket.cannotDial': "This device can't place calls. Dial these from a phone, or reach your site's emergency contact through the details on the Contact & support page.",
    'aeg.heading': 'Emergency help',
    'aeg.callNow': 'Call now',
    'aeg.cannotDial': "This device can't place calls. Dial this number from a phone.",
    'aeg.reportButton': 'Report through Smart Warning',
    'emergencyGrid.heading': 'Get help now',
    'emergencyGrid.sub': "Tap what's happening to see who to call in Tanzania — no account needed.",
    'emergencyGrid.cannotDial': "This device can't place calls. Dial these numbers from a phone.",
    'emergencyGrid.callNow': 'Call now',
    'emergencyGrid.reportButton': 'Report through Idefenda',
    'emergencyReport.heading': "Describe what's happening",
    'emergencyReport.messagePlaceholder': "What's happening, and where? (optional if you record a voice note)",
    'emergencyReport.emailLabel': 'Email',
    'emergencyReport.emailHint': 'optional, only if you want a reply',
    'emergencyReport.recordStart': 'Record a voice note',
    'emergencyReport.recordStop': 'Stop recording',
    'emergencyReport.recordAgain': 'Record again',
    'emergencyReport.recordDiscard': 'Discard',
    'emergencyReport.recording': 'Recording… {sec}s',
    'emergencyReport.recorded': 'Voice note recorded ({sec}s)',
    'emergencyReport.recordUnsupported': "This browser can't record audio here — you can still write a description.",
    'emergencyReport.recordDenied': 'Microphone access was denied — you can still write a description.',
    'emergencyReport.shareLocation': 'Share my location',
    'emergencyReport.locationShared': 'Location shared',
    'emergencyReport.locStatusNotShared': 'Location: not shared',
    'emergencyReport.locStatusRequesting': 'Location: requesting…',
    'emergencyReport.locStatusShared': 'Location: shared',
    'emergencyReport.locStatusDenied': 'Location: not shared (permission denied)',
    'emergencyReport.locStatusUnavailable': 'Location: not shared (unavailable on this device)',
    'emergencyReport.anonymous': 'Anonymous',
    'emergencyReport.addContact': '+ Add contact info',
    'emergencyReport.soundLabel': 'Alert sound',
    'emergencyReport.soundOn': 'Sound',
    'emergencyReport.soundOff': 'Silent',
    'emergencyReport.stopSound': 'Stop sound',
    'emergencyReport.cancel': 'Cancel',
    'emergencyReport.submit': 'Send Alert',
    'emergencyReport.sending': 'Sending…',
    'emergencyReport.sent': "Sent. We'll pass this to the right responders.",
    'emergencyReport.failed': 'Could not send — please call the number above directly.',
    'emergencyReport.sentHeading': 'Alert sent',
    'emergencyReport.sentSub': 'Your report has been received and is being passed on.',
    'emergencyReport.fieldIncident': 'Incident',
    'emergencyReport.fieldDescription': 'Description',
    'emergencyReport.descBoth': 'Text and voice note',
    'emergencyReport.descText': 'Text',
    'emergencyReport.descVoice': 'Voice note',
    'emergencyReport.fieldLocation': 'Location',
    'emergencyReport.valShared': 'Shared',
    'emergencyReport.valNotShared': 'Not shared',
    'emergencyReport.fieldContact': 'Contact',
    'emergencyReport.fieldIdefenda': 'Idefenda',
    'emergencyReport.idefendaReceived': 'Received',
    'emergencyReport.fieldOrg': 'Organization',
    'emergencyReport.orgPending': 'Not yet assigned',
    'emergencyReport.fieldNearby': 'Nearby help',
    'emergencyReport.nearbyUnavailable': 'Not available yet',
    'emergencyReport.newReport': 'Report something else',
    'nearby.heading': 'Nearby help',
    'nearby.disclaimer': 'From OpenStreetMap, not a verified directory. Always follow official guidance where it is available.',
    'nearby.communitySourced': 'Community-sourced',
    'nearby.verified': 'Verified',
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
    'landing.skipToContent': 'Skip to content',
    'landing.nav.how': 'How it works',
    'landing.nav.pricing': 'Pricing',
    'landing.nav.privacy': 'Privacy',
    'landing.nav.legal': 'Legal',
    'landing.nav.signin': 'Sign in',
    'landing.hero.heading': 'Help arrives faster when everyone knows at once.',
    'landing.hero.lead': 'One tap raises the alarm, on every phone on your site, with your live location, in about a second. For one person, or a team of five hundred.',
    'landing.hero.getStarted': 'Get started, free for 30 days',
    'landing.hero.watchDemo': 'Watch it happen. 12 seconds, no signup',
    'landing.hero.noCard': 'No card required. Works in any phone browser.',
    'landing.hero.trust1': 'Built by {provider}',
    'landing.hero.trust2': 'Location shared only during an active alert',
    'landing.hero.trust3': 'No background tracking',
    'landing.hero.trust4': 'Delete your account any time',
    'landing.pitch.withPrice': 'For just {price}/month, Premium adds a medical profile, a trusted circle, and priority support — good for you, your family, and the people around you.',
    'landing.pitch.free': 'Premium adds a medical profile, a trusted circle, and priority support — good for you, your family, and the people around you.',
    'landing.pitch.seeMore': 'See what’s included →',
    'landing.honest.heading': 'What Smart Warning is not',
    'landing.honest.p1': 'Smart Warning complements emergency services. It does not replace them. It cannot dispatch police, fire, or an ambulance, and it is not affiliated with any emergency service or government body.',
    'landing.honest.p2b': 'In a life threatening emergency, call your local emergency number first',
    'landing.honest.p2': ', then use Smart Warning to alert the people around you.',
    'landing.how.heading': 'How it works',
    'landing.how.step1Title': 'Raise it',
    'landing.how.step1Body': 'Pick what is happening and hold the SOS button. Fire, medical, security, hazard, cyber, or evacuation, each at four severities.',
    'landing.how.step2Title': 'Everyone knows',
    'landing.how.step2Body': 'Phones with Smart Warning open alarm at once: full screen, siren, vibration. Phones that are locked or closed get a push notification. Your location appears on the map either way.',
    'landing.how.step3Title': 'Someone comes',
    'landing.how.step3Body': 'Whoever is on duty acknowledges, and everyone you alerted sees that help is on the way, with an ETA.',
    'landing.who.heading': 'Who it is for',
    'landing.who.soloTitle': 'On your own',
    'landing.who.soloBody': 'A panic button that actually reaches someone. Your trusted contacts get your live location the moment you raise an alert.',
    'landing.who.soloPriceFree': 'Free for 30 days.',
    'landing.who.soloPricePaid': 'Free for 30 days, then {price} a month.',
    'landing.who.teamTitle': 'For a site or team',
    'landing.who.teamBody': 'Your workers join with a code, no accounts to create. You get a live roster, a map, and an incident record you can hand to an inspector.',
    'landing.who.teamPrice': 'Team and site plans, billed monthly or yearly.',
    'landing.pricing.heading': 'What it costs',
    'landing.pricing.sub': 'Every plan starts with a 30 day trial. We do not ask for payment details to begin, and nothing charges itself when the trial ends. You choose a plan, or you keep the free one.',
    'landing.pricing.mostPopular': 'Most people start here',
    'landing.pricing.oneSeat': 'One person',
    'landing.pricing.upToSeats': 'Up to {n} people',
    'landing.pricing.anySeats': 'Any number of people',
    'landing.pricing.free': 'Free',
    'landing.pricing.perMonth': '/ month',
    'landing.pricing.talkToUs': 'Talk to us',
    'landing.pricing.mobileMoney': 'Pay with mobile money: Mixx by Yas, MPesa, Airtel Money, HaloPesa, EzyPesa.',
    'landing.pricing.cardsAccepted': 'Cards accepted.',
    'landing.pricing.termsNote': 'Prices in Tanzanian shillings. Cancel whenever you like; you keep the plan until the month you paid for runs out.',
    'landing.pricing.startTrial': 'Start your 30 days',
    'landing.privacy.heading': 'Your location is yours',
    'landing.privacy.card1Title': 'We do not track you in the background',
    'landing.privacy.card1Body': 'The app asks for your location only while an alert is active. When it is cleared, it stops. There is no background location permission in this app. You can check the permission list yourself.',
    'landing.privacy.card2Title': 'Your alert goes to your people',
    'landing.privacy.card2Body': "Alerts are relayed to the phones in your team or your contact list. We do not sell data and we do not run ads. This website measures page visits with Vercel's cookieless analytics; the Android app and the alerting relay carry no analytics at all.",
    'landing.privacy.card3Title': 'We cannot read your password',
    'landing.privacy.card3Body': 'It is stored in a form that cannot be reversed. If you lose it we can help you set a new one, we can never send you the old one. Everything travels over an encrypted connection, on the web and in the app.',
    'landing.privacy.card4Title': 'You can delete everything',
    'landing.privacy.card4Body': 'One button deletes your account and everything attached to it: your incidents, your location history, your reports. It happens immediately.',
    'landing.privacy.linkPrivacy': 'Full Privacy Policy',
    'landing.privacy.linkTerms': 'Terms & Conditions',
    'landing.privacy.linkDelete': 'How to delete your account',
    'landing.final.heading': 'Ready when you are',
    'landing.final.body': 'Set it up before you need it. That is the whole point.',
    'landing.footer.aboutHeading': 'About Smart Warning',
    'landing.footer.aboutP1': 'Smart Warning is built by {provider}, an independent software team in Tanzania. We build it because a fire alarm on a wall only helps the people who can hear it, and most emergencies start with one person who needs everyone else to know, now.',
    'landing.footer.aboutP2': 'Questions, problems, or something that did not work when it mattered:',
    'landing.footer.aboutAnswer': 'we answer.',
    'landing.footer.terms': 'Terms',
    'landing.footer.privacy': 'Privacy',
    'landing.footer.accountDeletion': 'Account deletion',
    'landing.footer.support': 'Support',
    'landing.footer.copyright': 'Not an emergency service.',
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
    'sos.personalSending': 'Inatuma SOS kwa Circle yako…',
    'sos.personalSent': 'SOS imetumwa — watu {count} wa Circle yako wamearifiwa',
    'sos.personalSentNone': 'SOS imehifadhiwa — hakuna aliyeweza kuarifiwa katika Circle yako. Ongeza barua pepe kwenye Circle yako ili waweze kuarifiwa.',
    'sos.personalFailed': 'Imeshindwa kuwasiliana na Circle yako — piga simu kuomba msaada moja kwa moja',
    'overlay.titleTemplate': 'DHARURA YA {type}',
    'overlay.triggeredBy': 'Imeanzishwa na {sender} saa {time}',
    'overlay.acknowledgeBtn': 'Nimeona (kifaa hiki)',
    'overlay.acknowledgedNote': 'Imeonekana: dharura bado inaendelea',
    'overlay.iAmSafeBtn': 'Niko salama',
    'overlay.safeNote': 'Umeripoti uko salama: Msimamizi wa Usalama anaweza kuona hili',
    'overlay.retractConfirm': 'Gusa tena: hii ilikuwa taarifa ya uongo',
    'overlay.retractBtn': 'Nimeleta hii kwa makosa',
    'overlay.seenBy': '{name} ameona dharura hii',
    'overlay.onTheWay': '{name} anakuja',
    'overlay.etaAway': 'takriban dakika {min}',
    'overlay.estimated': '(makadirio)',
    'overlay.allClearConfirm': 'Gusa tena kuthibitisha hali salama',
    'overlay.allClearBtn': 'Hali salama (vifaa vyote)',
    'severity.low': 'Chini',
    'severity.medium': 'Wastani',
    'severity.high': 'Juu',
    'severity.critical': 'Hatari Kubwa',
    'settings.language': 'Lugha',
    'settings.languageEnglish': 'Kiingereza',
    'settings.languageSwahili': 'Kiswahili',
    'pocket.heading': 'Namba za dharura',
    'pocket.urgentNote': 'Piga huduma unayohitaji. Hii haibadilishi tahadhari ambayo tayari imetumwa kwa timu yako.',
    'pocket.cannotDial': 'Kifaa hiki hakiwezi kupiga simu. Piga namba hizi kutoka kwenye simu, au wasiliana na mtu wa dharura wa eneo lako kupitia maelezo kwenye ukurasa wa Mawasiliano na msaada.',
    'aeg.heading': 'Msaada wa Dharura',
    'aeg.callNow': 'Piga sasa',
    'aeg.cannotDial': 'Kifaa hiki hakiwezi kupiga simu. Piga namba hii kutoka kwenye simu.',
    'aeg.reportButton': 'Ripoti kupitia Smart Warning',
    'emergencyGrid.heading': 'Pata Msaada Sasa',
    'emergencyGrid.sub': 'Gusa kinachotokea ili kuona wa kumpigia Tanzania — hauitaji akaunti.',
    'emergencyGrid.cannotDial': 'Kifaa hiki hakiwezi kupiga simu. Piga namba hizi kutoka kwenye simu.',
    'emergencyGrid.callNow': 'Piga sasa',
    'emergencyGrid.reportButton': 'Ripoti kupitia Idefenda',
    'emergencyReport.heading': 'Eleza kinachotokea',
    'emergencyReport.messagePlaceholder': 'Nini kinatokea, na wapi? (si lazima ukirekodi ujumbe wa sauti)',
    'emergencyReport.emailLabel': 'Barua pepe',
    'emergencyReport.emailHint': 'si lazima, isipokuwa unataka jibu',
    'emergencyReport.recordStart': 'Rekodi ujumbe wa sauti',
    'emergencyReport.recordStop': 'Simamisha kurekodi',
    'emergencyReport.recordAgain': 'Rekodi tena',
    'emergencyReport.recordDiscard': 'Futa',
    'emergencyReport.recording': 'Inarekodi… sekunde {sec}',
    'emergencyReport.recorded': 'Ujumbe wa sauti umerekodiwa (sekunde {sec})',
    'emergencyReport.recordUnsupported': 'Kivinjari hiki hakiwezi kurekodi sauti hapa — bado unaweza kuandika maelezo.',
    'emergencyReport.recordDenied': 'Ruhusa ya maikrofoni ilikataliwa — bado unaweza kuandika maelezo.',
    'emergencyReport.shareLocation': 'Shiriki eneo langu',
    'emergencyReport.locationShared': 'Eneo limeshirikiwa',
    'emergencyReport.locStatusNotShared': 'Eneo: halijashirikiwa',
    'emergencyReport.locStatusRequesting': 'Eneo: inaomba…',
    'emergencyReport.locStatusShared': 'Eneo: limeshirikiwa',
    'emergencyReport.locStatusDenied': 'Eneo: halijashirikiwa (ruhusa ilikataliwa)',
    'emergencyReport.locStatusUnavailable': 'Eneo: halijashirikiwa (haipatikani kwenye kifaa hiki)',
    'emergencyReport.anonymous': 'Bila jina',
    'emergencyReport.addContact': '+ Ongeza mawasiliano',
    'emergencyReport.soundLabel': 'Sauti ya tahadhari',
    'emergencyReport.soundOn': 'Sauti',
    'emergencyReport.soundOff': 'Kimya',
    'emergencyReport.stopSound': 'Zima sauti',
    'emergencyReport.cancel': 'Ghairi',
    'emergencyReport.submit': 'Tuma Tahadhari',
    'emergencyReport.sending': 'Inatuma…',
    'emergencyReport.sent': 'Imetumwa. Tutawasilisha kwa wahusika sahihi.',
    'emergencyReport.failed': 'Imeshindwa kutuma — tafadhali piga namba iliyo hapo juu moja kwa moja.',
    'emergencyReport.sentHeading': 'Tahadhari imetumwa',
    'emergencyReport.sentSub': 'Taarifa yako imepokelewa na inawasilishwa.',
    'emergencyReport.fieldIncident': 'Tukio',
    'emergencyReport.fieldDescription': 'Maelezo',
    'emergencyReport.descBoth': 'Maandishi na ujumbe wa sauti',
    'emergencyReport.descText': 'Maandishi',
    'emergencyReport.descVoice': 'Ujumbe wa sauti',
    'emergencyReport.fieldLocation': 'Eneo',
    'emergencyReport.valShared': 'Limeshirikiwa',
    'emergencyReport.valNotShared': 'Halijashirikiwa',
    'emergencyReport.fieldContact': 'Mawasiliano',
    'emergencyReport.fieldIdefenda': 'Idefenda',
    'emergencyReport.idefendaReceived': 'Imepokelewa',
    'emergencyReport.fieldOrg': 'Shirika',
    'emergencyReport.orgPending': 'Bado halijapangwa',
    'emergencyReport.fieldNearby': 'Msaada wa karibu',
    'emergencyReport.nearbyUnavailable': 'Bado haipatikani',
    'emergencyReport.newReport': 'Ripoti jambo lingine',
    'nearby.heading': 'Msaada wa Karibu',
    'nearby.disclaimer': 'Taarifa kutoka OpenStreetMap, si orodha iliyothibitishwa. Fuata maelekezo rasmi pale yanapopatikana.',
    'nearby.communitySourced': 'Chanzo cha jamii',
    'nearby.verified': 'Imethibitishwa',
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
    'landing.skipToContent': 'Rukia hadi maudhui',
    'landing.nav.how': 'Jinsi inavyofanya kazi',
    'landing.nav.pricing': 'Bei',
    'landing.nav.privacy': 'Faragha',
    'landing.nav.legal': 'Kisheria',
    'landing.nav.signin': 'Ingia',
    'landing.hero.heading': 'Msaada hufika haraka zaidi wakati kila mtu anajua kwa wakati mmoja.',
    'landing.hero.lead': 'Mguso mmoja huwasha kengele, kwenye kila simu eneo lako, ukiwa na eneo lako la moja kwa moja, ndani ya sekunde moja. Kwa mtu mmoja, au timu ya watu mia tano.',
    'landing.hero.getStarted': 'Anza, bure kwa siku 30',
    'landing.hero.watchDemo': 'Tazama jinsi inavyofanya kazi. Sekunde 12, hakuna usajili',
    'landing.hero.noCard': 'Hakuna kadi inayohitajika. Inafanya kazi kwenye kivinjari chochote cha simu.',
    'landing.hero.trust1': 'Imetengenezwa na {provider}',
    'landing.hero.trust2': 'Eneo hushirikiwa tu wakati wa tahadhari inayoendelea',
    'landing.hero.trust3': 'Hakuna ufuatiliaji wa nyuma',
    'landing.hero.trust4': 'Futa akaunti yako wakati wowote',
    'landing.pitch.withPrice': 'Kwa {price}/mwezi tu, Premium huongeza wasifu wa kiafya, Mzunguko wa Uaminifu, na msaada wa kipaumbele — nzuri kwako, familia yako, na watu walio karibu nawe.',
    'landing.pitch.free': 'Premium huongeza wasifu wa kiafya, Mzunguko wa Uaminifu, na msaada wa kipaumbele — nzuri kwako, familia yako, na watu walio karibu nawe.',
    'landing.pitch.seeMore': 'Ona kilichomo →',
    'landing.honest.heading': 'Smart Warning si nini',
    'landing.honest.p1': 'Smart Warning huongeza huduma za dharura. Haichukui nafasi yao. Haiwezi kutuma polisi, zimamoto, au gari la wagonjwa, na haihusiani na huduma yoyote ya dharura au taasisi ya serikali.',
    'landing.honest.p2b': 'Katika dharura inayohatarisha maisha, piga simu namba yako ya dharura kwanza',
    'landing.honest.p2': ', kisha tumia Smart Warning kuwajulisha watu walio karibu nawe.',
    'landing.how.heading': 'Jinsi inavyofanya kazi',
    'landing.how.step1Title': 'Zindua',
    'landing.how.step1Body': 'Chagua kinachotokea kisha shikilia kitufe cha SOS. Moto, matibabu, usalama, hatari, mtandao, au uhamishaji, kila moja ikiwa na viwango vinne.',
    'landing.how.step2Title': 'Kila mtu anajua',
    'landing.how.step2Body': 'Simu zenye Smart Warning huwasha kengele mara moja: skrini nzima, kengele, mtetemo. Simu zilizofungwa au zilizozimwa hupokea arifa. Eneo lako huonekana kwenye ramani kwa hali zote mbili.',
    'landing.how.step3Title': 'Mtu anakuja',
    'landing.how.step3Body': 'Aliye zamu hukiri, na kila uliyemjulisha huona kuwa msaada unakuja, pamoja na muda wa kufika.',
    'landing.who.heading': 'Ni kwa ajili ya nani',
    'landing.who.soloTitle': 'Peke yako',
    'landing.who.soloBody': 'Kitufe cha hofu kinachomfikia mtu kweli. Anwani zako za kuaminika hupokea eneo lako la moja kwa moja mara tu unapotoa tahadhari.',
    'landing.who.soloPriceFree': 'Bure kwa siku 30.',
    'landing.who.soloPricePaid': 'Bure kwa siku 30, kisha {price} kwa mwezi.',
    'landing.who.teamTitle': 'Kwa eneo au timu',
    'landing.who.teamBody': 'Wafanyakazi wako hujiunga kwa msimbo, hakuna akaunti za kuunda. Unapata orodha ya moja kwa moja, ramani, na rekodi ya tukio unayoweza kumkabidhi mkaguzi.',
    'landing.who.teamPrice': 'Mipango ya timu na eneo, hulipwa kila mwezi au mwaka.',
    'landing.pricing.heading': 'Gharama',
    'landing.pricing.sub': 'Kila mpango huanza na jaribio la siku 30. Hatuombi taarifa za malipo kuanza, na hakuna kinachojitoza pesa jaribio linapoisha. Unachagua mpango, au unabaki na ule wa bure.',
    'landing.pricing.mostPopular': 'Watu wengi huanzia hapa',
    'landing.pricing.oneSeat': 'Mtu mmoja',
    'landing.pricing.upToSeats': 'Hadi watu {n}',
    'landing.pricing.anySeats': 'Idadi yoyote ya watu',
    'landing.pricing.free': 'Bure',
    'landing.pricing.perMonth': '/ mwezi',
    'landing.pricing.talkToUs': 'Ongea nasi',
    'landing.pricing.mobileMoney': 'Lipa kwa pesa ya simu: Mixx by Yas, MPesa, Airtel Money, HaloPesa, EzyPesa.',
    'landing.pricing.cardsAccepted': 'Kadi zinakubaliwa.',
    'landing.pricing.termsNote': 'Bei kwa shilingi za Kitanzania. Ghairi wakati wowote unavyotaka; unabaki na mpango hadi mwezi uliolipia utakapoisha.',
    'landing.pricing.startTrial': 'Anza siku zako 30',
    'landing.privacy.heading': 'Eneo lako ni lako',
    'landing.privacy.card1Title': 'Hatukufuatilii ukiwa nyuma',
    'landing.privacy.card1Body': 'Programu huomba eneo lako tu wakati tahadhari inaendelea. Inapofutwa, huacha. Hakuna ruhusa ya eneo la nyuma katika programu hii. Unaweza kuangalia orodha ya ruhusa mwenyewe.',
    'landing.privacy.card2Title': 'Tahadhari yako huwafikia watu wako',
    'landing.privacy.card2Body': 'Tahadhari husambazwa kwenye simu za timu yako au orodha yako ya anwani. Hatuuzi taarifa na hatuendeshi matangazo. Tovuti hii hupima matembezi ya ukurasa kwa kutumia takwimu za Vercel zisizo na vidakuzi; programu ya Android na huduma ya kusambaza tahadhari hazina takwimu kabisa.',
    'landing.privacy.card3Title': 'Hatuwezi kusoma nywila yako',
    'landing.privacy.card3Body': 'Huhifadhiwa kwa njia isiyoweza kubadilishwa nyuma. Ukiisahau tunaweza kukusaidia kuweka mpya, hatuwezi kamwe kukutumia ile ya zamani. Kila kitu husafiri kupitia muunganisho uliosimbwa, kwenye wavuti na kwenye programu.',
    'landing.privacy.card4Title': 'Unaweza kufuta kila kitu',
    'landing.privacy.card4Body': 'Kitufe kimoja hufuta akaunti yako na kila kilichounganishwa nayo: matukio yako, historia ya eneo lako, ripoti zako. Hutokea mara moja.',
    'landing.privacy.linkPrivacy': 'Sera Kamili ya Faragha',
    'landing.privacy.linkTerms': 'Vigezo na Masharti',
    'landing.privacy.linkDelete': 'Jinsi ya kufuta akaunti yako',
    'landing.final.heading': 'Tuko tayari wakati wowote utakapokuwa tayari',
    'landing.final.body': 'Iweke tayari kabla hujaihitaji. Hilo ndilo lengo lote.',
    'landing.footer.aboutHeading': 'Kuhusu Smart Warning',
    'landing.footer.aboutP1': 'Smart Warning imetengenezwa na {provider}, timu huru ya programu nchini Tanzania. Tunaitengeneza kwa sababu kengele ya moto ukutani husaidia tu watu wanaoisikia, na dharura nyingi huanza na mtu mmoja anayehitaji kila mtu mwingine ajue, sasa hivi.',
    'landing.footer.aboutP2': 'Maswali, matatizo, au kitu kisichofanya kazi wakati muhimu:',
    'landing.footer.aboutAnswer': 'tunajibu.',
    'landing.footer.terms': 'Vigezo',
    'landing.footer.privacy': 'Faragha',
    'landing.footer.accountDeletion': 'Kufuta akaunti',
    'landing.footer.support': 'Msaada',
    'landing.footer.copyright': 'Sio huduma ya dharura.',
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
