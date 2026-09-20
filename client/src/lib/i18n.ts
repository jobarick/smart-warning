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
  | 'sos.personalReplayed'
  | 'sos.personalSkippedOne'
  | 'sos.personalSkippedMany'
  | 'sos.locationPending'
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
  | 'landing.who.heading'
  | 'landing.who.soloTitle'
  | 'landing.who.soloBody'
  | 'landing.who.soloPriceFree'
  | 'landing.who.soloPricePaid'
  | 'landing.who.teamTitle'
  | 'landing.who.teamBody'
  | 'landing.who.teamPrice'
  | 'landing.privacy.heading'
  | 'landing.privacy.summary'
  | 'landing.privacy.linkPrivacy'
  | 'landing.privacy.linkTerms'
  | 'landing.privacy.linkDelete'
  | 'landing.footer.aboutHeading'
  | 'landing.footer.aboutP1'
  | 'landing.footer.aboutP2'
  | 'landing.footer.aboutAnswer'
  | 'landing.footer.terms'
  | 'landing.footer.privacy'
  | 'landing.footer.accountDeletion'
  | 'landing.footer.support'
  | 'landing.footer.copyright'
  | 'landing.footer.phoneLabel'
  | 'landing.footer.b2bHeading'
  | 'landing.footer.b2bBody'
  | 'landing.footer.contactSales'
  | 'auth.title.choose'
  | 'auth.sub.choose'
  | 'auth.choice.personal.title'
  | 'auth.choice.personal.sub'
  | 'auth.choice.org.title'
  | 'auth.choice.org.sub'
  | 'auth.choice.login.title'
  | 'auth.choice.login.sub'
  | 'auth.choice.sales.title'
  | 'auth.choice.sales.sub'
  | 'auth.glossary.p1'
  | 'auth.glossary.term'
  | 'auth.glossary.p2'
  | 'auth.disclaimer.p1'
  | 'auth.disclaimer.emphasis'
  | 'auth.back'
  | 'auth.optional'
  | 'auth.worker.title'
  | 'auth.field.teamCode'
  | 'auth.field.yourName'
  | 'auth.submit.join'
  | 'auth.error.teamCodeRequired'
  | 'auth.login.title'
  | 'auth.field.email'
  | 'auth.field.password'
  | 'auth.submit.signingIn'
  | 'auth.submit.signIn'
  | 'auth.link.forgotPassword'
  | 'auth.newHere'
  | 'auth.link.createOrg'
  | 'auth.forgot.title'
  | 'auth.forgot.body'
  | 'auth.field.registeredEmail'
  | 'auth.submit.sending'
  | 'auth.submit.sendResetLink'
  | 'auth.forgot.sentBody'
  | 'auth.forgot.mailNotConfigured'
  | 'auth.forgot.noAccessTitle'
  | 'auth.forgot.noAccessBody'
  | 'auth.button.iHaveCode'
  | 'auth.backToSignIn'
  | 'auth.reset.title'
  | 'auth.reset.bodyLink'
  | 'auth.reset.bodyCode'
  | 'auth.field.resetCode'
  | 'auth.field.resetCodePlaceholder'
  | 'auth.field.newPassword'
  | 'auth.hint.minChars'
  | 'auth.submit.saving'
  | 'auth.submit.saveAndSignIn'
  | 'auth.invite.title'
  | 'auth.invite.previewBody'
  | 'auth.invite.checking'
  | 'auth.submit.joining'
  | 'auth.alreadyHaveAccount'
  | 'auth.personal.title'
  | 'auth.personal.bodyWithPrice'
  | 'auth.personal.bodyFree'
  | 'auth.field.phoneOptional'
  | 'auth.submit.creating'
  | 'auth.submit.createAccount'
  | 'auth.personal.settingUpTeam'
  | 'auth.link.createOrgInstead'
  | 'auth.org.title'
  | 'auth.org.body'
  | 'auth.field.orgName'
  | 'auth.field.contactEmail'
  | 'auth.field.phone'
  | 'auth.field.sector'
  | 'auth.field.siteAddress'
  | 'auth.submit.createOrganization'
  | 'auth.sales.title'
  | 'auth.sales.body'
  | 'auth.sales.interestLabel'
  | 'auth.sales.interest.personal'
  | 'auth.sales.interest.company'
  | 'auth.sales.interest.enterprise'
  | 'auth.sales.interest.partnership'
  | 'auth.sales.interest.support'
  | 'auth.sales.interest.general'
  | 'auth.field.companyName'
  | 'auth.field.contactName'
  | 'auth.field.employees'
  | 'auth.field.locations'
  | 'auth.field.industryFreeText'
  | 'auth.field.message'
  | 'auth.submit.sendingInquiry'
  | 'auth.submit.sendInquiry'
  | 'auth.sales.sentTitle'
  | 'auth.sales.sentBody'
  | 'auth.sales.error.nameRequired'
  | 'auth.sales.error.reachable'
  | 'auth.left.eyebrow'
  | 'auth.left.heading'
  | 'auth.left.lead'
  | 'auth.left.feature.alerts'
  | 'auth.left.feature.location'
  | 'auth.left.feature.nearby'
  | 'auth.left.feature.contacts'
  | 'auth.left.feature.safety'
  | 'auth.left.feature.weather'
  | 'auth.left.feature.team'
  | 'auth.left.premium.heading'
  | 'auth.left.premium.lead'
  | 'auth.left.premium.bullet.nearby'
  | 'auth.left.premium.bullet.contacts'
  | 'auth.left.premium.bullet.location'
  | 'auth.left.premium.bullet.weather'
  | 'auth.left.premium.bullet.safety'
  | 'auth.left.premium.bullet.history'
  | 'auth.left.vision.heading'
  | 'auth.left.vision.body'
  | 'auth.left.serve.heading'
  | 'auth.left.serve.individuals.title'
  | 'auth.left.serve.individuals.body'
  | 'auth.left.serve.families.title'
  | 'auth.left.serve.families.body'
  | 'auth.left.serve.communities.title'
  | 'auth.left.serve.communities.body'
  | 'auth.left.serve.businesses.title'
  | 'auth.left.serve.businesses.body'
  | 'auth.left.serve.enterprise.title'
  | 'auth.left.serve.enterprise.body'
  | 'auth.left.serve.workplaces.title'
  | 'auth.left.serve.workplaces.body'
  | 'auth.left.enterprise.heading'
  | 'auth.left.enterprise.lead'
  | 'auth.left.enterprise.cta'
  | 'industry.notSpecified'
  | 'industry.manufacturing'
  | 'industry.construction'
  | 'industry.healthcare'
  | 'industry.education'
  | 'industry.transport'
  | 'industry.security'
  | 'industry.office'
  | 'industry.warehouse'
  | 'industry.retail'
  | 'industry.hospitality'
  | 'industry.public'
  | 'industry.other'
  | 'support.heading'
  | 'support.lead'
  | 'support.phone'
  | 'support.email'
  | 'support.back'
  | 'support.topic.technical.title'
  | 'support.topic.technical.body'
  | 'support.topic.product.title'
  | 'support.topic.product.body'
  | 'support.topic.feature.title'
  | 'support.topic.feature.body'
  | 'support.topic.updates.title'
  | 'support.topic.updates.body'
  | 'support.topic.maintenance.title'
  | 'support.topic.maintenance.body'
  | 'support.topic.emailAction'
  | 'support.providerNote'
  | 'tab.home'
  | 'tab.safety'
  | 'tab.help'
  | 'tab.profile'
  | 'trial.active.org'
  | 'trial.active.individual'
  | 'trial.ended.org'
  | 'trial.ended.individual'
  | 'trial.daysLeftOne'
  | 'trial.daysLeftMany'
  | 'trial.afterLabel'
  | 'trial.aboutTzs'
  | 'trial.continueCta'
  | 'trial.endedBody'
  | 'trial.subscribeToKeep'
  | 'trial.seePlans'
  | 'profile.personalAccount'
  | 'profile.teamCode'
  | 'profile.team'
  | 'profile.teamActivity'
  | 'profile.historyNoDb'
  | 'profile.loading'
  | 'profile.historyUnavailable'
  | 'profile.historyRetrying'
  | 'profile.noIncidents'
  | 'profile.statusActive'
  | 'profile.resolvedBy'
  | 'profile.statusResolved'
  | 'profile.unknownSender'
  | 'profile.plansAndBilling'
  | 'profile.aboutAndLegal'
  | 'profile.settings'
  | 'profile.support'
  | 'bill.back'
  | 'bill.heading'
  | 'bill.promise'
  | 'bill.currentPlan'
  | 'bill.seats'
  | 'bill.seatsOver'
  | 'bill.billingNumber'
  | 'bill.degradedNote'
  | 'bill.custom'
  | 'bill.perMonth'
  | 'bill.perYear'
  | 'bill.alwaysFree'
  | 'bill.perSeatRange'
  | 'bill.currentBadge'
  | 'bill.talkToUs'
  | 'bill.includedBadge'
  | 'bill.mobileMoneyOff'
  | 'bill.payMobileMoney'
  | 'bill.cardOff'
  | 'bill.payByCard'
  | 'bill.paymentHistory'
  | 'bill.cancelSubscription'
  | 'weather.heading'
  | 'weather.premiumTeaser'
  | 'weather.useMyLocation'
  | 'weather.chooseLocation'
  | 'weather.locationDenied'
  | 'weather.today'
  | 'weather.forecastHeading'
  | 'weather.wind'
  | 'weather.loading'
  | 'weather.unavailable'
  | 'weather.disclaimer'
  | 'weather.condition.clear'
  | 'weather.condition.partly-cloudy'
  | 'weather.condition.cloudy'
  | 'weather.condition.fog'
  | 'weather.condition.drizzle'
  | 'weather.condition.rain'
  | 'weather.condition.snow'
  | 'weather.condition.thunderstorm'
  | 'weather.condition.unknown'
  | 'weather.note.heavyRain.title'
  | 'weather.note.heavyRain.body'
  | 'weather.note.strongWind.title'
  | 'weather.note.strongWind.body'
  | 'weather.note.extremeHeat.title'
  | 'weather.note.extremeHeat.body'
  | 'weather.place.dar'
  | 'weather.place.mbagala'
  | 'weather.place.vikindu'
  | 'weather.place.kibaha'
  | 'weather.place.arusha'
  | 'weather.place.mwanza'
  | 'weather.place.dodoma';

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
    'sos.personalReplayed': 'SOS already sent — your Circle was told',
    'sos.personalSkippedOne': '{name} could not be reached — no email on file',
    'sos.personalSkippedMany': '{count} contacts could not be reached — no email on file',
    'sos.locationPending': 'Sent without an exact location — still trying to get a GPS fix',
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
    'emergencyReport.sent': 'Received. Recorded and sent to our team — call the number above if you need help now.',
    'emergencyReport.failed': 'Could not send — please call the number above directly.',
    'emergencyReport.sentHeading': 'Report received',
    'emergencyReport.sentSub': 'Recorded and sent to our team — this does not dispatch police, fire or ambulance. If you need help now, call the number above.',
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
    'landing.who.heading': 'Who it is for',
    'landing.who.soloTitle': 'On your own',
    'landing.who.soloBody': 'A panic button that actually reaches someone. Your trusted contacts get your live location the moment you raise an alert.',
    'landing.who.soloPriceFree': 'Free for 30 days.',
    'landing.who.soloPricePaid': 'Free for 30 days, then {price} a month.',
    'landing.who.teamTitle': 'For a site or team',
    'landing.who.teamBody': 'Your workers join with a code, no accounts to create. You get a live roster, a map, and an incident record you can hand to an inspector.',
    'landing.who.teamPrice': 'Team and site plans, billed monthly or yearly.',
    'landing.privacy.heading': 'Your location is yours',
    'landing.privacy.summary': 'Your location is only used while an alert is active, never sold, never used for ads. Passwords are never stored in a readable form. Delete your account and everything in it at any time.',
    'landing.privacy.linkPrivacy': 'Full Privacy Policy',
    'landing.privacy.linkTerms': 'Terms & Conditions',
    'landing.privacy.linkDelete': 'How to delete your account',
    'landing.footer.aboutHeading': 'About Smart Warning',
    'landing.footer.aboutP1': 'Smart Warning is built by {provider}, an independent software team in Tanzania. We build it because a fire alarm on a wall only helps the people who can hear it, and most emergencies start with one person who needs everyone else to know, now.',
    'landing.footer.aboutP2': 'Questions, problems, or something that did not work when it mattered:',
    'landing.footer.aboutAnswer': 'we answer.',
    'landing.footer.terms': 'Terms',
    'landing.footer.privacy': 'Privacy',
    'landing.footer.accountDeletion': 'Account deletion',
    'landing.footer.support': 'Support',
    'landing.footer.copyright': 'Not an emergency service.',
    'landing.footer.phoneLabel': 'Phone',
    'landing.footer.b2bHeading': 'For businesses',
    'landing.footer.b2bBody': 'We provide solutions for security companies, estates, and institutions.',
    'landing.footer.contactSales': 'Talk to Smart Warning',
    'auth.title.choose': 'Get started',
    'auth.sub.choose': 'Which one sounds like you? You can change your mind later.',
    'auth.choice.personal.title': 'Start my free trial',
    'auth.choice.personal.sub': 'Just me, looking after myself. 30 days free, no card',
    'auth.choice.org.title': 'Set this up for my workplace',
    'auth.choice.org.sub': "I'll get a code to share, and a screen showing who is on site",
    'auth.choice.login.title': 'Sign in',
    'auth.choice.login.sub': 'I already have an account',
    'auth.choice.sales.title': 'Talk to Smart Warning',
    'auth.choice.sales.sub': 'For companies, teams and organizations',
    'auth.glossary.p1': 'A ',
    'auth.glossary.term': 'Safety Coordinator',
    'auth.glossary.p2': ' is whoever watches a site’s alerts — they see who is present and call the all clear.',
    'auth.disclaimer.p1': 'Smart Warning alerts the people around you. It cannot dispatch emergency services.',
    'auth.disclaimer.emphasis': 'In a life threatening emergency, call your local emergency number first.',
    'auth.back': 'Back',
    'auth.optional': 'optional',
    'auth.worker.title': 'Join your team',
    'auth.field.teamCode': 'Team code',
    'auth.field.yourName': 'Your name',
    'auth.submit.join': 'Join',
    'auth.error.teamCodeRequired': 'Enter your team code and your name.',
    'auth.login.title': 'Sign in',
    'auth.field.email': 'Email',
    'auth.field.password': 'Password',
    'auth.submit.signingIn': 'Signing in…',
    'auth.submit.signIn': 'Sign in',
    'auth.link.forgotPassword': 'Forgot password?',
    'auth.newHere': 'New here?',
    'auth.link.createOrg': 'Create an organization',
    'auth.forgot.title': 'Forgot your password',
    'auth.forgot.body': 'Enter the email address your account was registered with. We will send a link that lets you choose a new password.',
    'auth.field.registeredEmail': 'Registered email',
    'auth.submit.sending': 'Sending…',
    'auth.submit.sendResetLink': 'Send reset link',
    'auth.forgot.sentBody': 'If {email} belongs to a Smart Warning account, a reset link is on its way. It works once, and expires in an hour.',
    'auth.forgot.mailNotConfigured': 'Email delivery is not configured on this deployment yet, so the message is queued rather than sent. It will go out as soon as an administrator sets it up. Contact your administrator if you need access now.',
    'auth.forgot.noAccessTitle': 'No access to that inbox?',
    'auth.forgot.noAccessBody': 'Ask another Safety Coordinator in your organization to sign in and add you, or reach us from the Support screen. Nobody at Smart Warning can see or send you your old password. It is stored in a form that cannot be read back.',
    'auth.button.iHaveCode': 'I have a code',
    'auth.backToSignIn': 'Back to sign in',
    'auth.reset.title': 'Choose a new password',
    'auth.reset.bodyLink': 'Set a new password for your account. This link works once.',
    'auth.reset.bodyCode': 'Paste the code from the email we sent you.',
    'auth.field.resetCode': 'Reset code',
    'auth.field.resetCodePlaceholder': 'Paste the code from the email',
    'auth.field.newPassword': 'New password',
    'auth.hint.minChars': 'at least 8 characters',
    'auth.submit.saving': 'Saving…',
    'auth.submit.saveAndSignIn': 'Save and sign in',
    'auth.invite.title': 'Join your team',
    'auth.invite.previewBody': 'You’ve been invited to join {org} as a Safety Coordinator, as {email}.',
    'auth.invite.checking': 'Checking your invite…',
    'auth.submit.joining': 'Joining…',
    'auth.alreadyHaveAccount': 'I already have an account',
    'auth.personal.title': 'Create a personal account',
    'auth.personal.bodyWithPrice': 'For one person. No team code and no organization, just you. Free for 30 days, then {price} a month. We do not ask for payment details now, and we will tell you before the trial ends.',
    'auth.personal.bodyFree': 'For one person. No team code and no organization, just you. Free for 30 days. We do not ask for payment details now, and we will tell you before the trial ends.',
    'auth.field.phoneOptional': 'Phone number',
    'auth.submit.creating': 'Creating…',
    'auth.submit.createAccount': 'Create my account',
    'auth.personal.settingUpTeam': 'Setting this up for a team?',
    'auth.link.createOrgInstead': 'Create an organization instead',
    'auth.org.title': 'Create an organization',
    'auth.org.body': 'You’ll get a team code to share with your workers.',
    'auth.field.orgName': 'Organization name',
    'auth.field.contactEmail': 'Contact email',
    'auth.field.phone': 'Phone number',
    'auth.field.sector': 'Sector',
    'auth.field.siteAddress': 'Site address',
    'auth.submit.createOrganization': 'Create organization',
    'auth.sales.title': 'Talk to Smart Warning',
    'auth.sales.body': 'Emergency alerts, team coordination, incident management and safety communication for organizations. Tell us about your team and we will get back to you.',
    'auth.sales.interestLabel': 'I’m interested in',
    'auth.sales.interest.personal': 'Personal Premium',
    'auth.sales.interest.company': 'Company / Team',
    'auth.sales.interest.enterprise': 'Enterprise',
    'auth.sales.interest.partnership': 'Partnership',
    'auth.sales.interest.support': 'Technical support',
    'auth.sales.interest.general': 'General enquiry',
    'auth.field.companyName': 'Company name',
    'auth.field.contactName': 'Contact person',
    'auth.field.employees': 'Number of employees',
    'auth.field.locations': 'Number of locations/sites',
    'auth.field.industryFreeText': 'Industry',
    'auth.field.message': 'What do you need help with?',
    'auth.submit.sendingInquiry': 'Sending…',
    'auth.submit.sendInquiry': 'Send',
    'auth.sales.sentTitle': 'Thanks — we’ll be in touch',
    'auth.sales.sentBody': 'We received your message and will reply at {contact} soon.',
    'auth.sales.error.nameRequired': 'Tell us who to contact.',
    'auth.sales.error.reachable': 'Add an email or phone number so we can reply.',
    'auth.left.eyebrow': 'Smart Warning',
    'auth.left.heading': 'When something goes wrong, help should not be far away.',
    'auth.left.lead': 'Smart Warning helps individuals, families, communities and organizations respond to emergencies faster — one tap raises the alarm, shares your location, and brings help toward you.',
    'auth.left.feature.alerts': 'One-tap emergency alerts',
    'auth.left.feature.location': 'Live location',
    'auth.left.feature.nearby': 'Nearby help',
    'auth.left.feature.contacts': 'Emergency contacts',
    'auth.left.feature.safety': 'Safety information',
    'auth.left.feature.weather': 'Weather awareness',
    'auth.left.feature.team': 'Team & company coordination',
    'auth.left.premium.heading': 'Go beyond an emergency button.',
    'auth.left.premium.lead': 'Smart Warning Premium connects your emergency alerts, location, nearby help, safety information and weather awareness in one place.',
    'auth.left.premium.bullet.nearby': 'Nearby Help',
    'auth.left.premium.bullet.contacts': 'Emergency contacts',
    'auth.left.premium.bullet.location': 'Location sharing',
    'auth.left.premium.bullet.weather': 'Weather information',
    'auth.left.premium.bullet.safety': 'Safety alerts',
    'auth.left.premium.bullet.history': 'Emergency history',
    'auth.left.vision.heading': 'Built for Tanzania. Designed to connect people wherever they are.',
    'auth.left.vision.body': 'From Dar es Salaam to Mbagala, Vikindu, Kibaha, Arusha, Mwanza, Dodoma and beyond — cities, towns, villages, workplaces and communities. One engine, wherever you are.',
    'auth.left.serve.heading': 'Who Smart Warning is for',
    'auth.left.serve.individuals.title': 'Individuals',
    'auth.left.serve.individuals.body': 'An additional layer of personal safety.',
    'auth.left.serve.families.title': 'Families',
    'auth.left.serve.families.body': 'Stay connected during emergencies.',
    'auth.left.serve.communities.title': 'Communities',
    'auth.left.serve.communities.body': 'Nearby help and community response.',
    'auth.left.serve.businesses.title': 'Businesses',
    'auth.left.serve.businesses.body': 'Employee emergency communication.',
    'auth.left.serve.enterprise.title': 'Large organizations',
    'auth.left.serve.enterprise.body': 'Multiple teams, departments or locations.',
    'auth.left.serve.workplaces.title': 'High-risk workplaces',
    'auth.left.serve.workplaces.body': 'Construction, factories, logistics and field operations.',
    'auth.left.enterprise.heading': 'Protect your team with Smart Warning',
    'auth.left.enterprise.lead': 'Emergency alerts, team coordination, incident management and safety communication for organizations.',
    'auth.left.enterprise.cta': 'Talk to Smart Warning',
    'industry.notSpecified': 'Not specified',
    'industry.manufacturing': 'Manufacturing',
    'industry.construction': 'Construction',
    'industry.healthcare': 'Healthcare',
    'industry.education': 'Education',
    'industry.transport': 'Transport & logistics',
    'industry.security': 'Security',
    'industry.office': 'Offices',
    'industry.warehouse': 'Warehousing',
    'industry.retail': 'Retail',
    'industry.hospitality': 'Hospitality',
    'industry.public': 'Public institution',
    'industry.other': 'Other',
    'support.heading': 'Contact & support',
    'support.lead': 'For help with the Smart Warning platform itself. In an emergency, use the alert button or your local emergency number, not this page.',
    'support.phone': 'Phone',
    'support.email': 'Email',
    'support.back': 'Back',
    'support.topic.technical.title': 'Technical support',
    'support.topic.technical.body': 'Sign in trouble, devices not receiving alerts, sirens or notifications not firing, deployment questions.',
    'support.topic.product.title': 'Product inquiries',
    'support.topic.product.body': 'Rolling Smart Warning out to a new site, pricing, multi site setups, and what the platform does today.',
    'support.topic.feature.title': 'Feature requests',
    'support.topic.feature.body': 'Something your site needs that the platform does not do yet. Safety Coordinators can also send these from the dashboard.',
    'support.topic.updates.title': 'System updates',
    'support.topic.updates.body': 'What changed in the latest release, and what a deploy will require from your team.',
    'support.topic.maintenance.title': 'Maintenance',
    'support.topic.maintenance.body': 'Planned maintenance windows, database retention, and scheduled downtime for the relay.',
    'support.topic.emailAction': 'Email',
    'support.providerNote': 'Smart Warning is by {provider}. It is a safety coordination tool, not an emergency service, and it has no partnership with or authorization from any emergency service or government authority.',
    'tab.home': 'Home',
    'tab.safety': 'Safety',
    'tab.help': 'Help',
    'tab.profile': 'Safety Profile',
    'trial.active.org': 'Your organization’s Smart Warning trial is active',
    'trial.active.individual': 'Your Smart Warning trial is active',
    'trial.ended.org': 'Your organization’s Smart Warning trial has ended',
    'trial.ended.individual': 'Your Smart Warning trial has ended',
    'trial.daysLeftOne': '{days} day remaining',
    'trial.daysLeftMany': '{days} days remaining',
    'trial.afterLabel': 'After your trial: {price}',
    'trial.aboutTzs': 'about {amount} TZS',
    'trial.continueCta': 'Continue with Smart Warning',
    'trial.endedBody': 'Emergency alerts, your location during an incident, the emergency numbers and the safety guides all keep working.',
    'trial.subscribeToKeep': 'Subscribe for {price} to keep the rest.',
    'trial.seePlans': 'See plans',
    'profile.personalAccount': 'Personal account',
    'profile.teamCode': 'Team code {code}',
    'profile.team': 'Team {code}',
    'profile.teamActivity': 'Team activity',
    'profile.historyNoDb': 'Incident history is not stored on this deployment.',
    'profile.loading': 'Loading…',
    'profile.historyUnavailable': 'History unavailable.',
    'profile.historyRetrying': 'History unavailable, retrying.',
    'profile.noIncidents': 'No incidents recorded yet.',
    'profile.statusActive': 'Active',
    'profile.resolvedBy': 'Resolved by {name}',
    'profile.statusResolved': 'Resolved',
    'profile.unknownSender': 'unknown',
    'profile.plansAndBilling': 'Plans & billing',
    'profile.aboutAndLegal': 'About & legal',
    'profile.settings': 'Settings',
    'profile.support': 'Support',
    'bill.back': 'Back',
    'bill.heading': 'Plans & billing',
    'bill.promise': 'Emergency alerting is never billed. SOS, all-clear, roll call and live location work on every plan, including while a payment is pending, overdue or cancelled. Plans only affect Safety Coordinator tools.',
    'bill.currentPlan': 'Current plan',
    'bill.seats': 'Seats',
    'bill.seatsOver': 'Over your plan, everyone still gets alerts',
    'bill.billingNumber': 'Billing number',
    'bill.degradedNote': 'You are subscribed to {tier} but currently served {plan} while the payment settles.',
    'bill.custom': 'Custom',
    'bill.perMonth': 'per month',
    'bill.perYear': 'per year',
    'bill.alwaysFree': 'always free',
    'bill.perSeatRange': '{min}–{max} per user / month',
    'bill.currentBadge': 'Current plan',
    'bill.talkToUs': 'Talk to us',
    'bill.includedBadge': 'Included',
    'bill.mobileMoneyOff': 'Mobile money not configured',
    'bill.payMobileMoney': 'Pay by mobile money',
    'bill.cardOff': 'Card payments not configured',
    'bill.payByCard': 'Pay by card',
    'bill.paymentHistory': 'Payment history',
    'bill.cancelSubscription': 'Cancel subscription',
    'weather.heading': 'Weather around you',
    'weather.premiumTeaser': 'Premium members get a 3-day forecast and safety notes here, for wherever they are.',
    'weather.useMyLocation': 'Use my location',
    'weather.chooseLocation': 'Choose your location',
    'weather.locationDenied': 'Location permission was not given — choose a place instead.',
    'weather.today': 'Today',
    'weather.forecastHeading': '3-day forecast',
    'weather.wind': 'Wind {kph} km/h',
    'weather.loading': 'Loading weather…',
    'weather.unavailable': 'Weather is not available right now.',
    'weather.disclaimer': 'A weather forecast, not an official warning. Not affiliated with the Tanzania Meteorological Authority.',
    'weather.condition.clear': 'Clear',
    'weather.condition.partly-cloudy': 'Partly cloudy',
    'weather.condition.cloudy': 'Cloudy',
    'weather.condition.fog': 'Fog',
    'weather.condition.drizzle': 'Drizzle',
    'weather.condition.rain': 'Rain likely',
    'weather.condition.snow': 'Snow',
    'weather.condition.thunderstorm': 'Thunderstorm',
    'weather.condition.unknown': 'Weather',
    'weather.note.heavyRain.title': 'Heavy rain possible',
    'weather.note.heavyRain.body': 'Consider extra caution when travelling.',
    'weather.note.strongWind.title': 'Strong wind conditions',
    'weather.note.strongWind.body': 'Outdoor work may require additional caution.',
    'weather.note.extremeHeat.title': 'Extreme heat',
    'weather.note.extremeHeat.body': 'Stay hydrated and limit strenuous activity outdoors during the hottest hours.',
    'weather.place.dar': 'Dar es Salaam',
    'weather.place.mbagala': 'Mbagala',
    'weather.place.vikindu': 'Vikindu',
    'weather.place.kibaha': 'Kibaha',
    'weather.place.arusha': 'Arusha',
    'weather.place.mwanza': 'Mwanza',
    'weather.place.dodoma': 'Dodoma',
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
    'sos.personalReplayed': 'SOS tayari imetumwa — Circle yako imearifiwa',
    'sos.personalSkippedOne': '{name} hakuweza kuarifiwa — hana barua pepe iliyosajiliwa',
    'sos.personalSkippedMany': 'Watu {count} hawakuweza kuarifiwa — hawana barua pepe iliyosajiliwa',
    'sos.locationPending': 'Imetumwa bila mahali kamili — bado inatafuta mtandao wa GPS',
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
    'emergencyReport.sent': 'Imepokelewa. Imerekodiwa na kutumwa kwa timu yetu — piga namba iliyo hapo juu ukihitaji msaada sasa hivi.',
    'emergencyReport.failed': 'Imeshindwa kutuma — tafadhali piga namba iliyo hapo juu moja kwa moja.',
    'emergencyReport.sentHeading': 'Taarifa imepokelewa',
    'emergencyReport.sentSub': 'Imerekodiwa na kutumwa kwa timu yetu — haiwezi kutuma polisi, zimamoto au gari la wagonjwa. Ukihitaji msaada sasa hivi, piga namba iliyo hapo juu.',
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
    'landing.who.heading': 'Ni kwa ajili ya nani',
    'landing.who.soloTitle': 'Peke yako',
    'landing.who.soloBody': 'Kitufe cha hofu kinachomfikia mtu kweli. Anwani zako za kuaminika hupokea eneo lako la moja kwa moja mara tu unapotoa tahadhari.',
    'landing.who.soloPriceFree': 'Bure kwa siku 30.',
    'landing.who.soloPricePaid': 'Bure kwa siku 30, kisha {price} kwa mwezi.',
    'landing.who.teamTitle': 'Kwa eneo au timu',
    'landing.who.teamBody': 'Wafanyakazi wako hujiunga kwa msimbo, hakuna akaunti za kuunda. Unapata orodha ya moja kwa moja, ramani, na rekodi ya tukio unayoweza kumkabidhi mkaguzi.',
    'landing.who.teamPrice': 'Mipango ya timu na eneo, hulipwa kila mwezi au mwaka.',
    'landing.privacy.heading': 'Eneo lako ni lako',
    'landing.privacy.summary': 'Eneo lako hutumika tu wakati tahadhari inaendelea, hatuliuzi kamwe, na halitumiki kwa matangazo. Nywila hazihifadhiwi kwa namna inayosomeka. Futa akaunti yako na kila kilichomo wakati wowote.',
    'landing.privacy.linkPrivacy': 'Sera Kamili ya Faragha',
    'landing.privacy.linkTerms': 'Vigezo na Masharti',
    'landing.privacy.linkDelete': 'Jinsi ya kufuta akaunti yako',
    'landing.footer.aboutHeading': 'Kuhusu Smart Warning',
    'landing.footer.aboutP1': 'Smart Warning imetengenezwa na {provider}, timu huru ya programu nchini Tanzania. Tunaitengeneza kwa sababu kengele ya moto ukutani husaidia tu watu wanaoisikia, na dharura nyingi huanza na mtu mmoja anayehitaji kila mtu mwingine ajue, sasa hivi.',
    'landing.footer.aboutP2': 'Maswali, matatizo, au kitu kisichofanya kazi wakati muhimu:',
    'landing.footer.aboutAnswer': 'tunajibu.',
    'landing.footer.terms': 'Vigezo',
    'landing.footer.privacy': 'Faragha',
    'landing.footer.accountDeletion': 'Kufuta akaunti',
    'landing.footer.support': 'Msaada',
    'landing.footer.copyright': 'Sio huduma ya dharura.',
    'landing.footer.phoneLabel': 'Simu',
    'landing.footer.b2bHeading': 'Kwa Biashara',
    'landing.footer.b2bBody': 'Tunatoa suluhisho kwa makampuni ya usalama, estates, na taasisi.',
    'landing.footer.contactSales': 'Ongea na Smart Warning',
    'auth.title.choose': 'Anza',
    'auth.sub.choose': 'Ni ipi inayokufanana? Unaweza kubadili baadaye.',
    'auth.choice.personal.title': 'Anza jaribio langu la bure',
    'auth.choice.personal.sub': 'Mimi tu, kujilinda mwenyewe. Bure kwa siku 30, hakuna kadi',
    'auth.choice.org.title': 'Weka hii kwa ajili ya eneo langu la kazi',
    'auth.choice.org.sub': 'Utapata msimbo wa kushiriki, na skrini inayoonyesha waliopo eneo la kazi',
    'auth.choice.login.title': 'Ingia',
    'auth.choice.login.sub': 'Tayari nina akaunti',
    'auth.choice.sales.title': 'Ongea na Smart Warning',
    'auth.choice.sales.sub': 'Kwa makampuni, timu na mashirika',
    'auth.glossary.p1': '',
    'auth.glossary.term': 'Msimamizi wa Usalama',
    'auth.glossary.p2': ' ni mtu anayeangalia tahadhari za eneo, anaona waliopo na kutangaza hali salama.',
    'auth.disclaimer.p1': 'Smart Warning huwajulisha watu walio karibu nawe. Haiwezi kutuma polisi, zimamoto au gari la wagonjwa.',
    'auth.disclaimer.emphasis': 'Katika dharura inayohatarisha maisha, piga simu namba yako ya dharura kwanza.',
    'auth.back': 'Rudi',
    'auth.optional': 'si lazima',
    'auth.worker.title': 'Jiunge na timu yako',
    'auth.field.teamCode': 'Msimbo wa timu',
    'auth.field.yourName': 'Jina lako',
    'auth.submit.join': 'Jiunge',
    'auth.error.teamCodeRequired': 'Weka msimbo wa timu yako na jina lako.',
    'auth.login.title': 'Ingia',
    'auth.field.email': 'Barua pepe',
    'auth.field.password': 'Nywila',
    'auth.submit.signingIn': 'Inaingia…',
    'auth.submit.signIn': 'Ingia',
    'auth.link.forgotPassword': 'Umesahau nywila?',
    'auth.newHere': 'Mgeni hapa?',
    'auth.link.createOrg': 'Fungua akaunti ya shirika',
    'auth.forgot.title': 'Umesahau nywila yako',
    'auth.forgot.body': 'Weka barua pepe iliyotumika kufungua akaunti yako. Tutakutumia kiungo cha kuweka nywila mpya.',
    'auth.field.registeredEmail': 'Barua pepe iliyosajiliwa',
    'auth.submit.sending': 'Inatuma…',
    'auth.submit.sendResetLink': 'Tuma kiungo cha kubadili nywila',
    'auth.forgot.sentBody': 'Ikiwa {email} ni ya akaunti ya Smart Warning, kiungo kinakuja. Kinatumika mara moja tu, na huisha baada ya saa moja.',
    'auth.forgot.mailNotConfigured': 'Utumaji wa barua pepe bado haujawekwa kwenye mfumo huu, hivyo ujumbe umehifadhiwa badala ya kutumwa. Utatumwa mara msimamizi atakapouweka. Wasiliana na msimamizi wako ikiwa unahitaji kuingia sasa.',
    'auth.forgot.noAccessTitle': 'Huna tena ufikiaji wa barua pepe hiyo?',
    'auth.forgot.noAccessBody': 'Muombe Msimamizi mwingine wa Usalama katika shirika lako aingie na akuongeze, au tuwasiliane kupitia ukurasa wa Msaada. Hakuna mtu Smart Warning anayeweza kuona au kukutumia nywila yako ya zamani. Imehifadhiwa kwa njia isiyoweza kusomwa tena.',
    'auth.button.iHaveCode': 'Nina msimbo',
    'auth.backToSignIn': 'Rudi kwenye kuingia',
    'auth.reset.title': 'Chagua nywila mpya',
    'auth.reset.bodyLink': 'Weka nywila mpya kwa akaunti yako. Kiungo hiki kinatumika mara moja tu.',
    'auth.reset.bodyCode': 'Bandika msimbo kutoka kwenye barua pepe tuliyokutumia.',
    'auth.field.resetCode': 'Msimbo wa kubadili',
    'auth.field.resetCodePlaceholder': 'Bandika msimbo kutoka kwenye barua pepe',
    'auth.field.newPassword': 'Nywila mpya',
    'auth.hint.minChars': 'angalau herufi 8',
    'auth.submit.saving': 'Inahifadhi…',
    'auth.submit.saveAndSignIn': 'Hifadhi na uingie',
    'auth.invite.title': 'Jiunge na timu yako',
    'auth.invite.previewBody': 'Umealikwa kujiunga na {org} kama Msimamizi wa Usalama, kama {email}.',
    'auth.invite.checking': 'Inaangalia mwaliko wako…',
    'auth.submit.joining': 'Inajiunga…',
    'auth.alreadyHaveAccount': 'Tayari nina akaunti',
    'auth.personal.title': 'Fungua akaunti ya kibinafsi',
    'auth.personal.bodyWithPrice': 'Kwa mtu mmoja. Hakuna msimbo wa timu wala shirika, wewe tu. Bure kwa siku 30, kisha {price} kwa mwezi. Hatuombi taarifa za malipo sasa, na tutakujulisha kabla jaribio halijaisha.',
    'auth.personal.bodyFree': 'Kwa mtu mmoja. Hakuna msimbo wa timu wala shirika, wewe tu. Bure kwa siku 30. Hatuombi taarifa za malipo sasa, na tutakujulisha kabla jaribio halijaisha.',
    'auth.field.phoneOptional': 'Namba ya simu',
    'auth.submit.creating': 'Inaunda…',
    'auth.submit.createAccount': 'Fungua akaunti yangu',
    'auth.personal.settingUpTeam': 'Unaweka hii kwa ajili ya timu?',
    'auth.link.createOrgInstead': 'Fungua akaunti ya shirika badala yake',
    'auth.org.title': 'Fungua akaunti ya shirika',
    'auth.org.body': 'Utapata msimbo wa timu wa kushiriki na wafanyakazi wako.',
    'auth.field.orgName': 'Jina la shirika',
    'auth.field.contactEmail': 'Barua pepe ya mawasiliano',
    'auth.field.phone': 'Namba ya simu',
    'auth.field.sector': 'Sekta',
    'auth.field.siteAddress': 'Anwani ya eneo',
    'auth.submit.createOrganization': 'Fungua shirika',
    'auth.sales.title': 'Ongea na Smart Warning',
    'auth.sales.body': 'Tahadhari za dharura, uratibu wa timu, usimamizi wa matukio na mawasiliano ya usalama kwa mashirika. Tuambie kuhusu timu yako na tutakurudia.',
    'auth.sales.interestLabel': 'Ninavutiwa na',
    'auth.sales.interest.personal': 'Premium ya Kibinafsi',
    'auth.sales.interest.company': 'Kampuni / Timu',
    'auth.sales.interest.enterprise': 'Shirika Kubwa',
    'auth.sales.interest.partnership': 'Ushirikiano',
    'auth.sales.interest.support': 'Msaada wa kiufundi',
    'auth.sales.interest.general': 'Swali la jumla',
    'auth.field.companyName': 'Jina la kampuni',
    'auth.field.contactName': 'Mtu wa mawasiliano',
    'auth.field.employees': 'Idadi ya wafanyakazi',
    'auth.field.locations': 'Idadi ya maeneo/tovuti',
    'auth.field.industryFreeText': 'Sekta',
    'auth.field.message': 'Unahitaji msaada gani?',
    'auth.submit.sendingInquiry': 'Inatuma…',
    'auth.submit.sendInquiry': 'Tuma',
    'auth.sales.sentTitle': 'Asante — tutawasiliana nawe',
    'auth.sales.sentBody': 'Tumepokea ujumbe wako na tutajibu kupitia {contact} hivi karibuni.',
    'auth.sales.error.nameRequired': 'Tujulishe wa kuwasiliana naye.',
    'auth.sales.error.reachable': 'Ongeza barua pepe au namba ya simu ili tuweze kukujibu.',
    'auth.left.eyebrow': 'Smart Warning',
    'auth.left.heading': 'Jambo likienda vibaya, msaada haupaswi kuwa mbali.',
    'auth.left.lead': 'Smart Warning huwasaidia watu binafsi, familia, jamii na mashirika kukabiliana na dharura haraka zaidi — mguso mmoja huwasha kengele, hushiriki eneo lako, na huleta msaada kwako.',
    'auth.left.feature.alerts': 'Tahadhari za dharura kwa mguso mmoja',
    'auth.left.feature.location': 'Eneo la moja kwa moja',
    'auth.left.feature.nearby': 'Msaada wa karibu',
    'auth.left.feature.contacts': 'Mawasiliano ya dharura',
    'auth.left.feature.safety': 'Taarifa za usalama',
    'auth.left.feature.weather': 'Ufahamu wa hali ya hewa',
    'auth.left.feature.team': 'Uratibu wa timu na kampuni',
    'auth.left.premium.heading': 'Nenda mbali zaidi ya kitufe cha dharura.',
    'auth.left.premium.lead': 'Smart Warning Premium huunganisha tahadhari zako za dharura, eneo, msaada wa karibu, taarifa za usalama na ufahamu wa hali ya hewa mahali pamoja.',
    'auth.left.premium.bullet.nearby': 'Msaada wa Karibu',
    'auth.left.premium.bullet.contacts': 'Mawasiliano ya dharura',
    'auth.left.premium.bullet.location': 'Kushiriki eneo',
    'auth.left.premium.bullet.weather': 'Taarifa za hali ya hewa',
    'auth.left.premium.bullet.safety': 'Tahadhari za usalama',
    'auth.left.premium.bullet.history': 'Historia ya dharura',
    'auth.left.vision.heading': 'Imejengwa kwa ajili ya Tanzania. Imeundwa kuunganisha watu popote walipo.',
    'auth.left.vision.body': 'Kutoka Dar es Salaam hadi Mbagala, Vikindu, Kibaha, Arusha, Mwanza, Dodoma na kwingineko — miji, majiji, vijiji, maeneo ya kazi na jamii. Mfumo mmoja, popote ulipo.',
    'auth.left.serve.heading': 'Smart Warning ni kwa ajili ya nani',
    'auth.left.serve.individuals.title': 'Watu binafsi',
    'auth.left.serve.individuals.body': 'Kiwango cha ziada cha usalama binafsi.',
    'auth.left.serve.families.title': 'Familia',
    'auth.left.serve.families.body': 'Baki na mawasiliano wakati wa dharura.',
    'auth.left.serve.communities.title': 'Jamii',
    'auth.left.serve.communities.body': 'Msaada wa karibu na mwitikio wa jamii.',
    'auth.left.serve.businesses.title': 'Biashara',
    'auth.left.serve.businesses.body': 'Mawasiliano ya dharura kwa wafanyakazi.',
    'auth.left.serve.enterprise.title': 'Mashirika makubwa',
    'auth.left.serve.enterprise.body': 'Timu, idara au maeneo mengi.',
    'auth.left.serve.workplaces.title': 'Maeneo ya kazi yenye hatari kubwa',
    'auth.left.serve.workplaces.body': 'Ujenzi, viwanda, usafirishaji na kazi za nyanjani.',
    'auth.left.enterprise.heading': 'Linda timu yako na Smart Warning',
    'auth.left.enterprise.lead': 'Tahadhari za dharura, uratibu wa timu, usimamizi wa matukio na mawasiliano ya usalama kwa mashirika.',
    'auth.left.enterprise.cta': 'Ongea na Smart Warning',
    'industry.notSpecified': 'Haijaelezwa',
    'industry.manufacturing': 'Uzalishaji viwandani',
    'industry.construction': 'Ujenzi',
    'industry.healthcare': 'Afya',
    'industry.education': 'Elimu',
    'industry.transport': 'Usafirishaji na ugavi',
    'industry.security': 'Usalama',
    'industry.office': 'Ofisi',
    'industry.warehouse': 'Maghala',
    'industry.retail': 'Rejareja',
    'industry.hospitality': 'Ukarimu',
    'industry.public': 'Taasisi ya umma',
    'industry.other': 'Nyingine',
    'support.heading': 'Mawasiliano na msaada',
    'support.lead': 'Kwa msaada kuhusu mfumo wa Smart Warning wenyewe. Katika dharura, tumia kitufe cha tahadhari au namba yako ya dharura, si ukurasa huu.',
    'support.phone': 'Simu',
    'support.email': 'Barua pepe',
    'support.back': 'Rudi',
    'support.topic.technical.title': 'Msaada wa kiufundi',
    'support.topic.technical.body': 'Tatizo la kuingia, vifaa visivyopokea tahadhari, kengele au arifa zisizolia, maswali ya usimikaji.',
    'support.topic.product.title': 'Maswali kuhusu bidhaa',
    'support.topic.product.body': 'Kuanzisha Smart Warning kwenye eneo jipya, bei, usanidi wa maeneo mengi, na huduma zilizopo sasa.',
    'support.topic.feature.title': 'Maombi ya huduma mpya',
    'support.topic.feature.body': 'Kitu ambacho eneo lako linahitaji ambacho mfumo hautoi bado. Wasimamizi wa Usalama wanaweza pia kutuma haya kutoka dashibodi.',
    'support.topic.updates.title': 'Masasisho ya mfumo',
    'support.topic.updates.body': 'Kilichobadilika kwenye toleo la hivi karibuni, na kinachohitajika kwa timu yako kusakinisha.',
    'support.topic.maintenance.title': 'Matengenezo',
    'support.topic.maintenance.body': 'Ratiba za matengenezo, uhifadhi wa data, na muda wa kusimama kwa huduma ya kusambaza tahadhari.',
    'support.topic.emailAction': 'Tuma barua pepe',
    'support.providerNote': 'Smart Warning ni ya {provider}. Ni chombo cha uratibu wa usalama, si huduma ya dharura, na hakina ushirikiano au idhini kutoka huduma yoyote ya dharura au taasisi ya serikali.',
    'tab.home': 'Nyumbani',
    'tab.safety': 'Usalama',
    'tab.help': 'Msaada',
    'tab.profile': 'Wasifu wa Usalama',
    'trial.active.org': 'Jaribio la Smart Warning la shirika lako linaendelea',
    'trial.active.individual': 'Jaribio lako la Smart Warning linaendelea',
    'trial.ended.org': 'Jaribio la Smart Warning la shirika lako limeisha',
    'trial.ended.individual': 'Jaribio lako la Smart Warning limeisha',
    'trial.daysLeftOne': 'Imebaki siku {days}',
    'trial.daysLeftMany': 'Zimebaki siku {days}',
    'trial.afterLabel': 'Baada ya jaribio lako: {price}',
    'trial.aboutTzs': 'takriban TZS {amount}',
    'trial.continueCta': 'Endelea na Smart Warning',
    'trial.endedBody': 'Tahadhari za dharura, eneo lako wakati wa tukio, namba za dharura na miongozo ya usalama zote zinaendelea kufanya kazi.',
    'trial.subscribeToKeep': 'Jisajili kwa {price} ili kuendelea na yaliyobaki.',
    'trial.seePlans': 'Ona mipango',
    'profile.personalAccount': 'Akaunti ya kibinafsi',
    'profile.teamCode': 'Msimbo wa timu {code}',
    'profile.team': 'Timu {code}',
    'profile.teamActivity': 'Shughuli za timu',
    'profile.historyNoDb': 'Historia ya matukio haihifadhiwi kwenye mfumo huu.',
    'profile.loading': 'Inapakia…',
    'profile.historyUnavailable': 'Historia haipatikani.',
    'profile.historyRetrying': 'Historia haipatikani, inajaribu tena.',
    'profile.noIncidents': 'Bado hakuna tukio lililorekodiwa.',
    'profile.statusActive': 'Linaendelea',
    'profile.resolvedBy': 'Limetatuliwa na {name}',
    'profile.statusResolved': 'Limetatuliwa',
    'profile.unknownSender': 'haijulikani',
    'profile.plansAndBilling': 'Mipango na malipo',
    'profile.aboutAndLegal': 'Kuhusu na kisheria',
    'profile.settings': 'Mipangilio',
    'profile.support': 'Msaada',
    'bill.back': 'Rudi',
    'bill.heading': 'Mipango na malipo',
    'bill.promise': 'Tahadhari za dharura hazitozwi kamwe. SOS, hali salama, wito wa majina na eneo la moja kwa moja hufanya kazi kwenye mpango wowote, hata wakati malipo yanasubiri, yamechelewa au yamesitishwa. Mipango huathiri tu zana za Msimamizi wa Usalama.',
    'bill.currentPlan': 'Mpango wa sasa',
    'bill.seats': 'Nafasi',
    'bill.seatsOver': 'Umezidi mpango wako, kila mtu bado anapokea tahadhari',
    'bill.billingNumber': 'Namba ya malipo',
    'bill.degradedNote': 'Umejisajili kwa {tier} lakini kwa sasa unapokea {plan} wakati malipo yanakamilika.',
    'bill.custom': 'Maalum',
    'bill.perMonth': 'kwa mwezi',
    'bill.perYear': 'kwa mwaka',
    'bill.alwaysFree': 'bure kila wakati',
    'bill.perSeatRange': '{min}–{max} kwa mtu / mwezi',
    'bill.currentBadge': 'Mpango wa sasa',
    'bill.talkToUs': 'Ongea nasi',
    'bill.includedBadge': 'Imejumuishwa',
    'bill.mobileMoneyOff': 'Pesa ya simu haijawekwa',
    'bill.payMobileMoney': 'Lipa kwa pesa ya simu',
    'bill.cardOff': 'Malipo ya kadi hayajawekwa',
    'bill.payByCard': 'Lipa kwa kadi',
    'bill.paymentHistory': 'Historia ya malipo',
    'bill.cancelSubscription': 'Ghairi usajili',
    'weather.heading': 'Hali ya hewa karibu nawe',
    'weather.premiumTeaser': 'Wanachama wa Premium hupata utabiri wa siku 3 na maelezo ya usalama hapa, popote walipo.',
    'weather.useMyLocation': 'Tumia eneo langu',
    'weather.chooseLocation': 'Chagua eneo lako',
    'weather.locationDenied': 'Ruhusa ya eneo haikutolewa — chagua eneo badala yake.',
    'weather.today': 'Leo',
    'weather.forecastHeading': 'Utabiri wa siku 3',
    'weather.wind': 'Upepo km/h {kph}',
    'weather.loading': 'Inapakia hali ya hewa…',
    'weather.unavailable': 'Hali ya hewa haipatikani kwa sasa.',
    'weather.disclaimer': 'Huu ni utabiri wa hali ya hewa, si tahadhari rasmi. Hauhusiani na Mamlaka ya Hali ya Hewa Tanzania (TMA).',
    'weather.condition.clear': 'Angavu',
    'weather.condition.partly-cloudy': 'Mawingu kiasi',
    'weather.condition.cloudy': 'Mawingu',
    'weather.condition.fog': 'Ukungu',
    'weather.condition.drizzle': 'Manyunyu',
    'weather.condition.rain': 'Mvua inatarajiwa',
    'weather.condition.snow': 'Theluji',
    'weather.condition.thunderstorm': 'Dhoruba ya radi',
    'weather.condition.unknown': 'Hali ya hewa',
    'weather.note.heavyRain.title': 'Mvua kubwa inawezekana',
    'weather.note.heavyRain.body': 'Kuwa mwangalifu zaidi unaposafiri.',
    'weather.note.strongWind.title': 'Upepo mkali',
    'weather.note.strongWind.body': 'Kazi za nje zinaweza kuhitaji tahadhari zaidi.',
    'weather.note.extremeHeat.title': 'Joto kali',
    'weather.note.extremeHeat.body': 'Kunywa maji ya kutosha na punguza kazi ngumu nje wakati wa joto kali zaidi.',
    'weather.place.dar': 'Dar es Salaam',
    'weather.place.mbagala': 'Mbagala',
    'weather.place.vikindu': 'Vikindu',
    'weather.place.kibaha': 'Kibaha',
    'weather.place.arusha': 'Arusha',
    'weather.place.mwanza': 'Mwanza',
    'weather.place.dodoma': 'Dodoma',
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

/** Organization signup's sector dropdown — same value strings the server has always received (server/auth.js), just a translated label. */
export const INDUSTRY_OPTIONS: { value: string; key: StringKey }[] = [
  { value: '', key: 'industry.notSpecified' },
  { value: 'manufacturing', key: 'industry.manufacturing' },
  { value: 'construction', key: 'industry.construction' },
  { value: 'healthcare', key: 'industry.healthcare' },
  { value: 'education', key: 'industry.education' },
  { value: 'transport', key: 'industry.transport' },
  { value: 'security', key: 'industry.security' },
  { value: 'office', key: 'industry.office' },
  { value: 'warehouse', key: 'industry.warehouse' },
  { value: 'retail', key: 'industry.retail' },
  { value: 'hospitality', key: 'industry.hospitality' },
  { value: 'public', key: 'industry.public' },
  { value: 'other', key: 'industry.other' },
];
