// The light SOS page, /sos.html.
//
// The whole app is ~120KB of compressed JavaScript before it can draw a
// button, most of it React. On a weak 2G/3G signal that can be many seconds
// with nothing to press. This page is a few KB of plain DOM code that does the
// one thing that matters: raise a personal SOS with a location, say honestly
// whether it reached anyone, and always offer 112 and an SMS.
//
// It reuses the app's own pieces for everything that has rules attached —
// sending (lib/api: retries, timeout, idempotent id), the delivery verdict and
// the SMS text (lib/delivery) and the stored session (lib/session) — so the
// two screens can never disagree about what "sent" means.
//
// What it does not do: org/team alerts (those go over the relay socket, which
// only the full app holds), the siren, the live timeline, voice notes. The full
// app is one link away, and opening it shows the incident from the server.
import './sos.css';
import { registerSW } from 'virtual:pwa-register';
import { sendPersonalAlert, resolvePersonalAlert } from '../lib/api';
import { personalDelivery, needsFallback, smsHref, FALLBACK_EMERGENCY_NUMBER, type DeliveryState } from '../lib/delivery';
import { canDial } from '../lib/emergency';
import { loadSession } from '../lib/session';
import { loadSettings } from '../lib/settings';

type Lang = 'sw' | 'en';
type TypeId = 'security' | 'medical' | 'fire' | 'hazard';

const TEXT = {
  sw: {
    title: 'SOS ya haraka',
    lead: 'Gusa SOS. Watu wako watapokea tahadhari na mahali ulipo.',
    sos: 'SOS',
    sosSub: 'Gusa kutuma',
    types: { security: 'Usalama', medical: 'Afya', fire: 'Moto', hazard: 'Hatari' } as Record<TypeId, string>,
    locating: 'Inatafuta mahali ulipo…',
    noLocation: 'Mahali hapajulikani; tahadhari inatumwa bila mahali.',
    sending: 'Inatuma tahadhari yako…',
    sentPeople: 'Imetumwa kwa watu {n} wa Circle yako kwa barua pepe.',
    reachedNobody: 'Hakuna mtu wa Circle yako aliyefikiwa. Piga {num} sasa.',
    notSent: 'Haijatumwa. Piga {num} sasa au tuma SMS.',
    call: 'Piga {num}',
    callNoDial: 'Piga {num} kwa simu',
    sms: 'Tuma SMS yenye mahali nilipo',
    over: 'Imekwisha',
    mistake: 'Ilikuwa makosa',
    closed: 'Umewajulisha watu wako kuwa imekwisha.',
    noAccount: 'SOS hii ya haraka inatuma kwa akaunti binafsi. Kwa timu au bila akaunti: piga {num} au tuma SMS.',
    full: 'Fungua Smart Warning kamili',
    smsBody: 'DHARURA: {name} anahitaji msaada ({type}). {location} Imetumwa kutoka Smart Warning saa {time}.',
    smsLocation: 'Mahali: {url} (ndani ya mita {metres}).',
    smsNoLocation: 'Mahali bado hapajulikani.',
    lang: 'English',
    retry: 'Jaribu kutuma tena',
  },
  en: {
    title: 'Quick SOS',
    lead: 'Tap SOS. Your people get your alert and where you are.',
    sos: 'SOS',
    sosSub: 'Tap to send',
    types: { security: 'Security', medical: 'Medical', fire: 'Fire', hazard: 'Hazard' } as Record<TypeId, string>,
    locating: 'Finding your location…',
    noLocation: 'Location unknown; sending without it.',
    sending: 'Sending your alert…',
    sentPeople: 'Sent to {n} of your Circle by email.',
    reachedNobody: 'Nobody in your Circle could be reached. Call {num} now.',
    notSent: 'Not sent. Call {num} now or send an SMS.',
    call: 'Call {num}',
    callNoDial: 'Call {num} from a phone',
    sms: 'Send SMS with my location',
    over: "It's over",
    mistake: 'It was a mistake',
    closed: 'Your people have been told it is over.',
    noAccount: 'Quick SOS sends for personal accounts. For a team, or with no account: call {num} or send an SMS.',
    full: 'Open the full Smart Warning',
    smsBody: 'EMERGENCY: {name} needs help ({type}). {location} Sent from Smart Warning at {time}.',
    smsLocation: 'Location: {url} (within {metres} m).',
    smsNoLocation: 'Location not known yet.',
    lang: 'Kiswahili',
    retry: 'Try sending again',
  },
};

const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

/** Best effort and bounded: an SOS never waits more than a few seconds for GPS. */
function locate(timeoutMs: number): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    const timer = setTimeout(() => resolve(null), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(timer); resolve(p); },
      () => { clearTimeout(timer); resolve(null); },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

const settings = loadSettings();
let lang: Lang = settings.locale === 'en' ? 'en' : 'sw';
const session = loadSession();
const personal = session?.kind === 'supervisor' && session.user.kind === 'individual' ? session : null;
const dial = canDial();

let type: TypeId = 'security';
let phase: 'idle' | 'locating' | 'sending' | 'sent' | 'failed' | 'closed' = 'idle';
let incidentId: string | null = null;
let raisedAt = 0;
let pos: GeolocationPosition | null = null;
let contacted = 0;
let replayed = false;

function delivery(): DeliveryState | null {
  if (phase !== 'sending' && phase !== 'sent' && phase !== 'failed') return null;
  return personalDelivery({
    phase: phase === 'sending' ? 'sending' : phase, contactedCount: contacted, replayed,
    raisedAt, now: Date.now(), online: navigator.onLine,
  });
}

