// One short safety tip a week, Monday morning in Tanzania, to every account
// that has not turned it off (users.weekly_tips, toggled in Settings).
//
// Deliberately quiet: not urgent, never requires interaction, one tag so a
// missed week is replaced rather than stacked, and opening it lands on the
// Safety tab rather than the SOS screen. Restart-safe and multi-instance-safe
// through app_kv: the week's key is claimed once, by whichever process gets
// there first, before anything is sent.
const db = require('./db');
const push = require('./push');
const fcm = require('./fcm');

// Kiswahili first: this is what shows on the lock screen. Rotated by ISO week.
const TIPS = [
  { sw: 'Hifadhi namba 112 kwenye simu yako na uwafundishe watoto kuipiga.', en: 'Save 112 in your phone and teach children how to call it.' },
  { sw: 'Hakikisha watu wako wa kuaminika wana barua pepe sahihi kwenye Smart Warning.', en: 'Check your Trusted Circle contacts have the right email in Smart Warning.' },
  { sw: 'Jua njia mbili za kutoka nyumbani au kazini endapo moto utatokea.', en: 'Know two ways out of your home or workplace in case of fire.' },
  { sw: 'Mvua kubwa: usivuke maji yanayotiririka, hata yakionekana madogo.', en: 'Heavy rain: never cross running water, even if it looks shallow.' },
  { sw: 'Unarudi usiku? Washa "Nahisi Hatari" kabla ya kuondoka.', en: 'Heading home late? Turn on "I feel unsafe" before you set off.' },
  { sw: 'Weka chaji ya simu juu ya 30% ukiwa safarini, au beba power bank.', en: 'Keep your phone above 30% when travelling, or carry a power bank.' },
  { sw: 'Mwambie mtu wa karibu aina ya damu yako na mzio ulio nao, kabla ya dharura.', en: 'Tell someone close to you your blood type and any allergies, before an emergency.' },
  { sw: 'Jaribu kengele ya Smart Warning mara moja kwa mwezi ili ujue inavyosikika.', en: 'Test your Smart Warning alarm once a month so you know how it sounds.' },
];

// Monday 09:00 East Africa Time (UTC+3, no daylight saving) is 06:00 UTC.
const SEND_DAY_UTC = 1;
const SEND_HOUR_UTC = 6;

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return { year: t.getUTCFullYear(), week: Math.ceil(((t - yearStart) / 86400000 + 1) / 7) };
}

function tipFor(date) {
  const { week } = isoWeek(date);
  return TIPS[week % TIPS.length];
}

function isSendWindow(now) {
  return now.getUTCDay() === SEND_DAY_UTC && now.getUTCHours() === SEND_HOUR_UTC;
}

/** Called every few minutes; does nothing outside the window or once claimed. */
async function tick(now = new Date()) {
  if (!db.enabled() || !isSendWindow(now)) return { sent: false };
  const { year, week } = isoWeek(now);
  const claimed = await db.kvClaim(`weekly-tip:${year}-W${week}`, now.toISOString());
  if (!claimed) return { sent: false, reason: 'already-claimed' };

  const tip = tipFor(now);
  const payload = {
    title: 'Smart Warning · Kidokezo cha wiki',
    body: `${tip.sw}\n${tip.en}`,
    severity: 'info',
    tag: 'sw-weekly-tip',
    url: '/safety',
  };
  const users = await db.listWeeklyTipRecipients();
  let delivered = 0;
  for (const userId of users) {
    // eslint-disable-next-line no-await-in-loop
    const [w, n] = await Promise.all([
      push.notifyUser(userId, payload).catch(() => ({ sent: 0 })),
      fcm.notifyUser(userId, payload).catch(() => ({ sent: 0 })),
    ]);
    if ((w.sent || 0) + (n.sent || 0) > 0) delivered += 1;
  }
  console.log(`[weekly-tip] ${year}-W${week}: ${delivered}/${users.length} account(s) reached`);
  return { sent: true, recipients: users.length, delivered };
}

module.exports = { tick, tipFor, isoWeek, isSendWindow, TIPS };