function sms(): string {
  const T = TEXT[lang];
  return smsHref({
    name: personal?.user.name || settings.deviceName,
    typeLabel: T.types[type],
    lat: pos?.coords.latitude ?? null,
    lng: pos?.coords.longitude ?? null,
    accuracy: pos?.coords.accuracy ?? null,
    at: raisedAt || Date.now(),
    text: {
      body: (v) => fill(T.smsBody, v),
      withLocation: (v) => fill(T.smsLocation, v),
      noLocation: T.smsNoLocation,
    },
  });
}

/** `retry` resends the same incident id, which the server treats as the same
 *  alert (it answers `replayed`), so a second tap can never notify twice. */
async function raise(retry = false) {
  if (!personal || phase === 'locating' || phase === 'sending') return;
  if (!retry || !incidentId) {
    incidentId = crypto.randomUUID();
    raisedAt = Date.now();
    navigator.vibrate?.([200, 100, 200]);
    phase = 'locating'; render();
    pos = await locate(6000);
  }
  phase = 'sending'; render();
  try {
    const r = await sendPersonalAlert({
      id: incidentId, type, severity: 'critical',
      lat: pos?.coords.latitude ?? null, lng: pos?.coords.longitude ?? null,
      message: lang === 'sw' ? 'Imetumwa kutoka SOS ya haraka.' : 'Sent from Quick SOS.',
    }, personal.token);
    contacted = r.contacted.filter((c) => c.delivered).length;
    replayed = r.replayed === true;
    phase = 'sent';
  } catch {
    phase = 'failed';
  }
  render();
}

async function close(reason: 'resolved' | 'false-alarm') {
  if (!personal || !incidentId) return;
  try { await resolvePersonalAlert(incidentId, reason, personal.token); } catch { /* the alert stays open; the full app can close it */ }
  phase = 'closed'; render();
}

function render() {
  const T = TEXT[lang];
  const root = document.getElementById('sos')!;
  root.replaceChildren();
  document.documentElement.lang = lang;

  const top = el('div', { class: 'sos-top' });
  top.append(el('h1', {}, T.title));
  const langBtn = el('button', { type: 'button', class: 'sos-lang' }, T.lang);
  langBtn.onclick = () => { lang = lang === 'sw' ? 'en' : 'sw'; render(); };
  top.append(langBtn);
  root.append(top);

  if (personal && (phase === 'idle' || phase === 'closed')) {
    root.append(el('p', { class: 'sos-lead' }, phase === 'closed' ? T.closed : T.lead));
    const types = el('div', { class: 'sos-types', role: 'radiogroup' });
    (Object.keys(T.types) as TypeId[]).forEach((id) => {
      const b = el('button', { type: 'button', role: 'radio', 'aria-checked': String(type === id), class: `sos-type${type === id ? ' on' : ''}` }, T.types[id]);
      b.onclick = () => { type = id; render(); };
      types.append(b);
    });
    root.append(types);
    const big = el('button', { type: 'button', class: 'sos-big' });
    big.append(el('span', { class: 'sos-big-word' }, T.sos), el('span', { class: 'sos-big-sub' }, T.sosSub));
    big.onclick = () => void raise();
    root.append(big);
  } else if (personal) {
    const d = delivery();
    const status = el('p', { class: 'sos-status', role: 'status', 'aria-live': 'assertive' });
    if (phase === 'locating') status.textContent = T.locating;
    else if (d?.kind === 'sending') status.textContent = T.sending;
    else if (d?.kind === 'sent-people') { status.textContent = fill(T.sentPeople, { n: String(d.count) }); status.classList.add('ok'); }
    else if (d?.kind === 'reached-nobody') { status.textContent = fill(T.reachedNobody, { num: FALLBACK_EMERGENCY_NUMBER }); status.classList.add('bad'); }
    else { status.textContent = fill(T.notSent, { num: FALLBACK_EMERGENCY_NUMBER }); status.classList.add('bad'); }
    root.append(status);
    if (phase !== 'locating' && !pos) root.append(el('p', { class: 'sos-fine' }, T.noLocation));
    if (phase === 'sent' || phase === 'failed') {
      const row = el('div', { class: 'sos-row' });
      const over = el('button', { type: 'button', class: 'sos-ghost' }, T.over);
      over.onclick = () => void close('resolved');
      const oops = el('button', { type: 'button', class: 'sos-ghost' }, T.mistake);
      oops.onclick = () => void close('false-alarm');
      row.append(over, oops);
      if (phase === 'sent') root.append(row);
      if (phase === 'failed') {
        const again = el('button', { type: 'button', class: 'sos-ghost' }, T.retry);
        again.onclick = () => void raise(true);
        root.append(again);
      }
    }
    if (d && needsFallback(d)) root.classList.add('sos-urgent'); else root.classList.remove('sos-urgent');
  } else {
    root.append(el('p', { class: 'sos-lead' }, fill(T.noAccount, { num: FALLBACK_EMERGENCY_NUMBER })));
  }

  // Always present, in every state: these need no internet and no account.
  const num = FALLBACK_EMERGENCY_NUMBER;
  root.append(dial
    ? el('a', { class: 'sos-call', href: `tel:${num}` }, fill(T.call, { num }))
    : el('p', { class: 'sos-call sos-static' }, fill(T.callNoDial, { num })));
  root.append(el('a', { class: 'sos-sms', href: sms() }, T.sms));
  root.append(el('a', { class: 'sos-full', href: '/' }, T.full));
}

// Installs the same service worker as the app, so opening this page once is
// enough for it, and the app, to open again with no signal.
registerSW({ immediate: true });

render();
// The "sending" verdict turns into "not sent" by itself after a budget
// (lib/delivery's SEND_BUDGET_MS); re-render so that change is seen.
setInterval(() => { if (phase === 'sending') render(); }, 1000);
window.addEventListener('online', render);
window.addEventListener('offline', render);
